import { describe, expect, it } from "vitest";
import { runTipoverPipeline } from "../src/pipeline/tipover-pipeline.ts";
import {
  expectedSyntheticDMetres,
  SYNTHETIC_SCENE,
  syntheticObjectMask,
} from "../src/pipeline/synthetic-scene.ts";

describe("tip-over pipeline", () => {
  it("runs mask → d → Monte Carlo on the synthetic scene", () => {
    const result = runTipoverPipeline({
      mask: syntheticObjectMask(),
      edgeA: { x: SYNTHETIC_SCENE.edgeX, y: 0 },
      edgeB: { x: SYNTHETIC_SCENE.edgeX, y: SYNTHETIC_SCENE.height },
      supportToward: SYNTHETIC_SCENE.supportToward,
      metersPerPixel: SYNTHETIC_SCENE.metersPerPixel,
      metersPerPixelSigma: 0,
      comSigmaPx: SYNTHETIC_SCENE.comSigmaPx,
      edgeSigmaPx: SYNTHETIC_SCENE.edgeSigmaPx,
      maskSource: "synthetic",
      gravity: {
        accelerationIncludingGravity: SYNTHETIC_SCENE.accelerationIncludingGravity,
        screenAngleDeg: 0,
        timestampMs: 0,
      },
      assumptions: ["synthetic fixture"],
    });
    const expected = expectedSyntheticDMetres();
    expect(Math.abs(result.d.value - expected) / expected).toBeLessThan(0.01);
    expect(result.maskSource).toBe("synthetic");
    expect(result.evidence[0].tool).toBe("tipoverFromMask");
    expect(result.mc.iterations).toBeGreaterThanOrEqual(1000);
    expect(result.gravity.v).toBeGreaterThan(0);
  });
});
