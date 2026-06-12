/**
 * Round-trip Phase 4 — stamp + extraction + three-way delta engine.
 *
 * Synthetic, CI-safe: export against the committed template, then simulate
 * Excel edits by mutating the workbook XML directly (value swaps, row
 * insertion/deletion — note the computed cells' CACHES go stale exactly like
 * a real Excel edit before recalc; extraction must not care, because it reads
 * INPUT cells only).
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import JSZip from "jszip";
import { generateExcelWorkbook } from "../lib/exporter";
import {
  computePersonnelCosts,
  computeSiteOperations,
} from "../lib/calculations";
import { LINKED_DIVISION_ROWS } from "../lib/constants";
import { readStamp, UnstampedWorkbookError, StampSchemaError } from "../lib/roundTripStamp";
import {
  extractRoundTrip,
  computeRoundTripDelta,
  assertRoundTripAllowed,
  ImportedProjectRoundTripError,
  WrongProjectError,
  type RoundTripState,
} from "../lib/roundTrip";
import { loadWorkbookModel } from "../lib/formulaEvaluator";
import type { ProcessedTakeoffRow, ColumnDefinition } from "@/types";
import type { Project } from "@/types/db";
import { layoutWithDivisions, MASTER_TEMPLATE_PATH } from "./fixtures/templateLayout";

const STEP1_FILE = "xl/worksheets/sheet4.xml";
const STEP2_FILE = "xl/worksheets/sheet5.xml";
const STEP4_FILE = "xl/worksheets/sheet7.xml";

// ─── Fixture (same numbers as the recalc golden) ─────────────────────────────

const project: Project = {
  id: "rt-project-1",
  name: "Round-Trip Delta Test Project",
  location: "Minneapolis, MN",
  squareFootage: 10000,
  unitCount: 100,
  bidDate: "2026-06-12",
  expectedStart: "2026-01",
  expectedFinish: "2026-11", // 10 months
  createdAt: new Date().toISOString(),
  constructionContingencyRate: 0.02,
  designContingencyRate: 0,
  buildersRiskRate: 0,
  specialInsuranceRate: 0,
  glInsuranceRate: 0.01,
  bondRate: 0,
  feeRate: 0.05,
  roundingRule: "none",
};

const columns: ColumnDefinition[] = [
  { id: "costType", header: "TYPE", type: "default" },
  { id: "itemId", header: "Code", type: "default" },
  { id: "description", header: "Description", type: "default" },
  { id: "matchedQty", header: "Quantity", type: "default" },
  { id: "uom", header: "Unit", type: "default" },
  { id: "unitPrice", header: "Rate", type: "default" },
  { id: "total", header: "Total", type: "default" },
];

const baseRow = (overrides: Partial<ProcessedTakeoffRow>): ProcessedTakeoffRow => ({
  id: "row-x", classification: "", itemId: "", procoreParentCode: "", procoreCode: "",
  description: "", matchedQty: 0, uom: "LS", unitPrice: 0, total: 0, isMapped: true,
  rawQuantities: [], costType: "S", customFields: {}, source: "template",
  ...overrides,
});

const gridRows: ProcessedTakeoffRow[] = [
  baseRow({
    id: "row-1", itemId: "03-0000.001", procoreParentCode: "3-30000.000", procoreCode: "3-30000.000",
    description: "Cast In-Place Concrete", matchedQty: 150, unitPrice: 120, total: 18000, uom: "CY", costType: "M",
  }),
  baseRow({
    id: "row-2", itemId: "03-0000.002", procoreParentCode: "3-30000.000", procoreCode: "3-30000.000",
    description: "Footings", matchedQty: 80, unitPrice: 180, total: 14400, uom: "CY", costType: "M",
  }),
  ...LINKED_DIVISION_ROWS.map((cfg) =>
    baseRow({
      id: `row-${cfg.itemId}`, itemId: cfg.itemId,
      procoreParentCode: cfg.itemId.startsWith("01") ? "1-10000.000" : "2-20000.000",
      procoreCode: cfg.itemId.startsWith("01") ? "1-10000.000" : "2-20000.000",
      description: cfg.description, costType: "L",
    })
  ),
];

const gc = () =>
  computePersonnelCosts(10, 10000, { su: 100, pm: 50 },
    { dumpsters: 5000, toilets: 2000, electric: 3000 },
    { designArch: 12000, safetyConsultant: 500 });
const so = () =>
  computeSiteOperations(10, 10000,
    { knox: 2, payrollCleaning: 100, demolition: 1000, craneRental: 4000 },
    { soilBorings: 0 });

async function exportBuffer(): Promise<ArrayBuffer> {
  const blob = await generateExcelWorkbook(
    gridRows, project, columns, layoutWithDivisions("01", "02", "03", "04"),
    fs.readFileSync(MASTER_TEMPLATE_PATH) as unknown as ArrayBuffer, gc(), so()
  );
  return blob.arrayBuffer();
}

// ─── XML mutation helpers — what Excel writes when an estimator edits ────────

async function mutateWorkbook(
  buffer: ArrayBuffer,
  mutations: (zip: JSZip) => Promise<void>
): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(buffer);
  await mutations(zip);
  return zip.generateAsync({ type: "arraybuffer" });
}

/** Replace a cell's content with a plain numeric value (formula dropped —
 * exactly what Excel does on manual entry). */
async function typeValue(zip: JSZip, sheetFile: string, ref: string, value: number): Promise<void> {
  let xml = await zip.file(sheetFile)!.async("string");
  const re = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
  if (!re.test(xml)) throw new Error(`Cell ${ref} not found in ${sheetFile}`);
  xml = xml.replace(re, (_m, attrs: string) => {
    const cleaned = attrs.replace(/\s*t="[^"]*"/, "");
    return `<c r="${ref}"${cleaned}><v>${value}</v></c>`;
  });
  zip.file(sheetFile, xml);
}

/** Delete an entire row element (Excel row deletion, minus the re-numbering —
 * extraction keys by col-C code, so the simplification is safe here). */
async function deleteRow(zip: JSZip, sheetFile: string, rowNum: number): Promise<void> {
  let xml = await zip.file(sheetFile)!.async("string");
  const re = new RegExp(`<row r="${rowNum}"[^>]*>[\\s\\S]*?</row>`);
  if (!re.test(xml)) throw new Error(`Row ${rowNum} not found in ${sheetFile}`);
  xml = xml.replace(re, "");
  zip.file(sheetFile, xml);
}

/** Append a new data row (an estimator typing a fresh line under a division). */
async function insertRow(
  zip: JSZip, sheetFile: string, rowNum: number,
  cells: { code: string; desc: string; qty: number; price: number }
): Promise<void> {
  let xml = await zip.file(sheetFile)!.async("string");
  const rowXml =
    `<row r="${rowNum}">` +
    `<c r="C${rowNum}" t="inlineStr"><is><t>${cells.code}</t></is></c>` +
    `<c r="D${rowNum}" t="inlineStr"><is><t>${cells.desc}</t></is></c>` +
    `<c r="F${rowNum}"><v>${cells.qty}</v></c>` +
    `<c r="H${rowNum}"><v>${cells.price}</v></c>` +
    `</row>`;
  xml = xml.replace("</sheetData>", `${rowXml}</sheetData>`);
  zip.file(sheetFile, xml);
}

function cloneState(state: RoundTripState): RoundTripState {
  return JSON.parse(JSON.stringify(state)) as RoundTripState;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("round-trip stamp + extraction (Phase 4)", () => {
  let buffer: ArrayBuffer;

  beforeAll(async () => {
    buffer = await exportBuffer();
  }, 60000);

  it("stamps the export with project identity and a decodable baseline", async () => {
    const stamp = await readStamp(buffer);
    expect(stamp.projectId).toBe("rt-project-1");
    expect(stamp.projectName).toBe("Round-Trip Delta Test Project");
    expect(Date.parse(stamp.exportedAt)).toBeGreaterThan(0);
    expect(stamp.baseline.step1.durationMonths).toBe(10);
    expect(stamp.baseline.step1.squareFootage).toBe(10000);
    expect(stamp.baseline.step1.modifierRates.fee).toBe(0.05);
    // Linked division rows never enter the baseline
    expect(stamp.baseline.step4Rows.some((r) => r.itemId === "01-0000.001")).toBe(false);
    expect(stamp.baseline.step4Rows.find((r) => r.itemId === "03-0000.001")).toMatchObject({
      qty: 150, unitPrice: 120, uom: "CY",
    });
  });

  it("the template's own four foreign customXml parts survive alongside the stamp", async () => {
    const zip = await JSZip.loadAsync(buffer);
    for (let i = 1; i <= 5; i++) {
      expect(zip.file(`customXml/item${i}.xml`), `item${i}`).toBeTruthy();
      expect(zip.file(`customXml/itemProps${i}.xml`), `itemProps${i}`).toBeTruthy();
    }
    const ct = await zip.file("[Content_Types].xml")!.async("string");
    expect(ct).toContain('PartName="/customXml/itemProps5.xml"');
    const rels = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
    expect(rels).toContain("customXml/item5.xml");
  });

  it("a fresh export extracts to EXACTLY its own baseline — zero deltas, zero issues", async () => {
    const { stamp, state, issues } = await extractRoundTrip(buffer);
    expect(issues).toEqual([]);
    // Dial state round-trips field-for-field
    expect(state.step1).toEqual(stamp.baseline.step1);
    expect(state.step23Inputs).toEqual(stamp.baseline.step23Inputs);
    // Every baseline row extracts with identical values (the workbook also
    // carries template catalog rows the sparse fixture grid omits — the
    // delta engine ignores those zero-value strays)
    const extractedByKey = new Map(state.step4Rows.map((r) => [r.itemId, r]));
    for (const row of stamp.baseline.step4Rows) {
      expect(extractedByKey.get(row.itemId), row.itemId).toMatchObject(row);
    }
    const delta = computeRoundTripDelta(state, stamp.baseline, cloneState(stamp.baseline));
    expect(delta.rowDeltas).toEqual([]);
    expect(delta.dialDeltas).toEqual([]);
    expect(delta.isStale).toBe(false);
    expect(delta.hasConflicts).toBe(false);
  });

  it("refuses unstamped and foreign workbooks with typed errors", async () => {
    await expect(readStamp(fs.readFileSync(MASTER_TEMPLATE_PATH))).rejects.toThrow(UnstampedWorkbookError);

    const stamp = await readStamp(buffer);
    expect(() => assertRoundTripAllowed(stamp, { ...project, id: "another-project" })).toThrow(WrongProjectError);
    expect(() => assertRoundTripAllowed(stamp, { ...project, isImported: true })).toThrow(ImportedProjectRoundTripError);
    expect(() => assertRoundTripAllowed(stamp, project)).not.toThrow();
  });

  it("rejects a stamp from a future schema version", async () => {
    const futured = await mutateWorkbook(buffer, async (zip) => {
      let xml = await zip.file("customXml/item5.xml")!.async("string");
      xml = xml.replace('schemaVersion="1"', 'schemaVersion="99"');
      zip.file("customXml/item5.xml", xml);
    });
    await expect(readStamp(futured)).rejects.toThrow(StampSchemaError);
  });
});

describe("round-trip delta engine (Phase 4)", () => {
  let buffer: ArrayBuffer;
  let baseline: RoundTripState;
  let step4RowOf: (itemId: string) => number;

  beforeAll(async () => {
    buffer = await exportBuffer();
    const { stamp } = await extractRoundTrip(buffer);
    baseline = stamp.baseline;
    // Resolve template row numbers (mapped rows keep the template's
    // shared-string C cells — read through the model loader)
    const model = await loadWorkbookModel(buffer);
    const step4 = model.get("STEP 4 - ESTIMATE")!;
    const rowByCode = new Map<string, number>();
    for (const [ref, cell] of step4) {
      if (/^C\d+$/.test(ref) && typeof cell.v === "string") {
        rowByCode.set(cell.v.trim(), parseInt(ref.slice(1), 10));
      }
    }
    step4RowOf = (itemId: string) => {
      const row = rowByCode.get(itemId);
      if (row === undefined) throw new Error(`No C cell for ${itemId}`);
      return row;
    };
  }, 60000);

  it("classifies clean Excel edits — row values, dial cells, STEP 1 dials", async () => {
    const concreteRow = step4RowOf("03-0000.001");
    const edited = await mutateWorkbook(buffer, async (zip) => {
      await typeValue(zip, STEP4_FILE, `F${concreteRow}`, 200);  // qty 150 → 200
      await typeValue(zip, STEP2_FILE, "E13", 0.5);              // su util 1 → 0.5
      await typeValue(zip, STEP2_FILE, "H13", 115);              // su rate 110 → 115
      await typeValue(zip, STEP1_FILE, "D28", 14);               // duration 10 → 14
      await typeValue(zip, STEP1_FILE, "G24", 0.06);             // fee 5% → 6%
    });
    const { state, issues } = await extractRoundTrip(edited);
    const delta = computeRoundTripDelta(state, baseline, cloneState(baseline));

    expect(delta.isStale).toBe(false);
    expect(delta.hasConflicts).toBe(false);

    const rowDelta = delta.rowDeltas.find((r) => r.itemId === "03-0000.001");
    expect(rowDelta?.kind).toBe("changed");
    expect(rowDelta?.fields).toEqual([
      { field: "qty", baseline: 150, excel: 200, current: 150, classification: "edited" },
    ]);

    const byLabel = new Map(delta.dialDeltas.map((d) => [`${d.label}:${d.field}`, d]));
    expect(byLabel.get("Superintendent:E")).toMatchObject({ excel: 0.5, baseline: 1, classification: "edited" });
    expect(byLabel.get("Superintendent:H")).toMatchObject({ excel: 115, baseline: 110 });
    expect(byLabel.get("Duration (months):durationMonths")).toMatchObject({ excel: 14, baseline: 10 });
    expect(byLabel.get("Fee:fee")).toMatchObject({ excel: 0.06, baseline: 0.05 });
    // The edited su STAFF dial disagrees with the untouched su-bound
    // operational E cells — surfaced, not silently resolved
    expect(issues.some((i) => i.includes("Superintendent dial"))).toBe(true);
  });

  it("three-way classification: conflict when both sides moved, silent when convergent, stale when db moved alone", async () => {
    const concreteRow = step4RowOf("03-0000.001");
    const edited = await mutateWorkbook(buffer, async (zip) => {
      await typeValue(zip, STEP4_FILE, `F${concreteRow}`, 200); // Excel: 150 → 200
      await typeValue(zip, STEP1_FILE, "D12", 12000);           // Excel sqft: 10000 → 12000
    });
    const { state } = await extractRoundTrip(edited);

    // The db moved since export: qty 150 → 175 (conflicts with Excel's 200),
    // sqft 10000 → 12000 (converges with Excel), unit count 100 → 90
    // (untouched in Excel → keep current silently, but the upload is stale).
    const current = cloneState(baseline);
    current.step4Rows.find((r) => r.itemId === "03-0000.001")!.qty = 175;
    current.step1.squareFootage = 12000;
    current.step1.unitCount = 90;

    const delta = computeRoundTripDelta(state, baseline, current);
    expect(delta.isStale).toBe(true);
    expect(delta.hasConflicts).toBe(true);

    const qty = delta.rowDeltas.find((r) => r.itemId === "03-0000.001")?.fields?.[0];
    expect(qty).toMatchObject({ baseline: 150, excel: 200, current: 175, classification: "conflict" });
    // Convergent sqft and app-only unit count produce NO deltas
    expect(delta.dialDeltas).toEqual([]);
  });

  it("detects rows added and deleted in Excel", async () => {
    const footingsRow = step4RowOf("03-0000.002");
    const edited = await mutateWorkbook(buffer, async (zip) => {
      await insertRow(zip, STEP4_FILE, 998, {
        code: "03-9999.001", desc: "Excel-born allowance", qty: 5, price: 100,
      });
      await deleteRow(zip, STEP4_FILE, footingsRow);
    });
    const { state } = await extractRoundTrip(edited);
    const delta = computeRoundTripDelta(state, baseline, cloneState(baseline));

    const added = delta.rowDeltas.find((r) => r.kind === "added");
    expect(added).toMatchObject({ itemId: "03-9999.001" });
    expect(added?.excelRow).toMatchObject({ qty: 5, unitPrice: 100, description: "Excel-born allowance" });

    const removed = delta.rowDeltas.find((r) => r.kind === "removed");
    expect(removed).toMatchObject({ itemId: "03-0000.002" });
    expect(removed?.currentRow).toMatchObject({ qty: 80, unitPrice: 180 });
  });

  it("row deleted in the app + edited in Excel = row conflict", async () => {
    const concreteRow = step4RowOf("03-0000.001");
    const edited = await mutateWorkbook(buffer, async (zip) => {
      await typeValue(zip, STEP4_FILE, `F${concreteRow}`, 999);
    });
    const { state } = await extractRoundTrip(edited);
    const current = cloneState(baseline);
    current.step4Rows = current.step4Rows.filter((r) => r.itemId !== "03-0000.001");

    const delta = computeRoundTripDelta(state, baseline, current);
    expect(delta.hasConflicts).toBe(true);
    const conflicted = delta.rowDeltas.find((r) => r.itemId === "03-0000.001");
    expect(conflicted).toMatchObject({ kind: "added", conflict: true });
    expect(conflicted?.excelRow?.qty).toBe(999);
  });

  it("stale computed caches never leak into the delta (inputs only are read)", async () => {
    // Edit ONLY the duration dial: every computed F/I cache in the workbook
    // is now stale (Excel before recalc / cache refresh). Extraction must
    // still produce exactly one dial delta.
    const edited = await mutateWorkbook(buffer, async (zip) => {
      await typeValue(zip, STEP1_FILE, "D28", 12);
    });
    const { state } = await extractRoundTrip(edited);
    const delta = computeRoundTripDelta(state, baseline, cloneState(baseline));
    expect(delta.rowDeltas).toEqual([]);
    expect(delta.dialDeltas).toEqual([
      {
        field: "durationMonths", baseline: 10, excel: 12, current: 10,
        classification: "edited", scope: "step1", label: "Duration (months)",
      },
    ]);
  });
});
