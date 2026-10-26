import { resolveBasetenApiKey, resolveModelApiKey, type EnvMap } from "./keys.ts";

export const META_API_BASE = "https://api.meta.ai/v1";
export const BASETEN_API_BASE = "https://inference.baseten.co/v1";
export const MUSE_SPARK_OPEN_MODEL = "meta-models/muse-spark-open-1026";
export const MUSE_WONDER_MODEL = "muse-wonder-1.0";
export const MUSE_SPARK_MODEL = "muse-spark-1.3";
export const SAM_MODEL = "sam-3.1";

export const VERCEL_BODY_LIMIT_BYTES = 4_500_000;

export type FetchLike = typeof fetch;

export type HttpResult = {
  ok: boolean;
  status: number;
  bodyText: string;
};

function requireModelKey(env: EnvMap): string {
  const key = resolveModelApiKey(env);
  if (!key) {
    throw new Error("MODEL_API_KEY / META_API_KEY is not configured");
  }
  return key;
}

export function retryAfterMs(
  attempt: number,
  retryAfterHeader: string | null,
  rng: () => number,
): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  }
  const base = Math.min(8000, 400 * 2 ** attempt);
  return base + rng() * 0.4 * base;
}

export async function metaRequest(
  path: string,
  init: RequestInit,
  options?: {
    env?: EnvMap;
    fetchImpl?: FetchLike;
    maxRetries?: number;
    rng?: () => number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<HttpResult> {
  const env = options?.env ?? process.env;
  const apiKey = requireModelKey(env);
  const fetchImpl = options?.fetchImpl ?? fetch;
  const maxRetries = options?.maxRetries ?? 4;
  const rng = options?.rng ?? Math.random;
  const sleep =
    options?.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const url = `${META_API_BASE}${path}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  let last: HttpResult = { ok: false, status: 0, bodyText: "not sent" };
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetchImpl(url, { ...init, headers });
    const bodyText = await response.text();
    last = { ok: response.ok, status: response.status, bodyText };
    if (response.status !== 429 || attempt === maxRetries) return last;
    await sleep(retryAfterMs(attempt, response.headers.get("Retry-After"), rng));
  }
  return last;
}

export function listModels(options?: {
  env?: EnvMap;
  fetchImpl?: FetchLike;
}): Promise<HttpResult> {
  return metaRequest(
    "/models",
    { method: "GET" },
    { env: options?.env, fetchImpl: options?.fetchImpl, maxRetries: 0 },
  );
}

export type SamImageRequest = {
  concept: string;
  imageUrl: string;
  includeConfidence?: boolean;
};

export function buildSam31ImageRequest(input: SamImageRequest): unknown {
  return {
    model: SAM_MODEL,
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: input.concept },
          { type: "input_image", image_url: input.imageUrl },
        ],
      },
    ],
    stream: true,
    metadata: {
      mask_encoding: "one_bit",
      ...(input.includeConfidence ? { include_confidence: "true" } : {}),
    },
  };
}

export function buildSam31VideoRequest(input: {
  concept: string;
  videoUrl?: string;
  fileId?: string;
  propagationDirection?: "both" | "forward" | "backward";
}): unknown {
  const media = input.fileId
    ? { type: "input_video", file_id: input.fileId }
    : { type: "input_video", video_url: input.videoUrl };
  return {
    model: SAM_MODEL,
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: input.concept }, media],
      },
    ],
    stream: true,
    metadata: {
      mask_encoding: "one_bit",
      ...(input.propagationDirection
        ? { propagation_direction: input.propagationDirection }
        : {}),
    },
  };
}

export function buildObjectPrompt(input: {
  frame: number;
  width: number;
  height: number;
  objects: Array<{
    id: number;
    box?: { x1: number; y1: number; x2: number; y2: number };
    points?: Array<{ x: number; y: number; negative?: boolean }>;
  }>;
}): string {
  const parts = input.objects.map((obj) => {
    const tokens: string[] = [];
    if (obj.box) {
      tokens.push(
        `<|box;x1=${obj.box.x1};y1=${obj.box.y1};x2=${obj.box.x2};y2=${obj.box.y2};w=${input.width};h=${input.height}|>`,
      );
    }
    for (const point of obj.points ?? []) {
      const prefix = point.negative ? "-" : "";
      tokens.push(
        `${prefix}<|point;x=${point.x};y=${point.y};w=${input.width};h=${input.height}|>`,
      );
    }
    return `${obj.id}${tokens.join("")}`;
  });
  return `<${input.frame}f>${parts.join(",")}`;
}

export function buildWonderProbeRequest(): unknown {
  return {
    model: MUSE_WONDER_MODEL,
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Reply with the single word pong." }],
      },
    ],
    stream: false,
  };
}

export function buildBasetenHeaders(env: EnvMap = process.env): Headers {
  const key = resolveBasetenApiKey(env);
  if (!key) {
    throw new Error("BASETEN_API_KEY is not configured");
  }
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${key}`);
  headers.set("Content-Type", "application/json");
  return headers;
}

export function payloadTooLarge(byteLength: number): boolean {
  return byteLength > VERCEL_BODY_LIMIT_BYTES;
}
