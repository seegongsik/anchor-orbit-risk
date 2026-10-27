/**
 * Gravity-referenced (plumb-line) geometry in image pixels.
 *
 * The phone's accelerometer gives the direction of gravity at the moment of
 * capture. Projected into the photo it is a plumb line. The tipping boundary of
 * an object resting near a table edge is the plumb line through that edge
 * (the anchor). The margin d is the signed distance from the object's centre of
 * mass to that line, measured perpendicular to gravity.
 *
 * Only the line matters here, not which end is "down", so these results do not
 * depend on the sign convention of a browser's accelerometer.
 */
import { MONTE_CARLO_ITERATIONS, MONTE_CARLO_SEED } from "./constants.js";
import { dot, radToDeg, type Vec2 } from "./geometry.js";
import { forEachMaskPixel, maskCentroid, maskExtent, type BinaryMask } from "./mask.js";
import { quantity, type Quantity } from "./quantity.js";
import { gauss, mulberry32 } from "./rng.js";

export type Plumb = {
  /** Unit vector along gravity in image pixels (+x right, +y down). */
  down: Vec2;
  /**
   * Unit vector perpendicular to gravity: down rotated by -90 degrees, so it
   * is +x when the photo is upright.
   */
  horizontal: Vec2;
};

export function plumbFromDown(down: Vec2): Plumb {
  const n = Math.hypot(down.x, down.y);
  if (!(n > 0)) throw new Error("gravity has no component in the image plane");
  const d = { x: down.x / n, y: down.y / n };
  return { down: d, horizontal: { x: d.y, y: -d.x } };
}

export function plumbFromAngle(angleRad: number): Plumb {
  return plumbFromDown({ x: Math.cos(angleRad), y: Math.sin(angleRad) });
}

export function plumbAngle(plumb: Plumb): number {
  return Math.atan2(plumb.down.y, plumb.down.x);
}

/**
 * How far the photo is rolled away from gravity, in degrees within ±90.
 * 0 means the image's vertical axis is the plumb line.
 */
export function imageTiltDeg(plumb: Plumb): number {
  let deg = radToDeg(Math.atan2(plumb.down.x, plumb.down.y));
  if (deg > 90) deg -= 180;
  if (deg < -90) deg += 180;
  return -deg;
}

export type EdgeMargin = {
  /** Signed margin in pixels. Positive = centre of mass over the support. */
  dPx: number;
  dM: number;
  /** Height of the centre of mass above the edge, along the plumb line. */
  comHeightAboveEdgePx: number;
  /** +1 if the support lies toward +horizontal from the edge, else -1. */
  supportSide: 1 | -1;
};

export function edgeMargin(input: {
  com: Vec2;
  edge: Vec2;
  /** Any point on the support surface, on the support's side of the edge. */
  supportPoint: Vec2;
  plumb: Plumb;
  metersPerPixel: number;
}): EdgeMargin {
  if (!(input.metersPerPixel > 0)) throw new Error("metersPerPixel must be positive");
  const h = input.plumb.horizontal;
  const supportOffset = dot(
    { x: input.supportPoint.x - input.edge.x, y: input.supportPoint.y - input.edge.y },
    h,
  );
  if (supportOffset === 0) {
    throw new Error("the support point lies on the plumb line through the edge");
  }
  const supportSide: 1 | -1 = supportOffset > 0 ? 1 : -1;
  const rel = { x: input.com.x - input.edge.x, y: input.com.y - input.edge.y };
  const dPx = supportSide * dot(rel, h);
  return {
    dPx,
    dM: dPx * input.metersPerPixel,
    comHeightAboveEdgePx: -dot(rel, input.plumb.down),
    supportSide,
  };
}

export type SupportCorner = {
  corner: Vec2;
  /** A point on the support, on the support side of the corner. */
  supportPoint: Vec2;
  /** Which end of the support's top is the critical edge. */
  side: "min" | "max";
  /** Margins to both visible ends, in pixels; null if that end is not visible. */
  marginPxToMin: number | null;
  marginPxToMax: number | null;
};

/**
 * Finds the support edge an object is most likely to go over, from a support
 * mask in a side view. Pixels near the object's base level are used, so table
 * legs or a wider base do not count as the top surface. An end that touches
 * the image border is treated as not visible (the real edge is off-frame).
 */
export function supportCorner(input: {
  support: BinaryMask;
  object: BinaryMask;
  plumb: Plumb;
  imageWidth: number;
  imageHeight: number;
  /** Half-height of the band around the object's base, in pixels. */
  bandPx?: number;
  /** Pixels from the border within which an end counts as cut off. */
  borderPx?: number;
}): SupportCorner {
  const { plumb } = input;
  const com = maskCentroid(input.object);
  const objectBase = maskExtent(input.object, plumb.down).max;
  const band = input.bandPx ?? Math.max(4, 0.02 * Math.max(input.imageWidth, input.imageHeight));
  const border = input.borderPx ?? 2;

  type Hit = { t: number; p: Vec2 };
  const collect = (lo: number, hi: number) => {
    const hits: Hit[] = [];
    forEachMaskPixel(input.support, (x, y) => {
      const level = x * plumb.down.x + y * plumb.down.y;
      if (level < lo || level > hi) return;
      hits.push({ t: x * plumb.horizontal.x + y * plumb.horizontal.y, p: { x, y } });
    });
    return hits;
  };
  let hits = collect(objectBase - band, objectBase + band);
  if (hits.length < 10) hits = collect(objectBase - band, Infinity);
  if (hits.length === 0) throw new Error("no support pixels at or below the object's base");

  let lo = hits[0];
  let hi = hits[0];
  for (const hit of hits) {
    if (hit.t < lo.t) lo = hit;
    if (hit.t > hi.t) hi = hit;
  }
  // The corner sits on the outer boundary of the extreme pixels (half a pixel
  // beyond their centres), at the top of the support's end face: the topmost of
  // the pixels within 1.5 px of the extreme, half a pixel up. That is the pivot.
  const sx = input.support.scaleX ?? 1;
  const sy = input.support.scaleY ?? 1;
  const halfAlong = 0.5 * (Math.abs(plumb.horizontal.x) * sx + Math.abs(plumb.horizontal.y) * sy);
  const halfDown = 0.5 * (Math.abs(plumb.down.x) * sx + Math.abs(plumb.down.y) * sy);
  const settle = (target: Hit, outward: 1 | -1): Vec2 => {
    let top = Infinity;
    for (const hit of hits) {
      if (Math.abs(hit.t - target.t) <= 1.5) top = Math.min(top, dot(hit.p, plumb.down));
    }
    const t = target.t + outward * halfAlong;
    const level = top - halfDown;
    return {
      x: t * plumb.horizontal.x + level * plumb.down.x,
      y: t * plumb.horizontal.y + level * plumb.down.y,
    };
  };

  const touchesBorder = (p: Vec2) =>
    p.x <= border ||
    p.y <= border ||
    p.x >= input.imageWidth - border ||
    p.y >= input.imageHeight - border;

  const minCorner = settle(lo, -1);
  const maxCorner = settle(hi, 1);
  const comT = dot(com, plumb.horizontal);
  const minVisible = !touchesBorder(minCorner);
  const maxVisible = !touchesBorder(maxCorner);
  const marginPxToMin = minVisible ? comT - dot(minCorner, plumb.horizontal) : null;
  const marginPxToMax = maxVisible ? dot(maxCorner, plumb.horizontal) - comT : null;
  if (marginPxToMin === null && marginPxToMax === null) {
    throw new Error("no support edge is visible; both ends of the support touch the image border");
  }
  const useMin =
    marginPxToMax === null || (marginPxToMin !== null && marginPxToMin < marginPxToMax);
  const corner = useMin ? minCorner : maxCorner;
  const mid = { x: (minCorner.x + maxCorner.x) / 2, y: (minCorner.y + maxCorner.y) / 2 };
  return {
    corner,
    supportPoint: mid,
    side: useMin ? "min" : "max",
    marginPxToMin,
    marginPxToMax,
  };
}

export type MarginSigma = {
  /** Centre-of-mass jitter per axis, pixels (mask boundary, density). */
  comPx: number;
  /** Edge-corner jitter per axis, pixels. */
  edgePx: number;
  /** Gravity direction error, radians (sensor and averaging). */
  gravityRad: number;
  /** Relative scale error (metres per pixel), unitless std. */
  scaleRel: number;
};

export type MarginMonteCarlo = {
  d: Quantity;
  pUnstable: number;
  percentiles: { p5: number; p50: number; p95: number };
  samples: Float64Array;
  seed: number;
  iterations: number;
};

/** Distribution of the margin d over measurement errors (fixed seed). */
export function marginMonteCarlo(input: {
  com: Vec2;
  edge: Vec2;
  supportPoint: Vec2;
  plumb: Plumb;
  metersPerPixel: number;
  sigma: MarginSigma;
  iterations?: number;
  seed?: number;
}): MarginMonteCarlo {
  const iterations = input.iterations ?? MONTE_CARLO_ITERATIONS;
  if (iterations < 1000) throw new Error("Monte Carlo requires at least 1000 iterations");
  const seed = input.seed ?? MONTE_CARLO_SEED;
  const rng = mulberry32(seed);
  const base = plumbAngle(input.plumb);
  const samples = new Float64Array(iterations);
  let unstable = 0;
  for (let i = 0; i < iterations; i += 1) {
    const com = {
      x: input.com.x + gauss(rng) * input.sigma.comPx,
      y: input.com.y + gauss(rng) * input.sigma.comPx,
    };
    const edge = {
      x: input.edge.x + gauss(rng) * input.sigma.edgePx,
      y: input.edge.y + gauss(rng) * input.sigma.edgePx,
    };
    const plumb = plumbFromAngle(base + gauss(rng) * input.sigma.gravityRad);
    const mpp = input.metersPerPixel * Math.max(1e-6, 1 + gauss(rng) * input.sigma.scaleRel);
    const one = edgeMargin({ com, edge, supportPoint: input.supportPoint, plumb, metersPerPixel: mpp });
    samples[i] = one.dM;
    if (one.dM <= 0) unstable += 1;
  }
  const sorted = Float64Array.from(samples).sort();
  const at = (q: number) => sorted[Math.min(iterations - 1, Math.floor(q * iterations))];
  let sum = 0;
  for (const v of samples) sum += v;
  const mean = sum / iterations;
  let varSum = 0;
  for (const v of samples) varSum += (v - mean) * (v - mean);
  const std = Math.sqrt(varSum / iterations);
  return {
    d: quantity(mean, "m", { uncertainty: std, uncertaintyKind: "std", source: "computed" }),
    pUnstable: unstable / iterations,
    percentiles: { p5: at(0.05), p50: at(0.5), p95: at(0.95) },
    samples,
    seed,
    iterations,
  };
}

/**
 * How much the margin would change if gravity were ignored and the image's own
 * vertical were used instead. This is the error the phone's sensor removes.
 */
export function marginShiftWithoutGravity(input: {
  com: Vec2;
  edge: Vec2;
  supportPoint: Vec2;
  plumb: Plumb;
  metersPerPixel: number;
}): number {
  const withGravity = edgeMargin(input).dM;
  const imageVertical = plumbFromDown({ x: 0, y: 1 });
  const withoutGravity = edgeMargin({ ...input, plumb: imageVertical }).dM;
  return withoutGravity - withGravity;
}
