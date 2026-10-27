/**
 * Muse Spark Open (open weights) served by Baseten through its
 * OpenAI-compatible Chat Completions API.
 * Base URL and model id are from Baseten's hackathon key email (2026-10-26):
 * the key works only with `meta-models/muse-spark-open-1026`.
 */
import { resolveBasetenApiKey, type EnvMap } from "./keys.js";
import { BASETEN_API_BASE, MUSE_SPARK_OPEN_MODEL, type FetchLike } from "./meta-client.js";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type { ToolSpec } from "../src/assessment/tool-spec.js";
import type { ToolSpec } from "../src/assessment/tool-spec.js";

export type SparkReply = {
  content: string;
  reasoningChars: number;
  toolCalls: ToolCall[];
  finishReason: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  latencyMs: number;
};

export class SparkError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "SparkError";
    this.status = status;
  }
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null ? (value as JsonRecord) : null;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function parseChatCompletion(body: unknown): Omit<SparkReply, "latencyMs"> {
  const root = asRecord(body);
  const choice = asRecord(Array.isArray(root?.choices) ? root.choices[0] : null);
  const message = asRecord(choice?.message);
  if (!message) throw new SparkError(502, "Spark returned no message");
  const toolCalls: ToolCall[] = [];
  if (Array.isArray(message.tool_calls)) {
    message.tool_calls.forEach((raw, i) => {
      const call = asRecord(raw);
      const fn = asRecord(call?.function);
      if (!fn || typeof fn.name !== "string") return;
      const args = typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {});
      toolCalls.push({
        id: typeof call?.id === "string" && call.id ? call.id : `tool_${i}`,
        type: "function",
        function: { name: fn.name, arguments: args },
      });
    });
  }
  const usage = asRecord(root?.usage);
  const reasoning = typeof message.reasoning_content === "string" ? message.reasoning_content : "";
  return {
    content: typeof message.content === "string" ? message.content : "",
    reasoningChars: reasoning.length,
    toolCalls,
    finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : "",
    usage: {
      promptTokens: num(usage?.prompt_tokens),
      completionTokens: num(usage?.completion_tokens),
      totalTokens: num(usage?.total_tokens),
    },
  };
}

export async function sparkChat(
  request: {
    messages: ChatMessage[];
    tools?: ToolSpec[];
    maxTokens?: number;
    temperature?: number;
    jsonObject?: boolean;
  },
  deps: { env?: EnvMap; fetchImpl?: FetchLike; timeoutMs?: number; now?: () => number } = {},
): Promise<SparkReply> {
  const env = deps.env ?? process.env;
  const key = resolveBasetenApiKey(env);
  if (!key) throw new SparkError(503, "BASETEN_API_KEY is not configured");
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const body: JsonRecord = {
    model: MUSE_SPARK_OPEN_MODEL,
    messages: request.messages,
    max_tokens: request.maxTokens ?? 2048,
    temperature: request.temperature ?? 0.2,
  };
  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools;
    body.tool_choice = "auto";
  }
  if (request.jsonObject) body.response_format = { type: "json_object" };
  let lastStatus = 0;
  let lastMessage = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const started = now();
    const response = await fetchImpl(`${BASETEN_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 90_000),
    });
    if (response.ok) {
      const parsed = parseChatCompletion(await response.json());
      return { ...parsed, latencyMs: now() - started };
    }
    lastStatus = response.status;
    const text = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim();
    lastMessage = text.length > 300 ? `${text.slice(0, 300)}…` : text;
    if (response.status !== 429 && response.status < 500) break;
    await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
  }
  throw new SparkError(lastStatus || 502, lastMessage || "Spark request failed");
}

/** Extracts the first JSON object from model text (fenced or bare). */
export function extractJsonObject(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  if (start === -1) throw new Error("no JSON object in the model reply");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i += 1) {
    const ch = candidate[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(candidate.slice(start, i + 1));
    }
  }
  throw new Error("unterminated JSON object in the model reply");
}
