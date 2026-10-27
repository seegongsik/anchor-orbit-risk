import { describe, expect, it } from "vitest";
import { MUSE_SPARK_OPEN_MODEL, retryAfterMs } from "../server/meta-client.js";

describe("Meta API client builders (no network)", () => {
  it("honours Retry-After and otherwise uses exponential backoff", () => {
    expect(retryAfterMs(0, "2", () => 0)).toBe(2000);
    const low = retryAfterMs(2, null, () => 0);
    const high = retryAfterMs(2, null, () => 1);
    expect(low).toBe(1600);
    expect(high).toBe(1600 + 0.4 * 1600);
  });

  it("keeps the Minwoo-locked Spark Open model id", () => {
    expect(MUSE_SPARK_OPEN_MODEL).toBe("meta-models/muse-spark-open-1026");
  });
});
