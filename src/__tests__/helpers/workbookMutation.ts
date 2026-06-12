/**
 * Workbook XML mutation helpers — simulate what Excel writes when an
 * estimator edits an exported file (round-trip Phases 4/5 tests).
 * Computed-cell CACHES intentionally go stale, exactly like a real Excel
 * edit before recalc.
 */

import JSZip from "jszip";

export const STEP1_FILE = "xl/worksheets/sheet4.xml";
export const STEP2_FILE = "xl/worksheets/sheet5.xml";
export const STEP3_FILE = "xl/worksheets/sheet6.xml";
export const STEP4_FILE = "xl/worksheets/sheet7.xml";

export async function mutateWorkbook(
  buffer: ArrayBuffer,
  mutations: (zip: JSZip) => Promise<void>
): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(buffer);
  await mutations(zip);
  return zip.generateAsync({ type: "arraybuffer" });
}

/** Replace a cell's content with a plain numeric value (formula dropped —
 * exactly what Excel does on manual entry). */
export async function typeValue(zip: JSZip, sheetFile: string, ref: string, value: number): Promise<void> {
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
export async function deleteRow(zip: JSZip, sheetFile: string, rowNum: number): Promise<void> {
  let xml = await zip.file(sheetFile)!.async("string");
  const re = new RegExp(`<row r="${rowNum}"[^>]*>[\\s\\S]*?</row>`);
  if (!re.test(xml)) throw new Error(`Row ${rowNum} not found in ${sheetFile}`);
  xml = xml.replace(re, "");
  zip.file(sheetFile, xml);
}

/** Append a new data row (an estimator typing a fresh line under a division). */
export async function insertRow(
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
