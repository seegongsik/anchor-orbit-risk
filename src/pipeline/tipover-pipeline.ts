import { MONTE_CARLO_ITERATIONS, MONTE_CARLO_SEED } from "../physics/constants.ts";
import type { Evidence, MaskSource } from "../physics/evidence.ts";
import { tipoverMonteCarlo } from "../physics/montecarlo.ts";
import { tipoverFromMask, type BinaryMask, type TipoverResult } from "../physics/tipover.ts";
import type { Vec2 } from "../physics/geometry.ts";
import {
  imageDownFromSample,
  type GravitySample,
} from "../sensors/gravity.ts";

export type PipelineInput = {
  mask: BinaryMask;
  edgeA: Vec2;
  edgeB: Vec2;
  supportToward: Vec2;
  metersPerPixel: number;
  metersPerPixelSigma: number;
  comSigmaPx: number;
  edgeSigmaPx: number;
  maskSource: MaskSource;
  gravity: GravitySample;
  assumptions: string[];
  seed?: number;
  iterations?: number;
};

export type PipelineResult = TipoverResult & {
  pixelCount: number;
  pUnstable: number;
  mc: {
    seed: number;
    iterations: number;
    dMean: number;
    dStd: number;
  };
  gravity: ReturnType<typeof imageDownFromSample>;
  evidence: Evidence[];
  maskSource: MaskSource;
  assumptions: string[];
};

export function runTipoverPipeline(input: PipelineInput): PipelineResult {
  const gravity = imageDownFromSample(input.gravity);
  const tip = tipoverFromMask({
    mask: input.mask,
    edgeA: input.edgeA,
    edgeB: input.edgeB,
    supportToward: input.supportToward,
    metersPerPixel: input.metersPerPixel,
    source: input.maskSource === "synthetic" ? "synthetic" : "computed",
  });
  const mc = tipoverMonteCarlo({
    com: tip.com,
    edgeA: input.edgeA,
    edgeB: input.edgeB,
    supportToward: input.supportToward,
    metersPerPixel: input.metersPerPixel,
    comSigmaPx: input.comSigmaPx,
    edgeSigmaPx: input.edgeSigmaPx,
    metersPerPixelSigma: input.metersPerPixelSigma,
    seed: input.seed ?? MONTE_CARLO_SEED,
    iterations: input.iterations ?? MONTE_CARLO_ITERATIONS,
  });
  const assumptions = [
    ...input.assumptions,
    "Uniform density unless a mass-distribution hint is supplied.",
    `COM jitter σ = ${input.comSigmaPx} px (assumption unless measured).`,
    `Edge jitter σ = ${input.edgeSigmaPx} px (assumption unless measured).`,
    "World-down is −accelerationIncludingGravity at rest. Real-device sign: 확인 필요.",
  ];
  const evidence: Evidence[] = [
    {
      quantity: "d",
      value: tip.d.value,
      unit: "m",
      tool: "tipoverFromMask",
      inputs: {
        com: tip.com,
        edgeA: input.edgeA,
        edgeB: input.edgeB,
        supportToward: input.supportToward,
        metersPerPixel: input.metersPerPixel,
        pixelCount: tip.pixelCount,
      },
      assumptions,
      maskSource: input.maskSource,
    },
    {
      quantity: "P(currently unstable)",
      value: mc.pUnstable,
      unit: "1",
      tool: "tipoverMonteCarlo",
      inputs: {
        seed: mc.seed,
        iterations: mc.iterations,
        comSigmaPx: input.comSigmaPx,
        edgeSigmaPx: input.edgeSigmaPx,
        metersPerPixelSigma: input.metersPerPixelSigma,
      },
      assumptions,
      maskSource: input.maskSource,
    },
  ];
  return {
    ...tip,
    pixelCount: tip.pixelCount,
    pUnstable: mc.pUnstable,
    mc: {
      seed: mc.seed,
      iterations: mc.iterations,
      dMean: mc.dMean,
      dStd: mc.dStd,
    },
    gravity,
    evidence,
    maskSource: input.maskSource,
    assumptions,
  };
}
