import { STANDARD_G } from "../physics/constants.js";
import {
  bandFor,
  ENERGY_REFERENCES,
  LADDER_REFERENCE,
  LIKELIHOOD_BANDS,
  MATRIX,
  RISK_LEVELS,
  SEVERITY_BANDS,
  SHARP_DOWN_SEVERITY_STEP,
  type Band,
  type Reference,
} from "./config.js";
import { normalCdf, normalInv } from "./stats.js";

export type Nudges = {
  /** Expected small disturbances per day. Assumption. */
  nudgesPerDay: number;
  /** Standard deviation of the displacement per nudge, metres. Assumption. */
  nudgeStdM: number;
  /** Period the likelihood refers to, days. */
  horizonDays: number;
};

function checkNudges(n: Nudges): void {
  if (!(n.nudgesPerDay >= 0) || !(n.nudgeStdM >= 0) || !(n.horizonDays >= 0)) {
    throw new Error("nudge assumptions must be non-negative numbers");
  }
}

/**
 * Probability that an object with margin d goes over the edge within the
 * horizon, when random nudges move it back and forth. The position is a random
 * walk with N = nudges/day × days steps of std σ; by the reflection principle
 * P(max displacement toward the edge ≥ d) ≈ 2·(1 − Φ(d / (σ·√N))).
 * A margin at or below zero is already unstable: P = 1.
 */
export function fallProbability(dM: number, nudges: Nudges): number {
  checkNudges(nudges);
  if (dM <= 0) return 1;
  const spread = nudges.nudgeStdM * Math.sqrt(nudges.nudgesPerDay * nudges.horizonDays);
  if (spread === 0) return 0;
  return Math.min(1, 2 * (1 - normalCdf(dM / spread)));
}

/** Mean fall probability over the margin samples of a measurement Monte Carlo. */
export function fallProbabilityFromSamples(samples: ArrayLike<number>, nudges: Nudges): number {
  if (samples.length === 0) throw new Error("no margin samples");
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += fallProbability(samples[i], nudges);
  return sum / samples.length;
}

/** The margin that brings the fall probability down to pTarget. */
export function requiredMargin(pTarget: number, nudges: Nudges): number {
  checkNudges(nudges);
  if (!(pTarget > 0 && pTarget < 1)) throw new Error("target probability must be in (0, 1)");
  const spread = nudges.nudgeStdM * Math.sqrt(nudges.nudgesPerDay * nudges.horizonDays);
  return spread * normalInv(1 - pTarget / 2);
}

export function likelihoodGrade(pFall: number): Band {
  return bandFor(LIKELIHOOD_BANDS, pFall);
}

export type DropResult = {
  impactSpeedMps: number;
  energyLowJ: number;
  energyHighJ: number;
  references: Reference[];
};

export function dropEnergy(input: { massLowKg: number; massHighKg: number; heightM: number }): DropResult {
  const { massLowKg, massHighKg, heightM } = input;
  if (!(massLowKg >= 0) || !(massHighKg >= massLowKg)) {
    throw new Error("mass range must satisfy 0 <= low <= high");
  }
  if (!(heightM >= 0)) throw new Error("height must be non-negative");
  return {
    impactSpeedMps: Math.sqrt(2 * STANDARD_G * heightM),
    energyLowJ: massLowKg * STANDARD_G * heightM,
    energyHighJ: massHighKg * STANDARD_G * heightM,
    references: ENERGY_REFERENCES,
  };
}

export function severityGrade(energyJ: number, sharpEdgeDown: boolean): { band: Band; raisedForSharpness: boolean } {
  if (!(energyJ >= 0)) throw new Error("energy must be non-negative");
  const byEnergy = bandFor(SEVERITY_BANDS, energyJ);
  if (!sharpEdgeDown) return { band: byEnergy, raisedForSharpness: false };
  const grade = Math.min(MATRIX.severityLevels, byEnergy.grade + SHARP_DOWN_SEVERITY_STEP);
  const band = SEVERITY_BANDS.find((b) => b.grade === grade) ?? byEnergy;
  return { band, raisedForSharpness: grade !== byEnergy.grade };
}

export function riskRating(likelihood: number, severity: number): { score: number; level: Band } {
  if (!Number.isInteger(likelihood) || likelihood < 1 || likelihood > MATRIX.likelihoodLevels) {
    throw new Error(`likelihood grade must be an integer 1..${MATRIX.likelihoodLevels}`);
  }
  if (!Number.isInteger(severity) || severity < 1 || severity > MATRIX.severityLevels) {
    throw new Error(`severity grade must be an integer 1..${MATRIX.severityLevels}`);
  }
  const score = likelihood * severity;
  return { score, level: bandFor(RISK_LEVELS, score) };
}

export type LadderCheck = {
  angleFromGroundDeg: number;
  referenceDeg: number;
  deviationDeg: number;
  verdict: "ok" | "too_steep" | "too_shallow";
};

export function ladderCheck(angleFromGroundDeg: number): LadderCheck {
  const referenceDeg = (Math.atan(LADDER_REFERENCE.rise / LADDER_REFERENCE.run) * 180) / Math.PI;
  const deviationDeg = angleFromGroundDeg - referenceDeg;
  const verdict =
    deviationDeg > LADDER_REFERENCE.toleranceDeg
      ? "too_steep"
      : deviationDeg < -LADDER_REFERENCE.toleranceDeg
        ? "too_shallow"
        : "ok";
  return { angleFromGroundDeg, referenceDeg, deviationDeg, verdict };
}
