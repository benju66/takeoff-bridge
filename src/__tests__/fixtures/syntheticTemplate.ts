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
