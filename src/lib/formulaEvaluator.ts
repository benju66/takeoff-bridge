/**
 * formulaEvaluator.ts — scoped Excel formula evaluator (Excel Round-Trip
 * Phase 3; plan locked decision 4).
 *
 * Evaluates EXACTLY the grammar the live exporter emits/keeps on the company
 * template — arithmetic, comparisons, SUM / SUMIF / IF / ISNUMBER, absolute
 * and cross-sheet cell refs, ranges — and FAILS LOUDLY on anything else
 * (`UnsupportedFormulaError`). It is the verification backbone for the
 * recalc goldens: synthetic export → evaluate → tie every line to the engine;
 * and the local calibration golden runs it over real finished bids comparing
 * against Excel's own cached results, so emitter and evaluator cannot share a
 * blind spot.
 *
 * Pure + reusable (no DOM, no test deps): imported-bid reactivation (import
 * roadmap item 2) is the named second consumer — re-deriving a finished bid's
 * totals from recovered dials uses this same evaluator.
 */

import JSZip from "jszip";

// ─── Workbook model ──────────────────────────────────────────────────────────

/** A cell as evaluation input: optional formula text (no leading "="), and
 * the cached/literal value. */
export interface EvalCell {
  f?: string;
  v?: number | string | boolean;
}

/** ref ("F12") → cell. Refs are uppercase, no $ markers. */
export type SheetModel = Map<string, EvalCell>;
/** sheet name → SheetModel. */
export type WorkbookModel = Map<string, SheetModel>;

export class UnsupportedFormulaError extends Error {
  constructor(message: string, public readonly formula: string) {
    super(`${message} in formula "=${formula}"`);
    this.name = "UnsupportedFormulaError";
  }
}

// ─── Model loader (raw XML — same parsing family as the exporter/probe) ─────

function parseSharedStrings(sstXml: string): string[] {
  if (!sstXml) return [];
  return (sstXml.match(/<si>[\s\S]*?<\/si>/g) || []).map((si) => {
    const runs = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
    return runs
      .map((r) => r.replace(/<t[^>]*>/, "").replace(/<\/t>$/, ""))
      .join("")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  });
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

/** Shift relative row refs by rowOffset and relative column refs by colOffset
 * (shared-formula dependent expansion). */
function shiftFormula(formula: string, rowOffset: number, colOffset: number): string {
  return formula.replace(
    /(\$?)([A-Z]{1,3})(\$?)(\d+)/g,
    (_m, colLock: string, col: string, rowLock: string, rowStr: string) => {
      const newCol = colLock === "$" ? col : indexToCol(colToIndex(col) + colOffset);
      const newRow = rowLock === "$" ? rowStr : String(parseInt(rowStr, 10) + rowOffset);
      return `${colLock}${newCol}${rowLock}${newRow}`;
    }
  );
}

function colToIndex(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function indexToCol(idx: number): string {
  let s = "";
  while (idx > 0) {
    const rem = (idx - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    idx = Math.floor((idx - 1) / 26);
  }
  return s;
}

function parseSheetCells(sheetXml: string, sharedStrings: string[]): SheetModel {
  const cells: SheetModel = new Map();
  const sharedMasters = new Map<string, { row: number; col: number; formula: string }>();
  const cellRe = /<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(sheetXml))) {
    const attrs = m[1];
    const inner = m[2] || "";
    const refMatch = attrs.match(/r="([A-Z]+\d+)"/);
    if (!refMatch) continue;
    const ref = refMatch[1];
    const colStr = ref.replace(/\d+$/, "");
    const rowNum = parseInt(ref.slice(colStr.length), 10);
    const t = (attrs.match(/t="([^"]+)"/) || [])[1];

    const cell: EvalCell = {};

    const fMatch = inner.match(/<f([^>]*)(?:\/>|>([\s\S]*?)<\/f>)/);
    if (fMatch) {
      const fAttrs = fMatch[1] || "";
      let fText = fMatch[2] || "";
      const isShared = /t="shared"/.test(fAttrs);
      const si = (fAttrs.match(/si="(\d+)"/) || [])[1];
      if (isShared && fText && si !== undefined) {
        sharedMasters.set(si, { row: rowNum, col: colToIndex(colStr), formula: fText });
      }
      if (isShared && !fText && si !== undefined) {
        const master = sharedMasters.get(si);
        if (master) {
          fText = shiftFormula(master.formula, rowNum - master.row, colToIndex(colStr) - master.col);
        }
      }
      if (fText) cell.f = decodeXmlEntities(fText);
    }

    const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
    if (t === "inlineStr") {
      const isMatch = inner.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/);
      cell.v = isMatch ? decodeXmlEntities(isMatch[1]) : "";
    } else if (vMatch) {
      const raw = vMatch[1];
      if (t === "s") cell.v = sharedStrings[parseInt(raw, 10)] ?? "";
      else if (t === "str") cell.v = decodeXmlEntities(raw);
      else if (t === "b") cell.v = raw === "1";
      else if (t === "e") cell.v = decodeXmlEntities(raw); // error literal e.g. #DIV/0!
      else cell.v = Number(raw);
    }

    if (cell.f !== undefined || cell.v !== undefined) cells.set(ref, cell);
  }
  return cells;
}

/** Builds the evaluation model from an .xlsx buffer (all sheets). */
export async function loadWorkbookModel(buffer: ArrayBuffer | Buffer): Promise<WorkbookModel> {
  const zip = await JSZip.loadAsync(buffer);
  const wbXml = await zip.file("xl/workbook.xml")!.async("string");
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
  const sstFile = zip.file("xl/sharedStrings.xml");
  const sharedStrings = parseSharedStrings(sstFile ? await sstFile.async("string") : "");

  const model: WorkbookModel = new Map();
  const sheetRe = /<sheet[^>]*\/>|<sheet[^>]*><\/sheet>/g;
  let sm: RegExpExecArray | null;
  while ((sm = sheetRe.exec(wbXml))) {
    const tag = sm[0];
    const name = (tag.match(/name="([^"]+)"/) || [])[1];
    const rid = (tag.match(/r:id="([^"]+)"/) || [])[1];
    if (!name || !rid) continue;
    const rel = relsXml.match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`));
    if (!rel) continue;
    const target = rel[1].replace(/^\/?(xl\/)?/, "");
    const file = zip.file(`xl/${target}`);
    if (!file) continue;
    const xml = await file.async("string");
    model.set(decodeXmlEntities(name), parseSheetCells(xml, sharedStrings));
  }
  return model;
}

/**
 * Simulates an estimator typing a value into a cell: any formula is replaced
 * by the literal (exactly what Excel does on manual entry). For the dial-turn
 * goldens.
 */
export function setInputValue(
  model: WorkbookModel,
  sheet: string,
  ref: string,
  value: number | string
): void {
  const sheetModel = model.get(sheet);
  if (!sheetModel) throw new Error(`Sheet "${sheet}" not in model`);
  sheetModel.set(ref.toUpperCase(), { v: value });
}

// ─── Evaluator ───────────────────────────────────────────────────────────────

export type CellScalar = number | string | boolean;

interface RangeValue {
  kind: "range";
  sheet: string;
  cells: { ref: string }[];
}
type EvalValue = CellScalar | RangeValue;

interface Token {
  type: "num" | "str" | "ref" | "range" | "func" | "op" | "lparen" | "rparen" | "comma";
  text: string;
  sheet?: string; // for ref/range tokens with a sheet prefix
}

// Sheet-name prefix: 'Quoted Name'! or BareName! ; then REF or REF:REF
const TOKEN_RE = new RegExp(
  [
    String.raw`(?:'(?<qsheet>[^']+)'!|(?<bsheet>[A-Za-z_][A-Za-z0-9_.]*)!)?` +
      String.raw`\$?(?<c1>[A-Z]{1,3})\$?(?<r1>\d+)(?::\$?(?<c2>[A-Z]{1,3})\$?(?<r2>\d+))?`,
  ].join(""),
  "y"
);

function tokenize(formula: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const src = formula;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t") {
      i++;
      continue;
    }
    if (ch === "(") { tokens.push({ type: "lparen", text: "(" }); i++; continue; }
    if (ch === ")") { tokens.push({ type: "rparen", text: ")" }); i++; continue; }
    if (ch === ",") { tokens.push({ type: "comma", text: "," }); i++; continue; }
    if (ch === '"') {
      let j = i + 1;
      let out = "";
      while (j < src.length) {
        if (src[j] === '"' && src[j + 1] === '"') { out += '"'; j += 2; continue; }
        if (src[j] === '"') break;
        out += src[j++];
      }
      tokens.push({ type: "str", text: out });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] || ""))) {
      const m = src.slice(i).match(/^\d*\.?\d+(?:[eE][+-]?\d+)?%?/);
      if (!m) throw new UnsupportedFormulaError(`Bad number at "${src.slice(i, i + 12)}"`, formula);
      tokens.push({ type: "num", text: m[0] });
      i += m[0].length;
      continue;
    }
    if (ch === "<" || ch === ">") {
      const two = src.slice(i, i + 2);
      if (two === "<>" || two === "<=" || two === ">=") {
        tokens.push({ type: "op", text: two });
        i += 2;
      } else {
        tokens.push({ type: "op", text: ch });
        i++;
      }
      continue;
    }
    if ("+-*/=^&".includes(ch)) {
      tokens.push({ type: "op", text: ch });
      i++;
      continue;
    }
    // Sheet-prefixed or bare cell ref / range, or function name
    TOKEN_RE.lastIndex = i;
    const refMatch = TOKEN_RE.exec(src);
    if (refMatch && refMatch.index === i) {
      const g = refMatch.groups!;
      const sheet = g.qsheet || g.bsheet;
      // Distinguish function names from refs: a ref not followed by "(".
      const after = src[i + refMatch[0].length];
      const looksLikeFunc = !sheet && after === "(" && /^[A-Z]+\d*$/.test(refMatch[0]);
      if (!looksLikeFunc) {
        if (g.c2) {
          tokens.push({ type: "range", text: `${g.c1}${g.r1}:${g.c2}${g.r2}`, sheet });
        } else {
          tokens.push({ type: "ref", text: `${g.c1}${g.r1}`, sheet });
        }
        i += refMatch[0].length;
        continue;
      }
    }
    const fnMatch = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_.]*/);
    if (fnMatch) {
      const name = fnMatch[0].toUpperCase();
      if (src[i + fnMatch[0].length] === "(") {
        tokens.push({ type: "func", text: name });
        i += fnMatch[0].length;
        continue;
      }
      if (name === "TRUE" || name === "FALSE") {
        tokens.push({ type: "str", text: name }); // handled in primary as boolean
        i += fnMatch[0].length;
        continue;
      }
      throw new UnsupportedFormulaError(`Unsupported name "${fnMatch[0]}"`, formula);
    }
    throw new UnsupportedFormulaError(`Unexpected character "${ch}"`, formula);
  }
  return tokens;
}

const SUPPORTED_FUNCTIONS = new Set([
  "SUM", "SUMIF", "IF", "ISNUMBER", "AND", "OR", "NOT", "MIN", "MAX", "ROUND", "ABS",
]);

export class FormulaEvaluator {
  private cache = new Map<string, CellScalar>();
  private inProgress = new Set<string>();

  constructor(private model: WorkbookModel) {}

  /** Evaluates a cell: its formula if present (recursively), else its literal
   * value; empty cells evaluate to 0 in numeric contexts (returned as ""). */
  cellValue(sheet: string, ref: string): CellScalar {
    const key = `${sheet}!${ref}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    if (this.inProgress.has(key)) {
      throw new Error(`Circular reference at ${key}`);
    }
    const sheetModel = this.model.get(sheet);
    if (!sheetModel) throw new Error(`Sheet "${sheet}" not in model`);
    const cell = sheetModel.get(ref.toUpperCase());
    let result: CellScalar;
    if (cell?.f) {
      this.inProgress.add(key);
      try {
        result = this.evaluateFormula(cell.f, sheet);
      } finally {
        this.inProgress.delete(key);
      }
    } else {
      result = cell?.v ?? "";
    }
    this.cache.set(key, result);
    return result;
  }

  /** Evaluates formula text (no leading "=") in the context of a sheet. */
  evaluateFormula(formula: string, contextSheet: string): CellScalar {
    const tokens = tokenize(formula);
    let pos = 0;

    const peek = () => tokens[pos];
    const next = () => tokens[pos++];
    const fail = (msg: string): never => {
      throw new UnsupportedFormulaError(msg, formula);
    };

    const toNumber = (v: EvalValue): number => {
      if (typeof v === "number") return v;
      if (typeof v === "boolean") return v ? 1 : 0;
      if (v === "") return 0; // empty cell in arithmetic
      if (typeof v === "string") {
        return fail(`Text "${v}" used in arithmetic`);
      }
      return fail("Range used as a scalar");
    };

    const compare = (op: string, a: EvalValue, b: EvalValue): boolean => {
      if (typeof a === "object" || typeof b === "object") fail("Range in comparison");
      // Excel equality: empty cell equals 0 and ""
      const norm = (x: CellScalar): CellScalar => (x === "" ? 0 : x);
      const an = norm(a as CellScalar);
      const bn = norm(b as CellScalar);
      if (typeof an === "string" || typeof bn === "string") {
        const as = String(an).toUpperCase();
        const bs = String(bn).toUpperCase();
        switch (op) {
          case "=": return as === bs;
          case "<>": return as !== bs;
          default: return fail(`Text comparison "${op}"`);
        }
      }
      const av = toNumber(an);
      const bv = toNumber(bn);
      switch (op) {
        case "=": return av === bv;
        case "<>": return av !== bv;
        case "<": return av < bv;
        case ">": return av > bv;
        case "<=": return av <= bv;
        case ">=": return av >= bv;
        default: return fail(`Comparison "${op}"`);
      }
    };

    const rangeScalars = (r: RangeValue): CellScalar[] =>
      r.cells.map((c) => this.cellValue(r.sheet, c.ref));

    const callFunction = (name: string, args: EvalValue[]): EvalValue => {
      switch (name) {
        case "SUM": {
          let total = 0;
          for (const a of args) {
            if (typeof a === "object") {
              // Range: like Excel, only numeric cells count
              for (const v of rangeScalars(a)) {
                if (typeof v === "number") total += v;
              }
            } else if (a !== "" && typeof a !== "string") {
              total += toNumber(a);
            }
          }
          return total;
        }
        case "SUMIF": {
          if (args.length < 2 || args.length > 3) fail("SUMIF arity");
          const [crit0, criteria, sum0] = args;
          if (typeof crit0 !== "object") return fail("SUMIF criteria range must be a range");
          const sumRange = (sum0 ?? crit0) as EvalValue;
          if (typeof sumRange !== "object") return fail("SUMIF sum range must be a range");
          if (crit0.cells.length !== sumRange.cells.length) fail("SUMIF range size mismatch");
          if (typeof criteria === "object") fail("SUMIF criteria must be scalar");
          const critVals = rangeScalars(crit0);
          const sumVals = rangeScalars(sumRange);
          let total = 0;
          for (let i = 0; i < critVals.length; i++) {
            if (compare("=", critVals[i], criteria as CellScalar)) {
              const v = sumVals[i];
              if (typeof v === "number") total += v;
            }
          }
          return total;
        }
        case "IF": {
          if (args.length < 2 || args.length > 3) fail("IF arity");
          const cond = args[0];
          if (typeof cond === "object") return fail("IF condition is a range");
          const truthy = typeof cond === "boolean" ? cond : toNumber(cond) !== 0;
          return truthy ? args[1] : (args[2] ?? false);
        }
        case "ISNUMBER": {
          const a = args[0];
          return typeof a === "number";
        }
        case "AND":
        case "OR": {
          const bools = args.map((a) => {
            if (typeof a === "object") return fail(`${name} over a range`);
            return typeof a === "boolean" ? a : toNumber(a) !== 0;
          });
          return name === "AND" ? bools.every(Boolean) : bools.some(Boolean);
        }
        case "NOT": {
          const a = args[0];
          if (typeof a === "object") return fail("NOT over a range");
          return !(typeof a === "boolean" ? a : toNumber(a) !== 0);
        }
        case "MIN":
        case "MAX": {
          const nums: number[] = [];
          for (const a of args) {
            if (typeof a === "object") {
              for (const v of rangeScalars(a)) if (typeof v === "number") nums.push(v);
            } else {
              nums.push(toNumber(a));
            }
          }
          if (nums.length === 0) return 0;
          return name === "MIN" ? Math.min(...nums) : Math.max(...nums);
        }
        case "ROUND": {
          if (args.length !== 2) fail("ROUND arity");
          const value = toNumber(args[0]);
          const digits = toNumber(args[1]);
          const factor = Math.pow(10, Math.trunc(digits));
          // Excel rounds half away from zero
          return Math.sign(value) * Math.round(Math.abs(value) * factor) / factor;
        }
        case "ABS":
          return Math.abs(toNumber(args[0]));
        default:
          return fail(`Unsupported function ${name}`);
      }
    };

    const parsePrimary = (): EvalValue => {
      const t = peek();
      if (!t) fail("Unexpected end of formula");
      if (t.type === "num") {
        next();
        if (t.text.endsWith("%")) return Number(t.text.slice(0, -1)) / 100;
        return Number(t.text);
      }
      if (t.type === "str") {
        next();
        if (t.text === "TRUE") return true;
        if (t.text === "FALSE") return false;
        return t.text;
      }
      if (t.type === "ref") {
        next();
        return this.cellValue(t.sheet ?? contextSheet, t.text);
      }
      if (t.type === "range") {
        next();
        const [a, b] = t.text.split(":");
        const colA = a.replace(/\d+$/, "");
        const rowA = parseInt(a.slice(colA.length), 10);
        const colB = b.replace(/\d+$/, "");
        const rowB = parseInt(b.slice(colB.length), 10);
        const cells: { ref: string }[] = [];
        for (let c = colToIndex(colA); c <= colToIndex(colB); c++) {
          for (let r = rowA; r <= rowB; r++) {
            cells.push({ ref: `${indexToCol(c)}${r}` });
          }
        }
        return { kind: "range", sheet: t.sheet ?? contextSheet, cells };
      }
      if (t.type === "func") {
        next();
        if (!SUPPORTED_FUNCTIONS.has(t.text)) fail(`Unsupported function ${t.text}`);
        if (next()?.type !== "lparen") fail(`Missing ( after ${t.text}`);
        const args: EvalValue[] = [];
        if (peek()?.type === "rparen") {
          next();
        } else {
          for (;;) {
            args.push(parseComparison());
            const sep = next();
            if (!sep) fail("Unterminated function call");
            if (sep.type === "rparen") break;
            if (sep.type !== "comma") fail(`Unexpected "${sep.text}" in arguments`);
          }
        }
        return callFunction(t.text, args);
      }
      if (t.type === "lparen") {
        next();
        const v = parseComparison();
        if (next()?.type !== "rparen") fail("Missing )");
        return v;
      }
      if (t.type === "op" && (t.text === "-" || t.text === "+")) {
        next();
        const v = toNumber(parseUnaryTarget());
        return t.text === "-" ? -v : v;
      }
      return fail(`Unexpected token "${t.text}"`);
    };

    const parseUnaryTarget = (): EvalValue => parsePrimary();

    const parseMultiplicative = (): EvalValue => {
      let left = parsePrimary();
      for (;;) {
        const t = peek();
        if (t?.type === "op" && (t.text === "*" || t.text === "/")) {
          next();
          const right = parsePrimary();
          const a = toNumber(left);
          const b = toNumber(right);
          if (t.text === "/" && b === 0) {
            return fail("Division by zero (#DIV/0!)");
          }
          left = t.text === "*" ? a * b : a / b;
        } else if (t?.type === "op" && (t.text === "^" || t.text === "&")) {
          return fail(`Operator "${t.text}" not supported`);
        } else {
          return left;
        }
      }
    };

    const parseAdditive = (): EvalValue => {
      let left = parseMultiplicative();
      for (;;) {
        const t = peek();
        if (t?.type === "op" && (t.text === "+" || t.text === "-")) {
          next();
          const right = parseMultiplicative();
          left = t.text === "+" ? toNumber(left) + toNumber(right) : toNumber(left) - toNumber(right);
        } else {
          return left;
        }
      }
    };

    const parseComparison = (): EvalValue => {
      let left = parseAdditive();
      for (;;) {
        const t = peek();
        if (t?.type === "op" && ["=", "<>", "<", ">", "<=", ">="].includes(t.text)) {
          next();
          const right = parseAdditive();
          left = compare(t.text, left, right);
        } else {
          return left;
        }
      }
    };

    const result = parseComparison();
    if (pos !== tokens.length) {
      fail(`Trailing content from token ${pos}`);
    }
    if (typeof result === "object") fail("Formula evaluates to a range");
    return result as CellScalar;
  }
}
