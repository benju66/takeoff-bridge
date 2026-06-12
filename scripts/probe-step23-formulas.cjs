/**
 * probe-step23-formulas.cjs — forensic STEP 2/3 formula probe (Excel Round-Trip Phase 1).
 *
 * Reads a company-template-family workbook and reports, for every code-bearing row
 * on "STEP 2 - GCs" and "STEP 3 - SITE OPS", the raw cell shape of columns E/F/H/I:
 * formula text (shared formulas expanded) or cached value. Classifies each row's
 * quantity cell against the template's known driver patterns:
 *
 *   staffHours : F = $J$5*4.33*E<r>*40            (duration x utilization x 173.2 h/mo)
 *   superQty   : F = $J$5*E<r>                    (duration x superintendent utilization)
 *   monthly    : =$J$5                            (project duration, months)
 *   weekly     : =$J$5*4                          (duration x 4 weeks/mo)
 *   sqft       : =J8                              (square footage; Temp Protection)
 *   perSF3000  : =J8/3000                         (square footage / 3000)
 *   value      : a plain number (estimator-typed input)
 *   blank      : no content
 *   other      : any formula outside the known grammar (printed verbatim)
 *
 * Dial cells: STEP 2/3 $J$5 = duration <- 'STEP 1'!D28 (=YEARFRAC(D10,D11)*12);
 * $J$8 = square footage <- 'STEP 1'!D12 (STEP 3 routes via STEP 4 K8).
 *
 * Usage:
 *   node scripts/probe-step23-formulas.cjs [path-to-xlsx]
 * Default workbook: templates/Company_Estimate_Template.xlsx
 *
 * Read-only: never writes or modifies the workbook. Works on the blank committed
 * template and on real finished bids (the 2026-06-11 CARE probe that retired
 * finding G-2 — most STEP 2/3 dollar rows ARE formula-driven with recoverable dials).
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// ─── Minimal ZIP reader (stored + deflate entries; no dependency) ───────────

function readZipEntries(buf) {
  const entries = {};
  // Scan for local file headers (PK\x03\x04). Robust enough for xlsx files.
  let off = 0;
  while (off < buf.length - 4) {
    if (buf.readUInt32LE(off) !== 0x04034b50) {
      off++;
      continue;
    }
    const method = buf.readUInt16LE(off + 8);
    let compSize = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const name = buf.toString("utf8", off + 30, off + 30 + nameLen);
    const dataStart = off + 30 + nameLen + extraLen;
    const flags = buf.readUInt16LE(off + 6);
    if (compSize === 0 && (flags & 0x08) !== 0) {
      // Sizes in data descriptor (streamed entry) — find central directory record instead.
      compSize = findCentralCompSize(buf, name) ?? 0;
    }
    const raw = buf.subarray(dataStart, dataStart + compSize);
    entries[name] = method === 8 ? () => zlib.inflateRawSync(raw) : () => Buffer.from(raw);
    off = dataStart + compSize;
  }
  return entries;
}

function findCentralCompSize(buf, name) {
  let off = 0;
  while (off < buf.length - 4) {
    if (buf.readUInt32LE(off) === 0x02014b50) {
      const nameLen = buf.readUInt16LE(off + 28);
      const extraLen = buf.readUInt16LE(off + 30);
      const commentLen = buf.readUInt16LE(off + 32);
      const entryName = buf.toString("utf8", off + 46, off + 46 + nameLen);
      if (entryName === name) return buf.readUInt32LE(off + 20);
      off += 46 + nameLen + extraLen + commentLen;
    } else {
      off++;
    }
  }
  return null;
}

// ─── Sheet resolution + shared strings ───────────────────────────────────────

function resolveSheetFile(wbXml, relsXml, sheetName) {
  const esc = sheetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m =
    wbXml.match(new RegExp(`<sheet[^>]*name="${esc}"[^>]*r:id="([^"]+)"`)) ||
    wbXml.match(new RegExp(`<sheet[^>]*r:id="([^"]+)"[^>]*name="${esc}"`));
  if (!m) throw new Error(`Sheet "${sheetName}" not found in workbook.xml`);
  const rel = relsXml.match(new RegExp(`Id="${m[1]}"[^>]*Target="([^"]+)"`));
  if (!rel) throw new Error(`Relationship ${m[1]} not found`);
  return rel[1].replace(/^\/?(xl\/)?/, "");
}

function parseSharedStrings(sstXml) {
  if (!sstXml) return [];
  return (sstXml.match(/<si>[\s\S]*?<\/si>/g) || []).map((si) => {
    // Concatenate all <t> runs (rich-text strings carry multiple).
    const runs = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
    return runs
      .map((r) => r.replace(/<t[^>]*>/, "").replace(/<\/t>$/, ""))
      .join("")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  });
}

// ─── Cell extraction with shared-formula expansion ──────────────────────────

function parseCellRef(ref) {
  const m = ref.match(/^([A-Z]+)(\d+)$/);
  return m ? { col: m[1], row: parseInt(m[2], 10) } : { col: "", row: 0 };
}

/** Shift relative row refs in a formula by rowOffset (column offsets not needed:
 * the template's shared formulas on STEP 2/3 span single columns). */
function shiftFormulaRows(formula, rowOffset) {
  return formula.replace(/(\$?)([A-Z]+)(\$?)(\d+)/g, (_m, colLock, col, rowLock, rowStr) => {
    if (rowLock === "$") return `${colLock}${col}${rowLock}${rowStr}`;
    return `${colLock}${col}${rowLock}${parseInt(rowStr, 10) + rowOffset}`;
  });
}

/**
 * Returns Map<cellRef, { f?: string, v?: string, t?: string }> for a sheet,
 * with shared formulas expanded onto their dependent cells.
 */
function extractCells(sheetXml) {
  const cells = new Map();
  const sharedMasters = new Map(); // si -> { row, formula }
  const cellRe = /<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m;
  while ((m = cellRe.exec(sheetXml))) {
    const attrs = m[1];
    const inner = m[2] || "";
    const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
    if (!ref) continue;
    const t = (attrs.match(/t="([^"]+)"/) || [])[1];
    const fMatch = inner.match(/<f([^>]*)(?:\/>|>([\s\S]*?)<\/f>)/);
    const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
    const cell = { t, v: vMatch ? vMatch[1] : undefined };
    if (fMatch) {
      const fAttrs = fMatch[1] || "";
      let fText = fMatch[2] || "";
      const isShared = /t="shared"/.test(fAttrs);
      const si = (fAttrs.match(/si="(\d+)"/) || [])[1];
      const { row } = parseCellRef(ref);
      if (isShared && fText) sharedMasters.set(si, { row, formula: fText });
      if (isShared && !fText) {
        const master = sharedMasters.get(si);
        if (master) fText = shiftFormulaRows(master.formula, row - master.row);
      }
      cell.f = fText
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    }
    cells.set(ref, cell);
  }
  return cells;
}

function readText(cell, sharedStrings) {
  if (!cell) return "";
  if (cell.t === "s" && cell.v !== undefined) return sharedStrings[parseInt(cell.v, 10)] || "";
  if (cell.t === "str" || cell.t === "inlineStr") return cell.v || "";
  return cell.v || "";
}

// ─── Pattern classification (the grammar the live export emits/keeps) ───────

function classifyQty(row, fF, fE) {
  const norm = (s) => (s || "").replace(/\s+/g, "");
  const F = norm(fF);
  const E = norm(fE);
  if (F === `$J$5*4.33*E${row}*40`) return "staffHours";
  if (F === `$J$5*E${row}`) return "superQty";
  for (const [cellName, f] of [["F", F], ["E", E]]) {
    if (f === "$J$5") return `monthly(${cellName})`;
    if (f === "$J$5*4") return `weekly(${cellName})`;
    if (f === "J8" || f === "$J$8") return `sqft(${cellName})`;
    if (f === "J8/3000" || f === "$J$8/3000") return `perSF3000(${cellName})`;
  }
  if (F) return "otherF";
  if (E) return "otherE";
  return "input";
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  const file = process.argv[2] || path.resolve(__dirname, "../templates/Company_Estimate_Template.xlsx");
  if (!fs.existsSync(file)) {
    console.error(`Workbook not found: ${file}`);
    process.exit(1);
  }
  console.log(`Probing: ${file}\n`);

  const zip = readZipEntries(fs.readFileSync(file));
  const get = (name) => (zip[name] ? zip[name]().toString("utf8") : "");
  const wbXml = get("xl/workbook.xml");
  const relsXml = get("xl/_rels/workbook.xml.rels");
  const sharedStrings = parseSharedStrings(get("xl/sharedStrings.xml"));

  const CODE_RE = /^\d{2}-\d{4}(\.\d{1,3})?$/;

  for (const sheetName of ["STEP 2 - GCs", "STEP 3 - SITE OPS"]) {
    const sheetFile = resolveSheetFile(wbXml, relsXml, sheetName);
    const cells = extractCells(get(`xl/${sheetFile}`));
    console.log(`════ ${sheetName} (${sheetFile}) ════`);

    // Dial cells first
    for (const dial of ["J5", "J8"]) {
      const c = cells.get(dial);
      console.log(`  dial ${dial}: ${c?.f ? "=" + c.f : ""} | cached: ${c?.v ?? ""}`);
    }

    const tally = { formulaQty: 0, inputQty: 0, otherQty: 0 };
    const rows = [];
    for (const [ref, cell] of cells) {
      const { col, row } = parseCellRef(ref);
      if (col !== "C") continue;
      const code = readText(cell, sharedStrings).trim();
      if (!CODE_RE.test(code)) continue;
      rows.push({ row, code });
    }
    rows.sort((a, b) => a.row - b.row);

    for (const { row, code } of rows) {
      const D = readText(cells.get(`D${row}`), sharedStrings).trim();
      const shape = {};
      for (const col of ["E", "F", "H", "I"]) {
        const c = cells.get(`${col}${row}`);
        shape[col] = c?.f ? `=${c.f}` : c?.v !== undefined ? `v:${c.v}` : "";
      }
      const pattern = classifyQty(row, cells.get(`F${row}`)?.f, cells.get(`E${row}`)?.f);
      if (pattern === "input") tally.inputQty++;
      else if (pattern.startsWith("other")) tally.otherQty++;
      else tally.formulaQty++;
      console.log(
        `  r${String(row).padEnd(3)} ${code.padEnd(12)} ${pattern.padEnd(13)} ` +
        `E=${shape.E.slice(0, 28).padEnd(28)} F=${shape.F.slice(0, 28).padEnd(28)} ` +
        `H=${shape.H.slice(0, 24).padEnd(24)} I=${shape.I.slice(0, 24)}  ${D.slice(0, 38)}`
      );
    }
    console.log(`  ── qty cells: ${tally.formulaQty} formula-driven · ${tally.inputQty} input · ${tally.otherQty} other\n`);
  }
}

main();
