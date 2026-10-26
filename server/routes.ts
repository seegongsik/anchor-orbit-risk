import { extractOutputTextFromResponsesSse, parseSamOutput } from "../src/sam/parser.ts";
import { keyPresence } from "./keys.ts";
import {
  buildSam31ImageRequest,
  listModels,
  metaRequest,
  payloadTooLarge,
} from "./meta-client.ts";

const NO_MODEL_KEY =
  "MODEL_API_KEY / META_API_KEY is not configured. Refusing to invent a model result.";

export async function handleStatus(_request: Request): Promise<Response> {
  const presence = keyPresence();
  return Response.json({
    ...presence,
    note: "Keys are read only on the server. Values are never returned.",
  });
}

export async function handleModels(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }
  if (!keyPresence().modelApiKeyConfigured) {
    return Response.json({ ok: false, error: NO_MODEL_KEY }, { status: 503 });
  }
  const result = await listModels();
  return Response.json(
    { ok: result.ok, status: result.status, bodyText: result.bodyText },
    { status: result.ok ? 200 : result.status || 502 },
  );
}

export async function handleSam(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }
  if (!keyPresence().modelApiKeyConfigured) {
    return Response.json({ ok: false, error: NO_MODEL_KEY }, { status: 503 });
  }
  const raw = await request.text();
  if (payloadTooLarge(new TextEncoder().encode(raw).length)) {
    return Response.json(
      {
        ok: false,
        error:
          "Request exceeds the Vercel Function body limit (4.5 MB, Vercel docs). Use a smaller still, or upload and pass a URL / file_id.",
      },
      { status: 413 },
    );
  }
  let body: { concept?: unknown; imageUrl?: unknown; includeConfidence?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  if (typeof body.concept !== "string" || body.concept.trim() === "") {
    return Response.json(
      { ok: false, error: "concept must be a short noun phrase" },
      { status: 400 },
    );
  }
  if (typeof body.imageUrl !== "string" || body.imageUrl.length === 0) {
    return Response.json(
      { ok: false, error: "imageUrl is required (URL or data URL)" },
      { status: 400 },
    );
  }
  const payload = buildSam31ImageRequest({
    concept: body.concept.trim(),
    imageUrl: body.imageUrl,
    includeConfidence: body.includeConfidence === true,
  });
  const result = await metaRequest("/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(payload),
  });
  if (!result.ok) {
    return Response.json(
      { ok: false, status: result.status, bodyText: result.bodyText },
      { status: result.status || 502 },
    );
  }
  const extracted = extractOutputTextFromResponsesSse(result.bodyText);
  const outputText = extracted.outputText || result.bodyText;
  let records = [];
  try {
    records = parseSamOutput(outputText);
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "SAM parse failed",
        outputText,
      },
      { status: 502 },
    );
  }
  return Response.json({
    ok: true,
    status: result.status,
    outputText,
    records,
    maskRasterNote:
      "Official ~ / ! mask rasters are not decoded here (byte layout 확인 필요). Boxes and mask headers are parsed.",
  });
}
