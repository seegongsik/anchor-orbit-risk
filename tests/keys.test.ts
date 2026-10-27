import { describe, expect, it } from "vitest";
import { keyPresence, resolveModelApiKey } from "../server/keys.js";

describe("key resolution", () => {
  it("reads MODEL_API_KEY ?? META_API_KEY and never returns values from presence", () => {
    expect(resolveModelApiKey({})).toBeUndefined();
    expect(resolveModelApiKey({ META_API_KEY: "alias-only" })).toBe("alias-only");
    expect(
      resolveModelApiKey({ MODEL_API_KEY: "official", META_API_KEY: "alias" }),
    ).toBe("official");
    const presence = keyPresence({ MODEL_API_KEY: "secret", BASETEN_API_KEY: "" });
    expect(presence).toEqual({
      modelApiKeyConfigured: true,
      basetenApiKeyConfigured: false,
    });
    expect(JSON.stringify(presence)).not.toContain("secret");
  });
});
