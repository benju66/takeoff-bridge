/**
 * Synthetic company-template fixture (math-trust backlog B-1).
 *
 * The keystone golden (`golden-mckenna.test.ts`) proves the engine reproduces a
 * REAL bid to the cent — but it reads a CONFIDENTIAL workbook and `skipIf`s when
 * that file is absent, so on CI and any teammate's machine it does not run. A
 * regression in `templateExtractor.ts` or the STEP 4 summary math could then land
 * uncaught.
 *
 * This builder fabricates a SMALL, NON-CONFIDENTIAL workbook in the exact
 * company-template shape (STEP 1 inputs, STEP 2/3 section subtotals, STEP 4 line
 * items + oracle cells) using round, made-up numbers. `golden-synthetic.test.ts`
 * runs the SAME `loadTemplateWorkbook → extractEstimate → computeTakeoffSummary`
 * path against it on EVERY machine, proving the extraction + engine machinery
 * works everywhere. The real McKenna harness stays the confidential real-bid proof.
 *
 * The numbers below are hand-authored (not engine-derived) so the tie-out is a
 * genuine independent check: the workbook's oracle cells carry these values, and
 * the engine — fed only the inputs — must reproduce them.
 */

import ExcelJS from "exceljs";
import { SHEET } from "@/lib/templateExtractor";
import { ESTIMATE_MODIFIERS } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Hand-authored inputs (round numbers; nothing here is engine-computed)
// ---------------------------------------------------------------------------

export const SYNTHETIC_INPUTS = {
  projectName: "Synthetic Template Estimate",
  squareFootage: 50_000,
  unitCount: 100,
  startDate: "2026-01-01",
  finishDate: "2027-01-01",
  /** Modifier rates (decimal). Chosen so every rate × subtotal is a round dollar. */
  rates: {
    constructionContingency: 0.02,
    designContingency: 0,
    buildersRisk: 0,
    specialInsurance: 0,
    glInsurance: 0.01,
    bond: 0,
    fee: 0.05,
  } as Record<string, number>,
} as const;

/** Non-linked STEP 4 line items (qty × unitPrice). Σ = $50,000. */
const NON_LINKED_ITEMS: { itemId: string; description: string; qty: number; unitPrice: number }[] = [
  { itemId: "03-0000.001", description: "Concrete — Slab on Grade", qty: 100, unitPrice: 50 }, // 5,000
  { itemId: "04-0000.001", description: "Masonry — CMU", qty: 200, unitPrice: 25 }, // 5,000
  { itemId: "05-0000.001", description: "Metals — Stairs", qty: 10, unitPrice: 1_000 }, // 10,000
  { itemId: "06-0000.001", description: "Wood — Rough Carpentry", qty: 500, unitPrice: 20 }, // 10,000
  { itemId: "09-0000.001", description: "Finishes — Paint", qty: 400, unitPrice: 50 }, // 20,000
];

/**
 * The 10 GC/Site-Ops linked rows. The STEP 4 value (qty 1 × unitPrice) is the
 * value Excel pulled from the matching STEP 2/3 section subtotal. Σ = $50,000.
 * itemIds + labels mirror `LINKED_DIVISION_ROWS` / the extractor's linked labels.
 */
const LINKED_ROWS: { itemId: string; description: string; value: number; sheet: "step2" | "step3"; subtotalLabel: string }[] = [
  { itemId: "01-0000.001", description: "General Conditions", value: 8_000, sheet: "step2", subtotalLabel: "Total Design, PM and GCs" },
  { itemId: "01-0400.002", description: "Supervision", value: 12_000, sheet: "step2", subtotalLabel: "Total Supervision" },
  { itemId: "02-0000.001", description: "Site Operations", value: 5_000, sheet: "step3", subtotalLabel: "Total Site Operations" },
  { itemId: "02-4100.002", description: "Demolition", value: 3_000, sheet: "step3", subtotalLabel: "Total Demolition" },
  { itemId: "02-9005.003", description: "Final Cleaning", value: 2_000, sheet: "step3", subtotalLabel: "Total Final Cleaning" },
  { itemId: "02-9070.004", description: "SWPPP Permit", value: 1_000, sheet: "step3", subtotalLabel: "Total SWPPP Permit" },
  { itemId: "02-9200.005", description: "Survey and Layout", value: 4_000, sheet: "step3", subtotalLabel: "Total Survey and Layout" },
  { itemId: "02-9300.006", description: "Building and Site Services", value: 6_000, sheet: "step3", subtotalLabel: "Total Building and Site Services" },
  { itemId: "02-9400.007", description: "Site Equipment", value: 7_000, sheet: "step3", subtotalLabel: "Total Site Equipment" },
  { itemId: "02-9500.008", description: "Special Inspections", value: 2_000, sheet: "step3", subtotalLabel: "Total Site Special Inspections" },
];

// ---------------------------------------------------------------------------
// Hand-authored oracle (what a correct STEP 4 must show — the tie-out target)
// ---------------------------------------------------------------------------

const TAKEOFF_SUBTOTAL = 50_000; // Σ non-linked items
const LINKED_TOTAL = 50_000; // Σ linked rows
const SUBTOTAL = TAKEOFF_SUBTOTAL + LINKED_TOTAL; // 100,000

const MODIFIER_VALUES: Record<string, number> = {
  constructionContingency: SUBTOTAL * SYNTHETIC_INPUTS.rates.constructionContingency, // 2,000
  designContingency: SUBTOTAL * SYNTHETIC_INPUTS.rates.designContingency, // 0
  buildersRisk: SUBTOTAL * SYNTHETIC_INPUTS.rates.buildersRisk, // 0
  specialInsurance: SUBTOTAL * SYNTHETIC_INPUTS.rates.specialInsurance, // 0
  glInsurance: SUBTOTAL * SYNTHETIC_INPUTS.rates.glInsurance, // 1,000
  bond: SUBTOTAL * SYNTHETIC_INPUTS.rates.bond, // 0
  fee: SUBTOTAL * SYNTHETIC_INPUTS.rates.fee, // 5,000
};
const MODIFIER_SUM = Object.values(MODIFIER_VALUES).reduce((s, v) => s + v, 0); // 8,000
const TOTAL_ESTIMATED_COST = SUBTOTAL + MODIFIER_SUM; // 108,000

export const SYNTHETIC_ORACLE = {
  takeoffSubtotal: TAKEOFF_SUBTOTAL,
  linkedDivisionsTotal: LINKED_TOTAL,
  subtotal: SUBTOTAL,
  modifiers: MODIFIER_VALUES,
  totalEstimatedCost: TOTAL_ESTIMATED_COST,
  costPerUnit: TOTAL_ESTIMATED_COST / SYNTHETIC_INPUTS.unitCount, // 1,080
  costPerSf: TOTAL_ESTIMATED_COST / SYNTHETIC_INPUTS.squareFootage, // 2.16
  /** itemId → linked value (the 10 STEP 2/3 → STEP 4 linkages). */
  linkedValuesByItemId: Object.fromEntries(LINKED_ROWS.map((r) => [r.itemId, r.value])) as Record<string, number>,
  lineItemCount: NON_LINKED_ITEMS.length + LINKED_ROWS.length, // 15
  linkedRowCount: LINKED_ROWS.length, // 10
} as const;

// ---------------------------------------------------------------------------
// Workbook builder — writes the template shape the extractor scans for.
// ---------------------------------------------------------------------------

/** Builds the synthetic template workbook and returns its .xlsx bytes. */
export async function buildSyntheticTemplateBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  // --- STEP 1 — project inputs (label in col C / value in col D; rate label in
  //     col F / decimal in col G — exactly what `extractInputs` scans) ---
  const s1 = wb.addWorksheet(SHEET.step1);
  s1.getCell("C1").value = "Project Name";
  s1.getCell("D1").value = SYNTHETIC_INPUTS.projectName;
  s1.getCell("C2").value = "Gross SF";
  s1.getCell("D2").value = SYNTHETIC_INPUTS.squareFootage;
  s1.getCell("C3").value = "# of Units";
  s1.getCell("D3").value = SYNTHETIC_INPUTS.unitCount;
  s1.getCell("C4").value = "Expected Start";
  s1.getCell("D4").value = SYNTHETIC_INPUTS.startDate;
  s1.getCell("C5").value = "Expected Finish";
  s1.getCell("D5").value = SYNTHETIC_INPUTS.finishDate;
  // Modifier rates by label (col F) → decimal (col G).
  ESTIMATE_MODIFIERS.forEach((m, i) => {
    const r = 8 + i;
    s1.getCell(`F${r}`).value = m.label;
    s1.getCell(`G${r}`).value = SYNTHETIC_INPUTS.rates[m.key] ?? 0;
  });

  // --- STEP 2 / STEP 3 — section subtotals (label in col H / value in col I,
  //     what `extractStep23` scans for the linked-row linkage) ---
  const s2 = wb.addWorksheet(SHEET.step2);
  const s3 = wb.addWorksheet(SHEET.step3);
  let s2Row = 1;
  let s3Row = 1;
  for (const link of LINKED_ROWS) {
    const ws = link.sheet === "step2" ? s2 : s3;
    const row = link.sheet === "step2" ? s2Row++ : s3Row++;
    ws.getCell(`H${row}`).value = link.subtotalLabel;
    ws.getCell(`I${row}`).value = link.value;
  }

  // --- STEP 4 — line items (C code / D desc / F qty / H unitPrice), then the
  //     SUBTOTAL / 7 modifier / TOTAL oracle rows the extractor reads ---
  const s4 = wb.addWorksheet(SHEET.step4);
  s4.getCell("A1").value = "STEP 4 - ESTIMATE (synthetic)"; // title row — not a cost code
  let row = 2;
  for (const it of NON_LINKED_ITEMS) {
    s4.getCell(`C${row}`).value = it.itemId;
    s4.getCell(`D${row}`).value = it.description;
    s4.getCell(`F${row}`).value = it.qty;
    s4.getCell(`H${row}`).value = it.unitPrice;
    row++;
  }
  for (const link of LINKED_ROWS) {
    s4.getCell(`C${row}`).value = link.itemId;
    s4.getCell(`D${row}`).value = link.description;
    s4.getCell(`F${row}`).value = 1; // qty 1 × unitPrice(value) = the pulled-in value
    s4.getCell(`H${row}`).value = link.value;
    row++;
  }

  // SUBTOTAL row (label in col H, value in col I).
  const subtotalRow = row;
  s4.getCell(`H${subtotalRow}`).value = "SUBTOTAL";
  s4.getCell(`I${subtotalRow}`).value = SUBTOTAL;
  row++;

  // 7 modifier rows (60-xxxx code in col C, rate in col F, dollar value in col I).
  for (const m of ESTIMATE_MODIFIERS) {
    s4.getCell(`C${row}`).value = m.code;
    s4.getCell(`D${row}`).value = m.label;
    s4.getCell(`F${row}`).value = SYNTHETIC_INPUTS.rates[m.key] ?? 0;
    s4.getCell(`I${row}`).value = MODIFIER_VALUES[m.key];
    row++;
  }

  // TOTAL row (exact "TOTAL" in col H; value in col I; cost/unit in col J).
  const totalRow = row;
  s4.getCell(`H${totalRow}`).value = "TOTAL";
  s4.getCell(`I${totalRow}`).value = TOTAL_ESTIMATED_COST;
  s4.getCell(`J${totalRow}`).value = SYNTHETIC_ORACLE.costPerUnit;

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

// ===========================================================================
// Past-bid variant (Import past bids — Phase 1)
// ===========================================================================
//
// The same company-template shape as above, PLUS the three cases the import
// feature must handle without dropping a dollar:
//   1. SAME CODE, DIFFERENT SCOPE — two 08-4000.002 storefront lines (interior
//      vs exterior), distinguished only in the description; both keep their
//      IMPORTED unit price (1000, NOT the catalog default 6500) and roll up to
//      one Procore code.
//   2. CONFORMING-BUT-UNCATALOGUED — code 50-1234.567 matches NN-NNNN.NNN but is
//      not in ESTIMATE_ITEMS_MASTER → imports unmapped (Flags worklist).
//   3. AD-HOC / NON-CONFORMING — a hand-typed "SPECIAL-CRANE" line with no valid
//      code → imports as a needsReview row, dollars preserved.
//
// Kept fully separate from SYNTHETIC_* above so golden-synthetic.test.ts (which
// asserts exact counts/totals) stays byte-identical.

/** Two storefront lines sharing 08-4000.002 — kept-imported price, not catalog 6500. */
const PAST_BID_SAME_CODE: { itemId: string; description: string; qty: number; unitPrice: number }[] = [
  { itemId: "08-4000.002", description: "Aluminum Storefront Doors - Interior", qty: 3, unitPrice: 1_000 }, // 3,000
  { itemId: "08-4000.002", description: "Aluminum Storefront Doors - Exterior", qty: 5, unitPrice: 1_000 }, // 5,000
];

/** Conforming code absent from the catalog → imports unmapped. */
const PAST_BID_UNCATALOGUED = { itemId: "50-1234.567", description: "Custom Curtainwall Package", qty: 1, unitPrice: 1_500 }; // 1,500

/** Non-conforming hand-typed line (no valid code) → imports as needsReview. */
const PAST_BID_ADHOC = { code: "SPECIAL-CRANE", description: "Custom Crane Mobilization", qty: 1, unitPrice: 2_500 }; // 2,500

const PAST_BID_TAKEOFF_SUBTOTAL =
  TAKEOFF_SUBTOTAL + // the 5 catalogued non-linked items (50,000)
  PAST_BID_SAME_CODE.reduce((s, r) => s + r.qty * r.unitPrice, 0) + // 8,000
  PAST_BID_UNCATALOGUED.qty * PAST_BID_UNCATALOGUED.unitPrice + // 1,500
  PAST_BID_ADHOC.qty * PAST_BID_ADHOC.unitPrice; // 2,500  → 62,000

const PAST_BID_SUBTOTAL = PAST_BID_TAKEOFF_SUBTOTAL + LINKED_TOTAL; // 112,000

const PAST_BID_MODIFIER_VALUES: Record<string, number> = Object.fromEntries(
  ESTIMATE_MODIFIERS.map((m) => [m.key, PAST_BID_SUBTOTAL * (SYNTHETIC_INPUTS.rates[m.key] ?? 0)])
);
const PAST_BID_MODIFIER_SUM = Object.values(PAST_BID_MODIFIER_VALUES).reduce((s, v) => s + v, 0); // 8,960
const PAST_BID_TOTAL = PAST_BID_SUBTOTAL + PAST_BID_MODIFIER_SUM; // 120,960

export const PAST_BID_ORACLE = {
  takeoffSubtotal: PAST_BID_TAKEOFF_SUBTOTAL, // 62,000
  linkedDivisionsTotal: LINKED_TOTAL, // 50,000
  subtotal: PAST_BID_SUBTOTAL, // 112,000
  totalEstimatedCost: PAST_BID_TOTAL, // 120,960
  costPerUnit: PAST_BID_TOTAL / SYNTHETIC_INPUTS.unitCount, // 1,209.60
  costPerSf: PAST_BID_TOTAL / SYNTHETIC_INPUTS.squareFootage, // 2.4192
  /** Conforming line-item count (5 catalogued + 2 storefront + 1 uncatalogued + 10 linked = 18). */
  conformingLineItemCount: NON_LINKED_ITEMS.length + PAST_BID_SAME_CODE.length + 1 + LINKED_ROWS.length,
  adHocLineItemCount: 1,
  sameCodeItemId: PAST_BID_SAME_CODE[0].itemId, // "08-4000.002"
  sameCodeProcoreCode: "8-84000.000",
  sameCodeImportedUnitPrice: PAST_BID_SAME_CODE[0].unitPrice, // 1,000 (NOT catalog 6500)
  sameCodeTotal: PAST_BID_SAME_CODE.reduce((s, r) => s + r.qty * r.unitPrice, 0), // 8,000
  uncataloguedItemId: PAST_BID_UNCATALOGUED.itemId,
  adHocDescription: PAST_BID_ADHOC.description,
  adHocTotal: PAST_BID_ADHOC.qty * PAST_BID_ADHOC.unitPrice, // 2,500
} as const;

/** Builds the synthetic PAST-BID workbook (.xlsx bytes) for the import tests. */
export async function buildPastBidTemplateBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  // STEP 1 — identical inputs to the base synthetic fixture.
  const s1 = wb.addWorksheet(SHEET.step1);
  s1.getCell("C1").value = "Project Name";
  s1.getCell("D1").value = "Synthetic Past Bid";
  s1.getCell("C2").value = "Gross SF";
  s1.getCell("D2").value = SYNTHETIC_INPUTS.squareFootage;
  s1.getCell("C3").value = "# of Units";
  s1.getCell("D3").value = SYNTHETIC_INPUTS.unitCount;
  s1.getCell("C4").value = "Expected Start";
  s1.getCell("D4").value = SYNTHETIC_INPUTS.startDate;
  s1.getCell("C5").value = "Expected Finish";
  s1.getCell("D5").value = SYNTHETIC_INPUTS.finishDate;
  ESTIMATE_MODIFIERS.forEach((m, i) => {
    const r = 8 + i;
    s1.getCell(`F${r}`).value = m.label;
    s1.getCell(`G${r}`).value = SYNTHETIC_INPUTS.rates[m.key] ?? 0;
  });

  // STEP 2 / STEP 3 — section subtotals feeding the linked rows.
  const s2 = wb.addWorksheet(SHEET.step2);
  const s3 = wb.addWorksheet(SHEET.step3);
  let s2Row = 1;
  let s3Row = 1;
  for (const link of LINKED_ROWS) {
    const ws = link.sheet === "step2" ? s2 : s3;
    const row = link.sheet === "step2" ? s2Row++ : s3Row++;
    ws.getCell(`H${row}`).value = link.subtotalLabel;
    ws.getCell(`I${row}`).value = link.value;
  }

  // STEP 4 — line items, then the SUBTOTAL / modifier / TOTAL oracle rows.
  const s4 = wb.addWorksheet(SHEET.step4);
  s4.getCell("A1").value = "STEP 4 - ESTIMATE (synthetic past bid)";
  let row = 2;
  const writeItem = (itemId: string, description: string, qty: number, unitPrice: number) => {
    s4.getCell(`C${row}`).value = itemId;
    s4.getCell(`D${row}`).value = description;
    s4.getCell(`F${row}`).value = qty;
    s4.getCell(`H${row}`).value = unitPrice;
    row++;
  };
  for (const it of NON_LINKED_ITEMS) writeItem(it.itemId, it.description, it.qty, it.unitPrice);
  for (const it of PAST_BID_SAME_CODE) writeItem(it.itemId, it.description, it.qty, it.unitPrice);
  writeItem(PAST_BID_UNCATALOGUED.itemId, PAST_BID_UNCATALOGUED.description, PAST_BID_UNCATALOGUED.qty, PAST_BID_UNCATALOGUED.unitPrice);
  // Ad-hoc line — non-conforming code typed straight into col C.
  writeItem(PAST_BID_ADHOC.code, PAST_BID_ADHOC.description, PAST_BID_ADHOC.qty, PAST_BID_ADHOC.unitPrice);
  for (const link of LINKED_ROWS) writeItem(link.itemId, link.description, 1, link.value);

  const subtotalRow = row;
  s4.getCell(`H${subtotalRow}`).value = "SUBTOTAL";
  s4.getCell(`I${subtotalRow}`).value = PAST_BID_SUBTOTAL;
  row++;

  for (const m of ESTIMATE_MODIFIERS) {
    s4.getCell(`C${row}`).value = m.code;
    s4.getCell(`D${row}`).value = m.label;
    s4.getCell(`F${row}`).value = SYNTHETIC_INPUTS.rates[m.key] ?? 0;
    s4.getCell(`I${row}`).value = PAST_BID_MODIFIER_VALUES[m.key];
    row++;
  }

  const totalRow = row;
  s4.getCell(`H${totalRow}`).value = "TOTAL";
  s4.getCell(`I${totalRow}`).value = PAST_BID_TOTAL;
  s4.getCell(`J${totalRow}`).value = PAST_BID_ORACLE.costPerUnit;

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

// ===========================================================================
// LEGACY past-bid variant (Import past bids — Phase 2)
// ===========================================================================
//
// Mirrors a REAL pre-app bid (the CARE probe, 2026-06-09):
//   1. STEP 4 codes are BARE base codes (`09-9000`, no deterministic suffix) —
//      every dollar line lands on the extractor's ad-hoc path with `rawCode`.
//   2. The modifier zone carries a hand-typed LUMP SUM in a relabeled slot
//      (60-1005 shows "Owner's Rep", not "Design Contingency") — `isLump`.
//   3. The workbook's own "Budget Line Items" sheet maps bare codes to TODAY'S
//      Procore codes via SUMIF formulas — the deterministic "bridge".
//   4. The GC/Site-Ops rows are recognizable only by DESCRIPTION (linked tier).
//
// Catalog facts the cases rest on (estimate-catalog.json, checked 2026-06-09):
//   9-99000.000 ← exactly ONE internal code (09-9000.001)   → bridge-unique
//   8-84000.000 ← TWO internal codes (08-4000.001/.002)     → ambiguous
//   99-9999     ← no catalog family, no BLI row             → none tier

/** Bare-coded dollar lines. Two share 08-4000 (interior vs exterior storefront). */
const LEGACY_ITEMS: { code: string; description: string; qty: number; unitPrice: number; comment?: string }[] = [
  { code: "09-9000", description: "Interior Painting", qty: 400, unitPrice: 10 }, // 4,000 → bridge-unique
  { code: "08-4000", description: "Aluminum Storefront - Interior", qty: 3, unitPrice: 1_000 }, // 3,000 ┐ ambiguous
  { code: "08-4000", description: "Aluminum Storefront - Exterior", qty: 5, unitPrice: 1_000 }, // 5,000 ┘ bridge
  // Estimators annotate odd lines in col E — the import shows + preserves it.
  { code: "99-9999", description: "Mystery Scope", qty: 1, unitPrice: 3_000, comment: "Carried from SD pricing set" }, // 3,000 → none
];

/** STEP 1 rates the legacy bid actually carries (design contingency slot is a LUMP). */
const LEGACY_RATES: Record<string, number> = {
  constructionContingency: 0.02,
  designContingency: 0,
  buildersRisk: 0,
  specialInsurance: 0,
  glInsurance: 0.01,
  bond: 0,
  fee: 0.05,
};

/** The hand-typed lump in the 60-1005 slot, relabeled the way real bids do. */
const LEGACY_LUMP = { key: "designContingency", baseCode: "60-1005", sheetLabel: "Owner's Rep", value: 7_500 };

const LEGACY_TAKEOFF_SUBTOTAL = LEGACY_ITEMS.reduce((s, it) => s + it.qty * it.unitPrice, 0); // 15,000
const LEGACY_SUBTOTAL = LEGACY_TAKEOFF_SUBTOTAL + LINKED_TOTAL; // 65,000
const LEGACY_RATE_MODIFIER_SUM = Object.values(LEGACY_RATES).reduce((s, r) => s + r * LEGACY_SUBTOTAL, 0); // 5,200
const LEGACY_TOTAL = LEGACY_SUBTOTAL + LEGACY_RATE_MODIFIER_SUM + LEGACY_LUMP.value; // 77,700

export const LEGACY_PAST_BID_ORACLE = {
  takeoffSubtotal: LEGACY_TAKEOFF_SUBTOTAL, // 15,000
  linkedDivisionsTotal: LINKED_TOTAL, // 50,000
  subtotal: LEGACY_SUBTOTAL, // 65,000
  totalEstimatedCost: LEGACY_TOTAL, // 77,700
  rates: LEGACY_RATES,
  /** Every dollar line is ad-hoc: 4 bare items + 10 bare linked rows. */
  adHocLineItemCount: LEGACY_ITEMS.length + LINKED_ROWS.length, // 14
  conformingLineItemCount: 0,
  lump: LEGACY_LUMP,
  /** What the BLI bridge must derive: bare code → today's Procore code. */
  bridge: {
    "09-9000": "9-99000.000", // unique → internal 09-9000.001
    "08-4000": "8-84000.000", // ambiguous (2 internal candidates)
  } as Record<string, string>,
  bridgeUniqueItemId: "09-9000.001",
  noneCode: "99-9999",
  /** Linked-tier inputs: bare code + canonical description per linked row. */
  linkedDescriptions: LINKED_ROWS.map((l) => l.description),
} as const;

/** Builds the synthetic LEGACY past-bid workbook (.xlsx bytes). */
export async function buildLegacyPastBidTemplateBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  // STEP 1 — same scan shape as the modern fixtures.
  const s1 = wb.addWorksheet(SHEET.step1);
  s1.getCell("C1").value = "Project Name";
  s1.getCell("D1").value = "Synthetic Legacy Bid";
  s1.getCell("C2").value = "Gross SF";
  s1.getCell("D2").value = SYNTHETIC_INPUTS.squareFootage;
  s1.getCell("C3").value = "# of Units";
  s1.getCell("D3").value = SYNTHETIC_INPUTS.unitCount;
  s1.getCell("C4").value = "Expected Start";
  s1.getCell("D4").value = SYNTHETIC_INPUTS.startDate;
  s1.getCell("C5").value = "Expected Finish";
  s1.getCell("D5").value = SYNTHETIC_INPUTS.finishDate;
  ESTIMATE_MODIFIERS.forEach((m, i) => {
    const r = 8 + i;
    s1.getCell(`F${r}`).value = m.label;
    s1.getCell(`G${r}`).value = LEGACY_RATES[m.key] ?? 0;
  });

  // STEP 2 / STEP 3 — section subtotals (real legacy bids still carry these).
  const s2 = wb.addWorksheet(SHEET.step2);
  const s3 = wb.addWorksheet(SHEET.step3);
  let s2Row = 1;
  let s3Row = 1;
  for (const link of LINKED_ROWS) {
    const ws = link.sheet === "step2" ? s2 : s3;
    const r = link.sheet === "step2" ? s2Row++ : s3Row++;
    ws.getCell(`H${r}`).value = link.subtotalLabel;
    ws.getCell(`I${r}`).value = link.value;
  }

  // STEP 4 — every code is BARE; track row numbers for the BLI SUMIF formulas.
  const s4 = wb.addWorksheet(SHEET.step4);
  s4.getCell("A1").value = "STEP 4 - ESTIMATE (synthetic legacy bid)";
  let row = 2;
  const rowOfCode: Record<string, number> = {};
  const writeItem = (code: string, description: string, qty: number, unitPrice: number, comment?: string) => {
    s4.getCell(`C${row}`).value = code;
    s4.getCell(`D${row}`).value = description;
    if (comment) s4.getCell(`E${row}`).value = comment;
    s4.getCell(`F${row}`).value = qty;
    s4.getCell(`H${row}`).value = unitPrice;
    if (!(code in rowOfCode)) rowOfCode[code] = row; // first occurrence (SUMIF criterion)
    row++;
  };
  for (const it of LEGACY_ITEMS) writeItem(it.code, it.description, it.qty, it.unitPrice, it.comment);
  // GC/Site-Ops rows: BARE base code, canonical description, lump value.
  for (const link of LINKED_ROWS) writeItem(link.itemId.split(".")[0], link.description, 1, link.value);

  const subtotalRow = row;
  s4.getCell(`H${subtotalRow}`).value = "SUBTOTAL";
  s4.getCell(`I${subtotalRow}`).value = LEGACY_SUBTOTAL;
  row++;

  // Modifier zone — BARE codes; the 60-1005 slot is a hand-typed lump with the
  // sheet's own label ("Owner's Rep"); the rest are rate-driven (F × subtotal).
  for (const m of ESTIMATE_MODIFIERS) {
    const base = m.code.split(".")[0];
    s4.getCell(`C${row}`).value = base;
    if (m.key === LEGACY_LUMP.key) {
      s4.getCell(`D${row}`).value = LEGACY_LUMP.sheetLabel;
      s4.getCell(`I${row}`).value = LEGACY_LUMP.value; // F intentionally EMPTY
    } else {
      s4.getCell(`D${row}`).value = m.label;
      s4.getCell(`F${row}`).value = LEGACY_RATES[m.key] ?? 0;
      s4.getCell(`I${row}`).value = (LEGACY_RATES[m.key] ?? 0) * LEGACY_SUBTOTAL;
    }
    row++;
  }

  const totalRow = row;
  s4.getCell(`H${totalRow}`).value = "TOTAL";
  s4.getCell(`I${totalRow}`).value = LEGACY_TOTAL;
  s4.getCell(`J${totalRow}`).value = LEGACY_TOTAL / SYNTHETIC_INPUTS.unitCount;

  // Budget Line Items — the workbook's own Procore mapping ("the bridge").
  // Col A = Procore code, col H = SUMIF whose criterion cell points at a STEP 4
  // bare-code row. Cached results present (a calculated, saved workbook).
  const bli = wb.addWorksheet(SHEET.bli);
  bli.getCell("A1").value = "Cost Code";
  bli.getCell("H1").value = "Budget Amount";
  const s4Name = SHEET.step4;
  const sumif = (criterionRow: number) =>
    `SUMIF('${s4Name}'!$C$2:$C$${subtotalRow - 1}, '${s4Name}'!C${criterionRow}, '${s4Name}'!$I$2:$I$${subtotalRow - 1})`;
  bli.getCell("A2").value = "9-99000.000";
  bli.getCell("H2").value = { formula: sumif(rowOfCode["09-9000"]), result: 4_000 } as ExcelJS.CellFormulaValue;
  bli.getCell("A3").value = "8-84000.000";
  bli.getCell("H3").value = { formula: sumif(rowOfCode["08-4000"]), result: 8_000 } as ExcelJS.CellFormulaValue;
  // A STEP 2 (non-STEP 4) SUMIF — the bridge must ignore it.
  bli.getCell("A4").value = "1-10000.000";
  bli.getCell("H4").value = {
    formula: `SUMIF('${SHEET.step2}'!$C$2:$C$60, '${SHEET.step2}'!C5, '${SHEET.step2}'!$I$2:$I$60)`,
    result: 8_000,
  } as ExcelJS.CellFormulaValue;
  // A shared-formula-only cell (no formula text) — the bridge must skip, not guess.
  bli.getCell("A5").value = "9-92900.000";
  bli.getCell("H5").value = { sharedFormula: "H2", result: 0 } as ExcelJS.CellValue;

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
