/**
 * roundTripStamp.ts — the exported workbook's identity + baseline stamp
 * (Excel Round-Trip Phase 4; plan locked decision 3).
 *
 * The stamp is a customXml data part (`customXml/itemN.xml` + datastore
 * itemProps + rels): a first-class OOXML feature that Excel preserves across
 * open→edit→save cycles — the committed template itself carries four foreign
 * customXml parts that survived real-world use. The part holds the project
 * identity, the export timestamp, and a compact BASELINE snapshot (the
 * extractable input state at export time), so the re-upload diff can three-way
 * classify every field (exported vs Excel vs current db) without any DB
 * lookup of historical state.
 *
 * Shared by the exporter (write) and roundTrip.ts (read) — both import this
 * module; neither imports the other.
 */

import JSZip from "jszip";

// ─── Types ───────────────────────────────────────────────────────────────────

/** One STEP 4 grid row as exported (linked division rows excluded).
 * costType is deliberately absent: col A is not rewritten on mapped rows, so
 * it is not a comparable round-trip field — the app's value stands. */
export interface BaselineRow {
  itemId: string;
  description: string;
  qty: number;
  unitPrice: number;
  uom: string;
}

/** Input-cell values of one STEP 2/3 line, keyed per inputCellsFor():
 * E = utilization fraction, F = typed qty / effective pct, H = rate/amount/basis. */
export interface BaselineStep23Inputs {
  E?: number;
  F?: number;
  H?: number;
}

/** STEP 1 dial values as exported. */
export interface BaselineStep1 {
  durationMonths: number;
  squareFootage: number;
  unitCount: number;
  /** ESTIMATE_MODIFIERS key → decimal rate (G18–G24). */
  modifierRates: Record<string, number>;
}

/** The extractable input state of a workbook — the SAME shape the re-upload
 * extractor produces, so baseline ↔ extraction comparisons are field-for-field. */
export interface RoundTripState {
  step4Rows: BaselineRow[];
  /** STEP 2/3 criterion code → input-cell values. */
  step23Inputs: Record<string, BaselineStep23Inputs>;
  step1: BaselineStep1;
}

export interface RoundTripStamp {
  schemaVersion: number;
  projectId: string;
  projectName: string;
  exportedAt: string; // ISO timestamp
  baseline: RoundTripState;
}

export const STAMP_SCHEMA_VERSION = 1;
const STAMP_NAMESPACE = "urn:takeoff-bridge:roundtrip";
const STAMP_ROOT = "takeoffBridgeStamp";
/** Fixed datastore GUID identifying our part among other add-ins' items. */
const STAMP_ITEM_GUID = "{7AB3E4F1-0DD4-4E2C-9C1B-5A1E0F2D6B33}";

// ─── Errors ──────────────────────────────────────────────────────────────────

export class UnstampedWorkbookError extends Error {
  constructor() {
    super(
      "This workbook carries no Takeoff Bridge export stamp — only files exported by the app can be re-uploaded."
    );
    this.name = "UnstampedWorkbookError";
  }
}

export class WrongProjectError extends Error {
  constructor(public readonly stampProjectName: string, public readonly stampProjectId: string) {
    super(
      `This workbook was exported from a different project ("${stampProjectName}") — re-upload it there, or export this project first.`
    );
    this.name = "WrongProjectError";
  }
}

export class StampSchemaError extends Error {
  constructor(found: number) {
    super(
      `This workbook's export stamp uses schema v${found}, which this app version cannot read (supported: v${STAMP_SCHEMA_VERSION}).`
    );
    this.name = "StampSchemaError";
  }
}

// ─── base64 (browser + node, unicode-safe, no Buffer) ────────────────────────

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToUtf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function escapeXmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── Write ───────────────────────────────────────────────────────────────────

function nextCustomXmlIndex(zip: JSZip): number {
  let max = 0;
  zip.forEach((path) => {
    const m = path.match(/^customXml\/item(\d+)\.xml$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return max + 1;
}

/**
 * Adds the stamp parts to a built workbook zip (call before generateAsync):
 * customXml/itemN.xml (the stamp), itemPropsN.xml (datastore identity),
 * the item→props rel, a workbook→item rel, and the [Content_Types] override.
 */
export async function writeStampParts(zip: JSZip, stamp: RoundTripStamp): Promise<void> {
  const n = nextCustomXmlIndex(zip);

  const baselineB64 = utf8ToBase64(JSON.stringify(stamp.baseline));
  const itemXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<${STAMP_ROOT} xmlns="${STAMP_NAMESPACE}" schemaVersion="${stamp.schemaVersion}">` +
    `<projectId>${escapeXmlText(stamp.projectId)}</projectId>` +
    `<projectName>${escapeXmlText(stamp.projectName)}</projectName>` +
    `<exportedAt>${escapeXmlText(stamp.exportedAt)}</exportedAt>` +
    `<baseline encoding="base64+json">${baselineB64}</baseline>` +
    `</${STAMP_ROOT}>`;

  const itemPropsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="no"?>` +
    `<ds:datastoreItem ds:itemID="${STAMP_ITEM_GUID}" ` +
    `xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml">` +
    `<ds:schemaRefs><ds:schemaRef ds:uri="${STAMP_NAMESPACE}"/></ds:schemaRefs>` +
    `</ds:datastoreItem>`;

  const itemRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" ` +
    `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" ` +
    `Target="itemProps${n}.xml"/>` +
    `</Relationships>`;

  zip.file(`customXml/item${n}.xml`, itemXml);
  zip.file(`customXml/itemProps${n}.xml`, itemPropsXml);
  zip.file(`customXml/_rels/item${n}.xml.rels`, itemRelsXml);

  // Workbook relationship (unique id beyond the existing rIdNN range)
  const wbRelsPath = "xl/_rels/workbook.xml.rels";
  let relsXml = await zip.file(wbRelsPath)!.async("string");
  let maxRid = 0;
  for (const m of relsXml.matchAll(/Id="rId(\d+)"/g)) {
    maxRid = Math.max(maxRid, parseInt(m[1], 10));
  }
  relsXml = relsXml.replace(
    "</Relationships>",
    `<Relationship Id="rId${maxRid + 1}" ` +
      `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" ` +
      `Target="../customXml/item${n}.xml"/></Relationships>`
  );
  zip.file(wbRelsPath, relsXml);

  // Content type override for the props part (itemN.xml rides the xml Default)
  const ctPath = "[Content_Types].xml";
  let ctXml = await zip.file(ctPath)!.async("string");
  if (!/Extension="xml"/.test(ctXml)) {
    ctXml = ctXml.replace(
      "</Types>",
      `<Default Extension="xml" ContentType="application/xml"/></Types>`
    );
  }
  ctXml = ctXml.replace(
    "</Types>",
    `<Override PartName="/customXml/itemProps${n}.xml" ` +
      `ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/></Types>`
  );
  zip.file(ctPath, ctXml);
}

// ─── Read ────────────────────────────────────────────────────────────────────

function readTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  if (!m) return null;
  return m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

/** Reads the stamp from an already-open zip; throws UnstampedWorkbookError /
 * StampSchemaError. Foreign customXml parts (other add-ins, any encoding)
 * are skipped without error. */
export async function readStampFromZip(zip: JSZip): Promise<RoundTripStamp> {
  const itemFiles: string[] = [];
  zip.forEach((path) => {
    if (/^customXml\/item\d+\.xml$/.test(path)) itemFiles.push(path);
  });
  for (const path of itemFiles.sort()) {
    let xml: string;
    try {
      xml = await zip.file(path)!.async("string");
    } catch {
      continue;
    }
    if (!xml.includes(STAMP_NAMESPACE) || !xml.includes(`<${STAMP_ROOT}`)) continue;

    const versionMatch = xml.match(/schemaVersion="(\d+)"/);
    const schemaVersion = versionMatch ? parseInt(versionMatch[1], 10) : 0;
    if (schemaVersion !== STAMP_SCHEMA_VERSION) throw new StampSchemaError(schemaVersion);

    const projectId = readTag(xml, "projectId");
    const projectName = readTag(xml, "projectName") ?? "";
    const exportedAt = readTag(xml, "exportedAt");
    const baselineB64 = readTag(xml, "baseline");
    if (!projectId || !exportedAt || !baselineB64) throw new UnstampedWorkbookError();

    let baseline: RoundTripState;
    try {
      baseline = JSON.parse(base64ToUtf8(baselineB64.trim())) as RoundTripState;
    } catch {
      throw new UnstampedWorkbookError();
    }
    return { schemaVersion, projectId, projectName, exportedAt, baseline };
  }
  throw new UnstampedWorkbookError();
}

/** Reads the stamp from a workbook buffer. */
export async function readStamp(buffer: ArrayBuffer | Buffer): Promise<RoundTripStamp> {
  const zip = await JSZip.loadAsync(buffer);
  return readStampFromZip(zip);
}
