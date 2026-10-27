import { resolveBasetenApiKey, resolveModelApiKey, type EnvMap } from "./keys.js";

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
