import { runAssessment, type TraceEvent } from "./agent.js";
import { clientKey, reserve, usage, type BudgetKind } from "./budget.js";
import { keyPresence } from "./keys.js";
import { listModels, MUSE_SPARK_OPEN_MODEL, SAM_MODEL, VERCEL_BODY_LIMIT_BYTES } from "./meta-client.js";
import { SamUpstreamError, segmentImage, type SamPrompt } from "./sam.js";
import { SparkError, sparkChat, type ToolSpec } from "./spark.js";
import { surveyScene } from "./survey.js";
import { imageDataUrl, InputError, sanitizeHazards, sanitizeNudges } from "./validate.js";

const NO_MODEL_KEY = "MODEL_API_KEY / META_API_KEY is not configured on the server. No model result is invented.";
const NO_BASETEN_KEY = "BASETEN_API_KEY is not configured on the server. No model result is invented.";

type JsonRecord = Record<string, unknown>;

function fail(status: number, error: string, extra: JsonRecord = {}): Response {
  return Response.json({ ok: false, error, ...extra }, { status });
}

async function readJson(request: Request): Promise<JsonRecord> {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > VERCEL_BODY_LIMIT_BYTES) {
    throw new InputError("The request is over the 4.5 MB function body limit. Send a smaller photo.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InputError("The body is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new InputError("The body must be a JSON object.");
  }
  return parsed as JsonRecord;
}

function guard(kind: BudgetKind, request: Request, calls = 1): Response | null {
  const decision = reserve(kind, clientKey(request), calls);
  return decision.ok ? null : fail(decision.status, decision.reason);
}

function errorResponse(error: unknown): Response {
  if (error instanceof InputError) return fail(400, error.message);
  if (error instanceof SamUpstreamError) return fail(error.status === 503 ? 503 : 502, `SAM 3.1: ${error.message}`, { upstreamStatus: error.status });
  if (error instanceof SparkError) return fail(error.status === 503 ? 503 : 502, `Muse Spark Open: ${error.message}`, { upstreamStatus: error.status });
  return fail(500, error instanceof Error ? error.message : "unexpected error");
}

export async function handleStatus(_request: Request): Promise<Response> {
  return Response.json({
    ...keyPresence(),
    models: { segmentation: SAM_MODEL, agent: MUSE_SPARK_OPEN_MODEL },
    budget: { sam: usage("sam"), spark: usage("spark") },
    note: "Keys are read only on the server. Values are never returned.",
  });
}

export async function handleModels(request: Request): Promise<Response> {
  if (request.method !== "GET") return fail(405, "method not allowed");
  if (!keyPresence().modelApiKeyConfigured) return fail(503, NO_MODEL_KEY);
  const result = await listModels();
  return Response.json(
    { ok: result.ok, status: result.status, bodyText: result.bodyText },
    { status: result.ok ? 200 : result.status || 502 },
  );
}

function samPrompt(value: unknown): SamPrompt {
  const p = (typeof value === "object" && value !== null ? value : {}) as JsonRecord;
  if (p.kind === "concept" && typeof p.text === "string") return { kind: "concept", text: p.text };
  if (p.kind === "points") {
    const width = Number(p.width);
    const height = Number(p.height);
    const points = Array.isArray(p.points) ? p.points : [];
    if (!(width > 0 && height > 0) || points.length === 0 || points.length > 8) {
      throw new InputError("a points prompt needs the image size and 1 to 8 points");
    }
    return {
      kind: "objects",
      width: Math.round(width),
      height: Math.round(height),
      objects: [
        {
          id: 1,
          prompts: [
            {
              points: points.map((raw) => {
                const pt = (typeof raw === "object" && raw !== null ? raw : {}) as JsonRecord;
                const x = Math.max(0, Math.min(Math.round(width) - 1, Math.floor(Number(pt.x))));
                const y = Math.max(0, Math.min(Math.round(height) - 1, Math.floor(Number(pt.y))));
                return { x, y, label: pt.label === "negative" ? ("negative" as const) : ("positive" as const) };
              }),
            },
          ],
        },
      ],
    };
  }
  throw new InputError('prompt must be {"kind":"concept","text":...} or {"kind":"points",...}');
}

export async function handleSam(request: Request): Promise<Response> {
  if (request.method !== "POST") return fail(405, "method not allowed");
  if (!keyPresence().modelApiKeyConfigured) return fail(503, NO_MODEL_KEY);
  try {
    const body = await readJson(request);
    const image = imageDataUrl(body.imageDataUrl, true) as string;
    const prompt = samPrompt(body.prompt);
    const blocked = guard("sam", request);
    if (blocked) return blocked;
    const started = Date.now();
    const seg = await segmentImage({
      imageDataUrl: image,
      prompt,
      options: { includeConfidence: body.includeConfidence === true },
    });
    return Response.json({ ok: true, latencyMs: Date.now() - started, ...seg });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleSurvey(request: Request): Promise<Response> {
  if (request.method !== "POST") return fail(405, "method not allowed");
  if (!keyPresence().basetenApiKeyConfigured) return fail(503, NO_BASETEN_KEY);
  try {
    const body = await readJson(request);
    const image = imageDataUrl(body.imageDataUrl, true) as string;
    const blocked = guard("spark", request, 2);
    if (blocked) return blocked;
    const result = await surveyScene(image, (req) => sparkChat(req));
    return Response.json({ ok: true, model: MUSE_SPARK_OPEN_MODEL, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleAssess(request: Request): Promise<Response> {
  if (request.method !== "POST") return fail(405, "method not allowed");
  if (!keyPresence().basetenApiKeyConfigured) return fail(503, NO_BASETEN_KEY);
  let hazards;
  let image: string | undefined;
  let place = "";
  let nudges;
  try {
    const body = await readJson(request);
    hazards = sanitizeHazards(body.hazards);
    nudges = sanitizeNudges(body.nudges);
    image = imageDataUrl(body.imageDataUrl, false);
    place = typeof body.place === "string" ? body.place.slice(0, 80) : "";
  } catch (error) {
    return errorResponse(error);
  }
  const blocked = guard("spark", request, 14);
  if (blocked) return blocked;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: TraceEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        await runAssessment(
          { hazards, place, imageDataUrl: image, models: [SAM_MODEL, MUSE_SPARK_OPEN_MODEL], nudges },
          { chat: (req) => sparkChat(req), onEvent: send },
        );
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : String(error) });
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const PROBE_TOOL: ToolSpec = {
  type: "function",
  function: {
    name: "record_number",
    description: "Record one number.",
    parameters: {
      type: "object",
      properties: { value: { type: "number" } },
      required: ["value"],
      additionalProperties: false,
    },
  },
};

/** Two small calls: does the deployment answer, and does it emit native tool calls? */
export async function handleSparkCheck(request: Request): Promise<Response> {
  if (request.method !== "POST") return fail(405, "method not allowed");
  if (!keyPresence().basetenApiKeyConfigured) return fail(503, NO_BASETEN_KEY);
  const blocked = guard("spark", request, 2);
  if (blocked) return blocked;
  try {
    const hello = await sparkChat({ messages: [{ role: "user", content: "Reply with the single word: ready" }], maxTokens: 50 });
    let toolCallsSupported: boolean | null = null;
    let toolError = "";
    let toolLatencyMs = 0;
    try {
      const probe = await sparkChat({
        messages: [{ role: "user", content: "Call record_number with the value 7." }],
        tools: [PROBE_TOOL],
        maxTokens: 200,
      });
      toolLatencyMs = probe.latencyMs;
      toolCallsSupported = probe.toolCalls.some((c) => c.function.name === "record_number");
    } catch (error) {
      toolError = error instanceof Error ? error.message : String(error);
      toolCallsSupported = false;
    }
    return Response.json({
      ok: true,
      model: MUSE_SPARK_OPEN_MODEL,
      reply: hello.content.slice(0, 80),
      latencyMs: hello.latencyMs,
      tokens: hello.usage.totalTokens,
      toolCallsSupported,
      toolLatencyMs,
      ...(toolError ? { toolError } : {}),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
