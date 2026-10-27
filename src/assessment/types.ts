import type { Vec2 } from "../physics/geometry.js";
import type { MarginSigma } from "../physics/plumb.js";
import type { Text } from "../risk/config.js";

export type MaskSource = "sam-3.1" | "manual" | "synthetic";

/** Where the plumb line came from. Only "sensor" is a measurement of gravity. */
export type GravitySource = "sensor" | "image vertical (assumed)" | "synthetic";

/** What the phone measured for an object resting near a support edge. */
export type EdgeMeasurement = {
  type: "edge";
  dM: number;
  dStdM: number;
  dP5M: number;
  dP95M: number;
  pUnstableNow: number;
  /** Monte Carlo samples of d in metres (rounded), used for the fall model. */
  samplesM: number[];
  iterations: number;
  seed: number;
  gravitySource: GravitySource;
  gravityTiltDeg: number;
  shiftWithoutGravityM: number;
  comHeightAboveEdgeM: number;
  /** Measured edge-to-floor height along the plumb line, or null. */
  dropHeightM: number | null;
  metersPerPixel: number;
  scaleSource: string;
  maskSource: MaskSource;
  inputs: { comPx: Vec2; edgePx: Vec2; plumbDown: Vec2; sigma: MarginSigma };
};

/** What the phone measured for a leaning ladder. */
export type LadderMeasurement = {
  type: "ladder";
  angleFromGroundDeg: number;
  angleStdDeg: number;
  gravitySource: GravitySource;
  gravityTiltDeg: number;
  /** Measured height of the top contact above the foot, or null. */
  topHeightM: number | null;
  maskSource: MaskSource;
  inputs: { footPx: Vec2; topPx: Vec2; plumbDown: Vec2 };
};

export type HazardKind = "edge" | "ladder" | "other";

export type MassRange = {
  low: number;
  high: number;
  source: "model estimate" | "user" | "assumption";
};

export type Hazard = {
  id: string;
  kind: HazardKind;
  /** Short noun phrase, also the SAM 3.1 concept prompt. */
  object: string;
  support?: string;
  below?: string;
  material?: string;
  massKg?: MassRange;
  sharpEdgeDown?: boolean;
  note?: Text;
  measurement?: EdgeMeasurement | LadderMeasurement;
};

export const HAZARD_ID = /^h[1-9][0-9]?$/;
