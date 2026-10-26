import { describe, expect, it } from "vitest";
import { MONTE_CARLO_SEED } from "../src/physics/constants.ts";
import { tipoverMonteCarlo } from "../src/physics/montecarlo.ts";
import {
  expectedSyntheticCom,
  SYNTHETIC_SCENE,
} from "../src/pipeline/synthetic-scene.ts";

describe("monte carlo", () => {
  it("reproduces the same distribution with a fixed seed", () => {
    const input = {
      com: expectedSyntheticCom(),
      edgeA: { x: SYNTHETIC_SCENE.edgeX, y: 0 },
      edgeB: { x: SYNTHETIC_SCENE.edgeX, y: SYNTHETIC_SCENE.height },
      supportToward: SYNTHETIC_SCENE.supportToward,
      metersPerPixel: SYNTHETIC_SCENE.metersPerPixel,
      comSigmaPx: SYNTHETIC_SCENE.comSigmaPx,
      edgeSigmaPx: SYNTHETIC_SCENE.edgeSigmaPx,
      metersPerPixelSigma: 0,
      seed: MONTE_CARLO_SEED,
      iterations: 1000,
    };
    const a = tipoverMonteCarlo(input);
    const b = tipoverMonteCarlo(input);
    expect(a.dMean).toBe(b.dMean);
    expect(a.dStd).toBe(b.dStd);
    expect(a.pUnstable).toBe(b.pUnstable);
    expect(a.iterations).toBe(1000);
  });
});
