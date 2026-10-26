import { describe, expect, it } from "vitest";
import {
  buildObjectPrompt,
  buildSam31ImageRequest,
  MUSE_SPARK_OPEN_MODEL,
  retryAfterMs,
  SAM_MODEL,
} from "../server/meta-client.ts";

describe("Meta API client builders (no network)", () => {
  it("builds a SAM 3.1 image request from the published field names", () => {
    const body = buildSam31ImageRequest({
      concept: "box",
      imageUrl: "https://example.com/a.jpg",
      includeConfidence: true,
    }) as {
      model: string;
      stream: boolean;
      metadata: { mask_encoding: string; include_confidence: string };
    };
    expect(body.model).toBe(SAM_MODEL);
    expect(body.stream).toBe(true);
    expect(body.metadata.mask_encoding).toBe("one_bit");
    expect(body.metadata.include_confidence).toBe("true");
  });

  it("builds a box/point prompt in the documented token grammar", () => {
    const text = buildObjectPrompt({
      frame: 0,
      width: 1800,
      height: 1200,
      objects: [
        { id: 1, box: { x1: 444, y1: 626, x2: 675, y2: 849 } },
        {
          id: 2,
          points: [
            { x: 1430, y: 700 },
            { x: 1300, y: 450, negative: true },
          ],
        },
      ],
    });
    expect(text).toBe(
      "<0f>1<|box;x1=444;y1=626;x2=675;y2=849;w=1800;h=1200|>,2<|point;x=1430;y=700;w=1800;h=1200|>-<|point;x=1300;y=450;w=1800;h=1200|>",
    );
  });

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
