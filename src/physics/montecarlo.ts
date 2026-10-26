import { MONTE_CARLO_ITERATIONS, MONTE_CARLO_SEED } from "./constants.ts";
import type { Vec2 } from "./geometry.ts";
import { quantity } from "./quantity.ts";
import { gauss, mulberry32 } from "./rng.ts";
import { tipoverMargin } from "./tipover.ts";

export type TipoverMcInput = {
  com: Vec2;
  edgeA: Vec2;
  edgeB: Vec2;
  supportToward: Vec2;
  metersPerPixel: number;
  comSigmaPx: number;
  edgeSigmaPx: number;
  metersPerPixelSigma: number;
  iterations?: number;
  seed?: number;
};

export type TipoverMcResult = {
  seed: number;
  iterations: number;
  dMean: number;
  dStd: number;
  pUnstable: number;
  d: ReturnType<typeof quantity>;
};

export function tipoverMonteCarlo(input: TipoverMcInput): TipoverMcResult {
  const iterations = input.iterations ?? MONTE_CARLO_ITERATIONS;
  if (iterations < 1000) {
    throw new Error("Monte Carlo requires at least 1000 iterations");
  }
  const seed = input.seed ?? MONTE_CARLO_SEED;
  const rng = mulberry32(seed);
  const samples = new Float64Array(iterations);
  let unstable = 0;
  let sum = 0;
  for (let i = 0; i < iterations; i += 1) {
    const com = {
      x: input.com.x + gauss(rng) * input.comSigmaPx,
      y: input.com.y + gauss(rng) * input.comSigmaPx,
    };
    const edgeA = {
      x: input.edgeA.x + gauss(rng) * input.edgeSigmaPx,
      y: input.edgeA.y + gauss(rng) * input.edgeSigmaPx,
    };
    const edgeB = {
      x: input.edgeB.x + gauss(rng) * input.edgeSigmaPx,
      y: input.edgeB.y + gauss(rng) * input.edgeSigmaPx,
    };
    const mpp = Math.max(
      1e-9,
      input.metersPerPixel + gauss(rng) * input.metersPerPixelSigma,
    );
    const one = tipoverMargin({
      com,
      edgeA,
      edgeB,
      supportToward: input.supportToward,
      metersPerPixel: mpp,
    });
    samples[i] = one.d.value;
    sum += one.d.value;
    if (one.currentlyUnstable) unstable += 1;
  }
  const mean = sum / iterations;
  let varSum = 0;
  for (const value of samples) {
    const d = value - mean;
    varSum += d * d;
  }
  const std = Math.sqrt(varSum / iterations);
  return {
    seed,
    iterations,
    dMean: mean,
    dStd: std,
    pUnstable: unstable / iterations,
    d: quantity(mean, "m", {
      uncertainty: std,
      uncertaintyKind: "std",
      source: "computed",
    }),
  };
}
