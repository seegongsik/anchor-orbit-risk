/**
 * Turns marks on a photo into an edge measurement: centre of mass from the
 * object mask, the anchor (support edge) from the support mask or a tap, the
 * plumb line from the phone's gravity, the scale from a known length.
 */
import type { EdgeMeasurement, GravitySource, LadderMeasurement, MaskSource } from "../assessment/types.js";
import { MONTE_CARLO_ITERATIONS, MONTE_CARLO_SEED } from "../physics/constants.js";
import { degToRad, dot, radToDeg, type Vec2 } from "../physics/geometry.js";
import { maskCentroid, maskExtent, type BinaryMask } from "../physics/mask.js";
import {
  edgeMargin,
  imageTiltDeg,
  marginMonteCarlo,
  marginShiftWithoutGravity,
  supportCorner,
  type MarginSigma,
  type Plumb,
} from "../physics/plumb.js";

export type Scale = {
  metersPerPixel: number;
  /** Relative standard uncertainty of metersPerPixel. */
  relSigma: number;
  source: string;
};

/** Scale from two taps on a known length. Tap error and depth mismatch are assumptions. */
export function scaleFromTaps(a: Vec2, b: Vec2, knownM: number, label: string): Scale {
  const lengthPx = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(lengthPx > 5)) throw new Error("the two scale taps are too close together");
  const tapSigmaPx = 2;
  const depthMismatch = 0.03;
  const tapRel = (Math.SQRT2 * tapSigmaPx) / lengthPx;
  return {
    metersPerPixel: knownM / lengthPx,
    relSigma: Math.hypot(tapRel, depthMismatch),
    source: `${label}, two taps (tap ±${tapSigmaPx} px and depth mismatch ${depthMismatch * 100}% assumed)`,
  };
}

export type EdgeMarks = {
  imageWidth: number;
  imageHeight: number;
  plumb: Plumb;
  gravitySource: GravitySource;
  /** Spread of the averaged gravity direction, radians (0 if unknown). */
  gravityNoiseRad: number;
  object: BinaryMask;
  objectSource: MaskSource;
  support?: BinaryMask;
  supportSource?: MaskSource;
  manualEdge?: Vec2;
  manualSupportPoint?: Vec2;
  scale: Scale;
  floorPoint?: Vec2;
};

export type EdgeGeometry = {
  com: Vec2;
  edge: Vec2;
  supportPoint: Vec2;
  plumb: Plumb;
  /** +1 if the support lies toward +horizontal from the edge, else -1. */
  supportSide: 1 | -1;
  comHeightAboveEdgePx: number;
  dPx: number;
};

export type EdgeResult = {
  measurement: EdgeMeasurement;
  geometry: EdgeGeometry;
  sigma: MarginSigma;
  notes: string[];
};

export function measureEdge(marks: EdgeMarks): EdgeResult {
  const notes: string[] = [];
  const com = maskCentroid(marks.object);
  let edge: Vec2;
  let supportPoint: Vec2;
  let edgeSource: MaskSource;
  if (marks.manualEdge && marks.manualSupportPoint) {
    edge = marks.manualEdge;
    supportPoint = marks.manualSupportPoint;
    edgeSource = "manual";
  } else if (marks.support) {
    const corner = supportCorner({
      support: marks.support,
      object: marks.object,
      plumb: marks.plumb,
      imageWidth: marks.imageWidth,
      imageHeight: marks.imageHeight,
    });
    edge = marks.manualEdge ?? corner.corner;
    supportPoint = corner.supportPoint;
    edgeSource = marks.manualEdge ? "manual" : marks.supportSource ?? "manual";
  } else {
    throw new Error("mark the support (table) or tap its edge and a point on it");
  }

  const width = maskExtent(marks.object, marks.plumb.horizontal);
  const objectWidthPx = width.max - width.min;
  const maskRel = marks.objectSource === "manual" ? 0.03 : 0.01;
  const densityRel = 0.03;
  const sigma: MarginSigma = {
    comPx: objectWidthPx * Math.hypot(maskRel, densityRel) + 0.5,
    edgePx: edgeSource === "manual" ? 5 : 3,
    gravityRad:
      marks.gravitySource === "image vertical (assumed)"
        ? degToRad(3)
        : Math.hypot(degToRad(0.5), marks.gravityNoiseRad),
    scaleRel: marks.scale.relSigma,
  };
  notes.push(
    `Centre of mass: area centroid of the ${marks.objectSource} mask, uniform density assumed; σ = ${sigma.comPx.toFixed(1)} px (mask ${maskRel * 100}% and density ${densityRel * 100}% of the object width, assumptions).`,
    `Edge: ${edgeSource === "manual" ? "tapped by hand" : "corner of the support mask"}; σ = ${sigma.edgePx} px (assumption).`,
    marks.gravitySource === "image vertical (assumed)"
      ? `Gravity: no sensor reading; the photo's vertical is assumed to be the plumb line, σ = 3° (assumption).`
      : `Gravity: ${marks.gravitySource}; σ = ${radToDeg(sigma.gravityRad).toFixed(2)}° (0.5° sensor accuracy assumed, plus the measured spread).`,
  );

  const base = edgeMargin({ com, edge, supportPoint, plumb: marks.plumb, metersPerPixel: marks.scale.metersPerPixel });
  const mc = marginMonteCarlo({
    com,
    edge,
    supportPoint,
    plumb: marks.plumb,
    metersPerPixel: marks.scale.metersPerPixel,
    sigma,
    iterations: MONTE_CARLO_ITERATIONS,
    seed: MONTE_CARLO_SEED,
  });
  const shift = marginShiftWithoutGravity({ com, edge, supportPoint, plumb: marks.plumb, metersPerPixel: marks.scale.metersPerPixel });

  let dropHeightM: number | null = null;
  if (marks.floorPoint) {
    const h = dot({ x: marks.floorPoint.x - edge.x, y: marks.floorPoint.y - edge.y }, marks.plumb.down);
    dropHeightM = Math.abs(h) * marks.scale.metersPerPixel;
    notes.push("Drop height: from the edge to the tapped floor point along the plumb line (floor assumed at the edge's depth).");
  }

  const objectSource = marks.objectSource;
  const maskSource: MaskSource =
    objectSource === "synthetic" ? "synthetic" : objectSource === "sam-3.1" && edgeSource !== "manual" ? "sam-3.1" : objectSource;

  const measurement: EdgeMeasurement = {
    type: "edge",
    dM: mc.d.value,
    dStdM: mc.d.uncertainty,
    dP5M: mc.percentiles.p5,
    dP95M: mc.percentiles.p95,
    pUnstableNow: mc.pUnstable,
    samplesM: Array.from(mc.samples, (s) => Number(s.toPrecision(5))),
    iterations: mc.iterations,
    seed: mc.seed,
    gravitySource: marks.gravitySource,
    gravityTiltDeg: imageTiltDeg(marks.plumb),
    shiftWithoutGravityM: shift,
    comHeightAboveEdgeM: base.comHeightAboveEdgePx * marks.scale.metersPerPixel,
    dropHeightM,
    metersPerPixel: marks.scale.metersPerPixel,
    scaleSource: marks.scale.source,
    maskSource,
    inputs: { comPx: com, edgePx: edge, plumbDown: marks.plumb.down, sigma },
  };
  return {
    measurement,
    geometry: {
      com,
      edge,
      supportPoint,
      plumb: marks.plumb,
      supportSide: base.supportSide,
      comHeightAboveEdgePx: base.comHeightAboveEdgePx,
      dPx: base.dPx,
    },
    sigma,
    notes,
  };
}

/** Ladder angle from its foot and top contact against the plumb line. */
export function measureLadder(input: {
  foot: Vec2;
  top: Vec2;
  plumb: Plumb;
  gravitySource: GravitySource;
  gravityNoiseRad: number;
  scale?: Scale;
  maskSource: MaskSource;
}): LadderMeasurement {
  const along = { x: input.top.x - input.foot.x, y: input.top.y - input.foot.y };
  const len = Math.hypot(along.x, along.y);
  if (!(len > 10)) throw new Error("the ladder foot and top are too close together");
  const vertical = Math.abs(dot(along, input.plumb.down)) / len;
  const angleFromGroundDeg = radToDeg(Math.asin(Math.min(1, vertical)));
  const tapRad = Math.atan2(Math.SQRT2 * 4, len);
  const angleStdDeg = radToDeg(Math.hypot(degToRad(0.5), input.gravityNoiseRad, tapRad));
  const topHeightM = input.scale ? Math.abs(dot(along, input.plumb.down)) * input.scale.metersPerPixel : null;
  return {
    type: "ladder",
    angleFromGroundDeg,
    angleStdDeg,
    gravitySource: input.gravitySource,
    gravityTiltDeg: imageTiltDeg(input.plumb),
    topHeightM,
    maskSource: input.maskSource,
    inputs: { footPx: input.foot, topPx: input.top, plumbDown: input.plumb.down },
  };
}
