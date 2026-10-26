import { describe, expect, it } from "vitest";
import {
  expectedSyntheticCom,
  expectedSyntheticDMetres,
  SYNTHETIC_SCENE,
  syntheticObjectMask,
} from "../src/pipeline/synthetic-scene.ts";
import { maskCentroid, tipoverFromMask, tipoverMargin } from "../src/physics/tipover.ts";

describe("tip-over margin", () => {
  it("recovers COM and d of the synthetic rectangle within 1%", () => {
    const mask = syntheticObjectMask();
    const com = maskCentroid(mask);
    const expectedCom = expectedSyntheticCom();
    expect(com.x).toBeCloseTo(expectedCom.x, 8);
    expect(com.y).toBeCloseTo(expectedCom.y, 8);
    const tip = tipoverFromMask({
      mask,
      edgeA: { x: SYNTHETIC_SCENE.edgeX, y: 0 },
      edgeB: { x: SYNTHETIC_SCENE.edgeX, y: SYNTHETIC_SCENE.height },
      supportToward: SYNTHETIC_SCENE.supportToward,
      metersPerPixel: SYNTHETIC_SCENE.metersPerPixel,
    });
    const expected = expectedSyntheticDMetres();
    expect(Math.abs(tip.d.value - expected) / expected).toBeLessThan(0.01);
    expect(tip.currentlyUnstable).toBe(false);
  });

  it("marks COM past the edge as currently unstable", () => {
    const tip = tipoverMargin({
      com: { x: 280, y: 200 },
      edgeA: { x: 250, y: 0 },
      edgeB: { x: 250, y: 400 },
      supportToward: { x: 40, y: 300 },
      metersPerPixel: 0.002,
    });
    expect(tip.currentlyUnstable).toBe(true);
    expect(tip.d.value).toBeCloseTo(-0.06, 8);
  });
});
