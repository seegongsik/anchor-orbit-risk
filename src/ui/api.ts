/** Browser side of the server routes. No key ever reaches this file. */
import type { Hazard } from "../assessment/types.js";
import type { RunMask } from "../physics/mask.js";
import type { Vec2 } from "../physics/geometry.js";
import type { AssessmentTable } from "../risk/table.js";

export type ApiStatus = {
  modelApiKeyConfigured: boolean;
  basetenApiKeyConfigured: boolean;
  models?: { segmentation: string; agent: string };
};

export type SamMaskOut = RunMask & { objectId: string; pixelCount: number; confidence?: number };

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!response.ok || json.ok === false) {
    throw new ApiError(response.status, json.error ?? `request failed (${response.status})`);
  }
  return json as T;
}

export async function getStatus(): Promise<ApiStatus | null> {
  try {
    const response = await fetch("/api/status");
    if (!response.ok) return null;
    return (await response.json()) as ApiStatus;
  } catch {
    return null;
  }
}

export async function samAtPoint(
  imageDataUrl: string,
  size: { width: number; height: number },
  point: Vec2,
): Promise<{ masks: SamMaskOut[]; latencyMs: number }> {
  return postJson("/api/sam", {
    imageDataUrl,
    prompt: { kind: "points", width: size.width, height: size.height, points: [{ x: point.x, y: point.y }] },
    includeConfidence: true,
  });
}

export async function samConcept(imageDataUrl: string, text: string): Promise<{ masks: SamMaskOut[]; latencyMs: number }> {
  return postJson("/api/sam", { imageDataUrl, prompt: { kind: "concept", text }, includeConfidence: true });
}

export async function survey(imageDataUrl: string): Promise<{ hazards: Hazard[]; tokens: number; latencyMs: number }> {
  return postJson("/api/survey", { imageDataUrl });
}

export async function sparkCheck(): Promise<{
  reply: string;
  latencyMs: number;
  toolCallsSupported: boolean | null;
  toolError?: string;
}> {
  return postJson("/api/spark-check", {});
}

export type TraceLine =
  | { type: "mode"; mode: string; reason?: string }
  | { type: "turn"; n: number; toolCalls: string[]; tokens: number; latencyMs: number; reasoningChars: number }
  | { type: "tool"; id: string; name: string; args: unknown; result?: Record<string, unknown>; error?: string }
  | { type: "check"; ok: boolean; problems: string[] }
  | { type: "final"; table: AssessmentTable }
  | { type: "error"; message: string };

/** Streams the agent's trace; resolves with the final table or throws. */
export async function assess(
  body: {
    hazards: Hazard[];
    place: string;
    imageDataUrl?: string;
    nudges?: { nudgesPerDay: number; nudgeStdM: number; horizonDays: number };
  },
  onLine: (line: TraceLine) => void,
): Promise<AssessmentTable> {
  const response = await fetch("/api/assess", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) {
    const json = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(response.status, json.error ?? `assessment failed (${response.status})`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let table: AssessmentTable | null = null;
  let failure = "";
  const take = (line: string) => {
    if (!line.trim()) return;
    const parsed = JSON.parse(line) as TraceLine;
    onLine(parsed);
    if (parsed.type === "final") table = parsed.table;
    if (parsed.type === "error") failure = parsed.message;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      take(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  take(buffer);
  if (table) return table;
  throw new ApiError(502, failure || "the agent ended without a table");
}
