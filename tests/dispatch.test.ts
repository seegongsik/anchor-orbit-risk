import { describe, expect, it } from "vitest";
import { dispatchApi } from "../server/dispatch.ts";

describe("API dispatch without keys", () => {
  it("reports key presence without values", async () => {
    const res = await dispatchApi(new Request("http://local/api/status"));
    const body = (await res.json()) as {
      modelApiKeyConfigured: boolean;
      basetenApiKeyConfigured: boolean;
    };
    expect(res.status).toBe(200);
    expect(typeof body.modelApiKeyConfigured).toBe("boolean");
    expect(JSON.stringify(body)).not.toMatch(/sk-|Bearer /);
  });

  it("refuses SAM and model list when no key is configured", async () => {
    const sam = await dispatchApi(
      new Request("http://local/api/sam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concept: "box", imageUrl: "https://example.com/a.jpg" }),
      }),
    );
    const samBody = (await sam.json()) as { ok: boolean; error: string };
    expect(sam.status).toBe(503);
    expect(samBody.ok).toBe(false);
    expect(samBody.error).toMatch(/not configured/);

    const models = await dispatchApi(new Request("http://local/api/models"));
    expect(models.status).toBe(503);
  });
});
