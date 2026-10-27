import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { maskCentroid, maskFromRuns } from "../src/physics/mask.js";
import {
  buildSamImageBody,
  buildSamVideoBody,
  parseImageEvents,
  promptText,
  SamUpstreamError,
  segmentImage,
  sseTextToEvents,
  unaryBodyToEvents,
} from "../server/sam.js";

// Fixture: Meta's own captured live SAM 3 output (see the file's _source).
const captured = JSON.parse(
  readFileSync(new URL("./fixtures/sam-captured-image.json", import.meta.url), "utf8"),
) as {
  outputText: string;
  expected: {
    bounds: { left: number; top: number; right: number; bottom: number };
    width: number;
    height: number;
    runs: number[];
  };
};

const TINY_JPEG = "data:image/jpeg;base64,/9j/4AAQ";

function unaryBody(text: string, status = "completed") {
  return {
    id: "resp_test",
    status,
    output: [
      {
        id: "msg_test",
        type: "message",
        content: [{ type: "output_text", text }],
      },
    ],
  };
}

describe("SAM 3.1 request shapes (official protocol)", () => {
  it("sends images unary, with the noun phrase and the image as one user message", () => {
    const body = buildSamImageBody(TINY_JPEG, { kind: "concept", text: "  mug " }, { includeConfidence: true });
    expect(body.model).toBe("sam-3.1");
    expect(body.stream).toBe(false);
    expect(body.metadata).toEqual({ include_confidence: "true" });
    expect(body.input).toEqual([
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "mug" },
          { type: "input_image", image_url: TINY_JPEG },
        ],
      },
    ]);
  });

  it("streams video by file id and keeps propagation direction", () => {
    const body = buildSamVideoBody("file-abc_123", { kind: "concept", text: "door" }, { propagationDirection: "forward" });
    expect(body.stream).toBe(true);
    expect(body.metadata).toEqual({ propagation_direction: "forward" });
    expect(() => buildSamVideoBody("not-a-handle", { kind: "concept", text: "door" })).toThrow();
  });

  it("builds point prompts with Meta's object-prompt builder", () => {
    const text = promptText({
      kind: "objects",
      width: 640,
      height: 480,
      objects: [{ id: 1, prompts: [{ points: [{ x: 20, y: 40 }, { x: 30, y: 50, label: "negative" }] }] }],
    });
    expect(text).toBe("<0f>1<|point;x=20;y=40;w=640;h=480|>-<|point;x=30;y=50;w=640;h=480|>");
  });

  it("rejects an empty noun phrase and a non-image data URL", () => {
    expect(() => buildSamImageBody(TINY_JPEG, { kind: "concept", text: "   " })).toThrow();
    expect(() => buildSamImageBody("https://example.com/a.jpg", { kind: "concept", text: "mug" })).toThrow();
  });
});

describe("SAM 3.1 response decoding", () => {
  it("decodes Meta's captured live mask to the expected runs and box", async () => {
    const seg = await parseImageEvents(unaryBodyToEvents(unaryBody(captured.outputText)));
    expect(seg.outcome.status).toBe("completed");
    expect(seg.diagnostics).toEqual([]);
    expect(seg.masks).toHaveLength(1);
    const [mask] = seg.masks;
    expect(mask.objectId).toBe("0");
    expect(mask.bounds).toEqual(captured.expected.bounds);
    expect(mask.width).toBe(captured.expected.width);
    expect(mask.height).toBe(captured.expected.height);
    expect(mask.runs).toEqual(captured.expected.runs);
    const ones = captured.expected.runs.filter((_, i) => i % 2 === 1).reduce((a, b) => a + b, 0);
    expect(mask.pixelCount).toBe(ones);
    // The decoded mask places its centroid inside the box, in source pixels.
    const c = maskCentroid(maskFromRuns(mask));
    expect(c.x).toBeGreaterThan(513);
    expect(c.x).toBeLessThan(524);
    expect(c.y).toBeGreaterThan(371);
    expect(c.y).toBeLessThan(382);
  });

  it("treats an empty lane as zero matches, not an error", async () => {
    const seg = await parseImageEvents(unaryBodyToEvents(unaryBody("")));
    expect(seg.masks).toEqual([]);
    expect(seg.outcome.status).toBe("completed");
  });

  it("reads streamed server-sent events", () => {
    const sse = [
      "event: response.output_text.delta",
      'data: {"type":"response.output_text.delta","delta":"<0f>","item_id":"m","output_index":0,"content_index":0}',
      "",
      'data: {"type":"response.completed"}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const events = sseTextToEvents(sse);
    expect(events.map((e) => e.type)).toEqual(["response.output_text.delta", "response.completed"]);
  });
});

describe("SAM 3.1 transport (fake fetch, no network)", () => {
  it("posts to /responses with the key from the environment", async () => {
    let seenUrl = "";
    let seenAuth = "";
    let seenBody: Record<string, unknown> = {};
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      seenUrl = String(url);
      seenAuth = new Headers(init?.headers).get("Authorization") ?? "";
      seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json(unaryBody(captured.outputText));
    }) as typeof fetch;
    const seg = await segmentImage(
      { imageDataUrl: TINY_JPEG, prompt: { kind: "concept", text: "ball" } },
      { env: { MODEL_API_KEY: "test-key-not-real" }, fetchImpl: fakeFetch },
    );
    expect(seenUrl).toBe("https://api.meta.ai/v1/responses");
    expect(seenAuth).toBe("Bearer test-key-not-real");
    expect(seenBody.stream).toBe(false);
    expect(seg.masks).toHaveLength(1);
  });

  it("surfaces upstream errors with their status", async () => {
    const fakeFetch = (async () => new Response("insufficient credits", { status: 402 })) as typeof fetch;
    await expect(
      segmentImage(
        { imageDataUrl: TINY_JPEG, prompt: { kind: "concept", text: "ball" } },
        { env: { MODEL_API_KEY: "test-key-not-real" }, fetchImpl: fakeFetch },
      ),
    ).rejects.toMatchObject({ status: 402 });
    expect(new SamUpstreamError(429, "x").status).toBe(429);
  });

  it("refuses to call without a key", async () => {
    await expect(
      segmentImage({ imageDataUrl: TINY_JPEG, prompt: { kind: "concept", text: "ball" } }, { env: {} }),
    ).rejects.toMatchObject({ status: 503 });
  });
});
