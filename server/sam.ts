/**
 * SAM 3.1 on the Meta Model API.
 *
 * Request shapes follow Meta's public protocol and playground
 * (github.com/meta-models/meta-sam, protocol/sam3.md and
 * typescript/examples/api-playground/server/openai-request.ts, read 2026-10-27):
 * - an image request is unary (`stream: false`); the playground notes that the
 *   API answers a streaming image request with `response.failed`;
 * - a video is uploaded once to `/files` (purpose `user_data`, MP4 only) and
 *   segmented with a streaming request that references the file id.
 * Masks are decoded with Meta's own `@meta-sam/parser` (SAM License).
 */
import {
  buildObjectPrompt,
  decodeMaskToRaster,
  frameIndexOf,
  parseImageStream,
  parseVideoStream,
  recordsOfKind,
  type PromptObject,
  type SegmentationDiagnostic,
  type SegmentationRecord,
} from "@meta-sam/parser";
import { resolveModelApiKey, type EnvMap } from "./keys.js";
import { META_API_BASE, SAM_MODEL, type FetchLike } from "./meta-client.js";

export const MAX_CONCEPT_LENGTH = 160;

export type SamPrompt =
  | { kind: "concept"; text: string }
  | {
      kind: "objects";
      width: number;
      height: number;
      objects: PromptObject[];
    };

export type SamRequestOptions = {
  includeConfidence?: boolean;
  scoreThreshold?: number;
  propagationDirection?: "both" | "forward" | "backward";
};

/** One decoded mask, placed in source-image pixels. */
export type SamMask = {
  objectId: string;
  frameIndex?: number;
  /** Half-open source-pixel box that the raster covers. */
  bounds: { left: number; top: number; right: number; bottom: number };
  /** Raster size. It covers `bounds` and may be smaller than the box. */
  width: number;
  height: number;
  /** Row-major run lengths, first run counts zeros. Sum = width * height. */
  runs: number[];
  pixelCount: number;
  confidence?: number;
};

export type SamOutcome = {
  status: string;
  reason?: string;
  detail?: string;
};

export type SamSegmentation = {
  masks: SamMask[];
  outcome: SamOutcome;
  diagnostics: SegmentationDiagnostic[];
  rawOutput: string;
};

export class SamUpstreamError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "SamUpstreamError";
    this.status = status;
  }
}

export function normalizeConcept(text: string): string {
  const phrase = text.trim();
  if (phrase.length === 0 || phrase.length > MAX_CONCEPT_LENGTH) {
    throw new TypeError(
      `A SAM concept must be a short noun phrase of 1 to ${MAX_CONCEPT_LENGTH} characters.`,
    );
  }
  return phrase;
}

export function promptText(prompt: SamPrompt): string {
  if (prompt.kind === "concept") return normalizeConcept(prompt.text);
  return buildObjectPrompt({
    size: { width: prompt.width, height: prompt.height },
    objects: prompt.objects,
  });
}

function metadataFor(options: SamRequestOptions): { metadata?: Record<string, string> } {
  const metadata: Record<string, string> = {};
  if (options.scoreThreshold !== undefined) {
    metadata.score_threshold = String(options.scoreThreshold);
  }
  if (options.includeConfidence !== undefined) {
    metadata.include_confidence = String(options.includeConfidence);
  }
  if (options.propagationDirection !== undefined) {
    metadata.propagation_direction = options.propagationDirection;
  }
  return Object.keys(metadata).length === 0 ? {} : { metadata };
}

export function buildSamImageBody(
  imageDataUrl: string,
  prompt: SamPrompt,
  options: SamRequestOptions = {},
): Record<string, unknown> {
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(imageDataUrl)) {
    throw new TypeError("imageDataUrl must be a base64 JPEG, PNG or WebP data URL");
  }
  return {
    model: SAM_MODEL,
    stream: false,
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: promptText(prompt) },
          { type: "input_image", image_url: imageDataUrl },
        ],
      },
    ],
    ...metadataFor({ ...options, propagationDirection: undefined }),
  };
}

export function buildSamVideoBody(
  fileId: string,
  prompt: SamPrompt,
  options: SamRequestOptions = {},
): Record<string, unknown> {
  if (!/^file-[A-Za-z0-9_-]{1,120}$/.test(fileId)) {
    throw new TypeError("fileId is not a Files API handle");
  }
  return {
    model: SAM_MODEL,
    stream: true,
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: promptText(prompt) },
          { type: "input_video", file_id: fileId },
        ],
      },
    ],
    ...metadataFor({ ...options, scoreThreshold: undefined }),
  };
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null ? (value as JsonRecord) : null;
}

/**
 * A unary Responses body becomes the event sequence the parser reads.
 * Only `output_text` and `refusal` parts form a lane; reasoning parts are skipped.
 */
export function unaryBodyToEvents(value: unknown): JsonRecord[] {
  const body = asRecord(value);
  if (!body) throw new TypeError("SAM returned a body that is not an object");
  const output = Array.isArray(body.output) ? body.output : [];
  const events: JsonRecord[] = [];
  let contentIndex = 0;
  output.forEach((rawItem, outputIndex) => {
    const item = asRecord(rawItem);
    if (!item || !Array.isArray(item.content)) return;
    const itemId = typeof item.id === "string" && item.id ? item.id : "sam-image";
    for (const rawPart of item.content) {
      const part = asRecord(rawPart);
      if (!part) continue;
      const lane = { item_id: itemId, output_index: outputIndex, content_index: contentIndex };
      if (part.type === "output_text" && typeof part.text === "string") {
        events.push({ type: "response.output_text.delta", delta: part.text, ...lane });
        events.push({ type: "response.output_text.done", text: part.text, ...lane });
        contentIndex += 1;
      } else if (part.type === "refusal" && typeof part.refusal === "string") {
        events.push({ type: "response.refusal.delta", delta: part.refusal, ...lane });
        events.push({ type: "response.refusal.done", refusal: part.refusal, ...lane });
        contentIndex += 1;
      }
    }
  });
  if (body.status === "completed") {
    events.push({ type: "response.completed" });
  } else if (body.status === "incomplete") {
    events.push({
      type: "response.incomplete",
      response: { incomplete_details: body.incomplete_details ?? null },
    });
  } else if (body.status === "failed") {
    events.push({ type: "response.failed", response: { error: body.error ?? null } });
  } else {
    throw new TypeError(`SAM returned an unknown status: ${String(body.status)}`);
  }
  return events;
}

/** Server-sent events text to the JSON events it carries. */
export function sseTextToEvents(text: string): JsonRecord[] {
  const events: JsonRecord[] = [];
  let data: string[] = [];
  const flush = () => {
    if (data.length === 0) return;
    const payload = data.join("\n");
    data = [];
    if (payload === "[DONE]") return;
    try {
      const parsed = asRecord(JSON.parse(payload));
      if (parsed && typeof parsed.type === "string") events.push(parsed);
    } catch {
      // A non-JSON data block is not a Responses event; skip it.
    }
  };
  for (const line of text.split(/\r?\n/)) {
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  flush();
  return events;
}

async function* iterate<T>(items: readonly T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

export function runsFromRaster(raster: Uint8Array): { runs: number[]; ones: number } {
  const runs: number[] = [];
  let current = 0;
  let count = 0;
  let ones = 0;
  for (const value of raster) {
    const bit = value ? 1 : 0;
    ones += bit;
    if (bit === current) {
      count += 1;
    } else {
      runs.push(count);
      current = bit;
      count = 1;
    }
  }
  runs.push(count);
  return { runs, ones };
}

export function masksFromRecords(records: readonly SegmentationRecord[]): SamMask[] {
  return recordsOfKind(records, "mask").map((record) => {
    const raster = decodeMaskToRaster(record.mask);
    const { runs, ones } = runsFromRaster(raster);
    const frameIndex = frameIndexOf(record);
    return {
      objectId: record.objectId,
      ...(frameIndex === undefined ? {} : { frameIndex }),
      bounds: { ...record.bounds },
      width: record.mask.width,
      height: record.mask.height,
      runs,
      pixelCount: ones,
      ...(record.confidence === undefined ? {} : { confidence: record.confidence }),
    };
  });
}

function outcomeOf(outcome: { status: string; reason?: string; detail?: string }): SamOutcome {
  return {
    status: outcome.status,
    ...(outcome.reason ? { reason: outcome.reason } : {}),
    ...(outcome.detail ? { detail: outcome.detail } : {}),
  };
}

export async function parseImageEvents(events: readonly JsonRecord[]): Promise<SamSegmentation> {
  const result = await parseImageStream(iterate(events as { type: string }[])).finalResult;
  return {
    masks: masksFromRecords(result.records),
    outcome: outcomeOf(result.outcome),
    diagnostics: [...result.diagnostics],
    rawOutput: result.rawOutput,
  };
}

export async function parseVideoEvents(events: readonly JsonRecord[]): Promise<SamSegmentation> {
  const result = await parseVideoStream(iterate(events as { type: string }[])).finalResult;
  return {
    masks: masksFromRecords(result.records),
    outcome: outcomeOf(result.outcome),
    diagnostics: [...result.diagnostics],
    rawOutput: result.rawOutput,
  };
}

function apiKey(env: EnvMap): string {
  const key = resolveModelApiKey(env);
  if (!key) throw new SamUpstreamError(503, "MODEL_API_KEY / META_API_KEY is not configured");
  return key;
}

/** Upstream error text is shortened and never echoes our request. */
async function upstreamMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 300 ? `${compact.slice(0, 300)}…` : compact;
}

export async function segmentImage(
  input: { imageDataUrl: string; prompt: SamPrompt; options?: SamRequestOptions },
  deps: { env?: EnvMap; fetchImpl?: FetchLike } = {},
): Promise<SamSegmentation> {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const body = buildSamImageBody(input.imageDataUrl, input.prompt, input.options);
  const response = await fetchImpl(`${META_API_BASE}/responses`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey(env)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new SamUpstreamError(response.status, await upstreamMessage(response));
  }
  const json: unknown = await response.json();
  return parseImageEvents(unaryBodyToEvents(json));
}

export async function uploadVideo(
  input: { bytes: Uint8Array; filename: string },
  deps: { env?: EnvMap; fetchImpl?: FetchLike } = {},
): Promise<string> {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const form = new FormData();
  form.append("purpose", "user_data");
  form.append("file", new Blob([input.bytes as BlobPart], { type: "video/mp4" }), input.filename);
  const response = await fetchImpl(`${META_API_BASE}/files`, {
    method: "POST",
    headers: { Accept: "application/json", Authorization: `Bearer ${apiKey(env)}` },
    body: form,
  });
  if (!response.ok) {
    throw new SamUpstreamError(response.status, await upstreamMessage(response));
  }
  const json = asRecord(await response.json());
  const id = typeof json?.id === "string" ? json.id : "";
  if (!/^file-[A-Za-z0-9_-]{1,120}$/.test(id)) {
    throw new SamUpstreamError(502, "Files API returned no usable file id");
  }
  return id;
}

export async function segmentVideo(
  input: { fileId: string; prompt: SamPrompt; options?: SamRequestOptions },
  deps: { env?: EnvMap; fetchImpl?: FetchLike } = {},
): Promise<SamSegmentation> {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const body = buildSamVideoBody(input.fileId, input.prompt, input.options);
  const response = await fetchImpl(`${META_API_BASE}/responses`, {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      Authorization: `Bearer ${apiKey(env)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new SamUpstreamError(response.status, await upstreamMessage(response));
  }
  return parseVideoEvents(sseTextToEvents(await response.text()));
}
