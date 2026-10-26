/**
 * SAM 3.1 wire-grammar parser.
 * Grammar: https://dev.meta.ai/docs/sam/reading-segmentation (fetched 2026-10-27).
 *
 * Official mask encodings `~` (lossless) and `!` (one_bit) wrap a base85
 * payload. The byte layout after base85 is not specified on that page
 * (docs send decode to @meta-sam/parser). This module does not invent that
 * layout. Tests use the synthetic `#` encoding (ASCII 0/1), labeled synthetic.
 */

export type SamEncoding = "~" | "!" | "#";

export type SamBox = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
  h: number;
  c?: number;
};

export type SamMaskHeader = {
  x: number;
  y: number;
  height: number;
  width: number;
  encoding: SamEncoding | string;
  payload: string;
  c?: number;
};

export type SamRecord = {
  frameIndex: number;
  objectId: number;
  box: SamBox;
  mask: SamMaskHeader;
};

export type RasterDecode =
  | { ok: true; data: Uint8Array; source: "synthetic" }
  | { ok: false; reason: string };

const FRAME_RE = /^<(\d+)f>/;

function parseFields(inner: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const part of inner.split(";")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    fields[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return fields;
}

function requireInt(fields: Record<string, string>, key: string): number {
  const raw = fields[key];
  if (raw === undefined || !/^-?\d+$/.test(raw)) {
    throw new Error(`missing integer field ${key}`);
  }
  return Number(raw);
}

function optionalConfidence(fields: Record<string, string>): number | undefined {
  if (fields.c === undefined) return undefined;
  const n = Number(fields.c);
  if (!Number.isFinite(n)) {
    throw new Error("confidence is not a number");
  }
  return n;
}

function readToken(
  text: string,
  start: number,
  kind: "box" | "mask",
): { inner: string; end: number } {
  const open = `<|${kind};`;
  if (!text.startsWith(open, start)) {
    throw new Error(`expected ${kind} token`);
  }
  const close = text.indexOf("|>", start);
  if (close === -1) {
    throw new Error(`unterminated ${kind} token`);
  }
  return { inner: text.slice(start + open.length, close), end: close + 2 };
}

export function parseSamLine(line: string): SamRecord[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  const frameMatch = FRAME_RE.exec(trimmed);
  if (!frameMatch) {
    throw new Error("line does not start with a <Nf> frame marker");
  }
  const frameIndex = Number(frameMatch[1]);
  let i = frameMatch[0].length;
  const records: SamRecord[] = [];
  while (i < trimmed.length) {
    if (trimmed[i] === ",") i += 1;
    const idMatch = /^(\d+)/.exec(trimmed.slice(i));
    if (!idMatch) {
      throw new Error("expected object id");
    }
    const objectId = Number(idMatch[1]);
    i += idMatch[1].length;
    const boxTok = readToken(trimmed, i, "box");
    i = boxTok.end;
    const maskTok = readToken(trimmed, i, "mask");
    i = maskTok.end;
    const boxFields = parseFields(boxTok.inner);
    const maskFields = parseFields(maskTok.inner);
    const data = maskFields.data;
    if (data === undefined) {
      throw new Error("mask is missing data=");
    }
    const dataMatch = /^(\d+),(\d+),(.)([\s\S]*)$/.exec(data);
    if (!dataMatch) {
      throw new Error("mask data= must be H,W,ENC,payload");
    }
    records.push({
      frameIndex,
      objectId,
      box: {
        x1: requireInt(boxFields, "x1"),
        y1: requireInt(boxFields, "y1"),
        x2: requireInt(boxFields, "x2"),
        y2: requireInt(boxFields, "y2"),
        w: requireInt(boxFields, "w"),
        h: requireInt(boxFields, "h"),
        c: optionalConfidence(boxFields),
      },
      mask: {
        x: requireInt(maskFields, "x"),
        y: requireInt(maskFields, "y"),
        height: Number(dataMatch[1]),
        width: Number(dataMatch[2]),
        encoding: dataMatch[3],
        payload: dataMatch[4],
        c: optionalConfidence(maskFields),
      },
    });
  }
  return records;
}

export function parseSamOutput(text: string): SamRecord[] {
  const records: SamRecord[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    records.push(...parseSamLine(line));
  }
  return records;
}

export function decodeSyntheticRaster(mask: SamMaskHeader): RasterDecode {
  if (mask.encoding !== "#") {
    return {
      ok: false,
      reason:
        "Official SAM mask encodings ~ and ! are base85 plus an undocumented raster layout (docs point to @meta-sam/parser). Raster decode is 확인 필요. Synthetic tests use encoding #.",
    };
  }
  const expected = mask.height * mask.width;
  if (mask.payload.length !== expected) {
    return {
      ok: false,
      reason: `synthetic payload length ${mask.payload.length} != H*W ${expected}`,
    };
  }
  const data = new Uint8Array(expected);
  for (let i = 0; i < expected; i += 1) {
    const ch = mask.payload[i];
    if (ch !== "0" && ch !== "1") {
      return { ok: false, reason: "synthetic payload must be ASCII 0/1" };
    }
    data[i] = ch === "1" ? 1 : 0;
  }
  return { ok: true, data, source: "synthetic" };
}

export function encodeSyntheticMaskLine(input: {
  frameIndex: number;
  objectId: number;
  box: SamBox;
  originX?: number;
  originY?: number;
  height: number;
  width: number;
  bits: Uint8Array;
}): string {
  if (input.bits.length !== input.height * input.width) {
    throw new Error("bits length must equal H*W");
  }
  const payload = Array.from(input.bits, (b) => (b ? "1" : "0")).join("");
  const cBox = input.box.c === undefined ? "" : `;c=${input.box.c}`;
  const ox = input.originX ?? 0;
  const oy = input.originY ?? 0;
  return (
    `<${input.frameIndex}f>${input.objectId}` +
    `<|box;x1=${input.box.x1};y1=${input.box.y1};x2=${input.box.x2};y2=${input.box.y2};w=${input.box.w};h=${input.box.h}${cBox}|>` +
    `<|mask;x=${ox};y=${oy};data=${input.height},${input.width},#${payload}|>`
  );
}

export type ResponsesSseExtract = {
  outputText: string;
  completed: boolean;
  eventTypes: string[];
};

export function extractOutputTextFromResponsesSse(
  sseText: string,
): ResponsesSseExtract {
  const eventTypes: string[] = [];
  let outputText = "";
  let completed = false;
  for (const raw of sseText.split(/\r?\n/)) {
    if (!raw.startsWith("data: ")) continue;
    const data = raw.slice(6);
    if (data === "[DONE]") {
      completed = true;
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data) as unknown;
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const rec = parsed as { type?: unknown; delta?: unknown };
    if (typeof rec.type === "string") eventTypes.push(rec.type);
    if (rec.type === "response.output_text.delta" && typeof rec.delta === "string") {
      outputText += rec.delta;
    }
    if (rec.type === "response.completed") completed = true;
  }
  return { outputText, completed, eventTypes };
}
