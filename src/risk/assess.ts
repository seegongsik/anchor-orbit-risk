import { STANDARD_G } from "../physics/constants.js";
import {
  bandFor,
  CONTROL_TARGET_RANGE_M,
  LADDER_REFERENCE,
  LIKELIHOOD_LABELS,
  MARGIN_LIKELIHOOD_EDGES_M,
  MARGIN_LIKELIHOOD_REST_GRADE,
  MATRIX,
  RISK_LEVELS,
  SEVERITY_BANDS,
  SHARP_DOWN_SEVERITY_STEP,
  type Band,
  type Text,
} from "./config.js";

export type Suggested = { grade: number; label: Text };

/**
 * Suggested likelihood grade from the lower 5% of the measured margin (metres).
 * A rule over measured geometry, not a probability of falling.
 */
export function marginLikelihood(dP5M: number): Suggested {
  if (!Number.isFinite(dP5M)) throw new Error("margin must be a finite number");
  let grade: number = MARGIN_LIKELIHOOD_REST_GRADE;
  for (const edge of MARGIN_LIKELIHOOD_EDGES_M) {
    if (edge.inclusive ? dP5M <= edge.upTo : dP5M < edge.upTo) {
      grade = edge.grade;
      break;
    }
  }
  return { grade, label: LIKELIHOOD_LABELS[grade] };
}

export type MoveTarget = {
  targetM: number;
  moveByM: number;
  residual: Suggested;
};

/**
 * How far to move an object inward so that the lower 5% of its margin reaches
 * the target, and the likelihood that margin suggests. Moving by d changes the
 * margin by d because the edge line stays where it is.
 */
export function moveTarget(dP5M: number, targetM: number): MoveTarget {
  if (!(targetM >= CONTROL_TARGET_RANGE_M.min && targetM <= CONTROL_TARGET_RANGE_M.max)) {
    throw new Error(`target margin must be between ${CONTROL_TARGET_RANGE_M.min} and ${CONTROL_TARGET_RANGE_M.max} m`);
  }
  const moveByM = Math.max(0, targetM - dP5M);
  return { targetM, moveByM, residual: marginLikelihood(Math.max(targetM, dP5M)) };
}

export type DropResult = {
  impactSpeedMps: number;
  energyLowJ: number;
  energyHighJ: number;
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
  };
}

/** Suggested severity grade from the impact energy, one grade per decade. */
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

/** The quarter-length rule angle: cos(angle) = base / working length = 1/4. */
export function ladderReferenceDeg(): number {
  return (Math.acos(LADDER_REFERENCE.baseToWorkingLength) * 180) / Math.PI;
}

export function ladderCheck(angleFromGroundDeg: number): LadderCheck {
  const referenceDeg = ladderReferenceDeg();
  const deviationDeg = angleFromGroundDeg - referenceDeg;
  const verdict =
    deviationDeg > LADDER_REFERENCE.toleranceDeg
      ? "too_steep"
      : deviationDeg < -LADDER_REFERENCE.toleranceDeg
        ? "too_shallow"
        : "ok";
  return { angleFromGroundDeg, referenceDeg, deviationDeg, verdict };
}
