/**
 * Tipping about an object's own base, for the tilt check.
 *
 * Stand an object on a board and raise one end of the board slowly. The object
 * turns about its downhill base corner (the anchor) once the plumb line through
 * its centre of mass passes that corner, at the tilt angle
 *
 *   θc = atan(d / h)
 *
 * where d is the horizontal distance from the centre of mass to the corner and
 * h is the height of the centre of mass above it, both seen with the board
 * level. The ratio needs no scale. It assumes the object does not slide first
 * (a friction coefficient of at least tan θc) and that the board is raised
 * slowly enough for the object to stay at rest until then.
 */
import { MONTE_CARLO_ITERATIONS, MONTE_CARLO_SEED } from "./constants.js";
import { dot, radToDeg, type Vec2 } from "./geometry.js";
import { forEachMaskPixel, maskCentroid, type BinaryMask } from "./mask.js";
import { plumbAngle, plumbFromAngle, type MarginSigma, type Plumb } from "./plumb.js";
import { gauss, mulberry32 } from "./rng.js";

export type BaseSide = "min" | "max";

/** The two bottom corners of an object's outline, at its outer boundary. */
export function baseCorners(object: BinaryMask, plumb: Plumb, bandPx?: number): Record<BaseSide, Vec2> {
  type Hit = { t: number; level: number };
  const hits: Hit[] = [];
  let bottom = -Infinity;
  forEachMaskPixel(object, (x, y) => {
    const level = x * plumb.down.x + y * plumb.down.y;
    hits.push({ t: x * plumb.horizontal.x + y * plumb.horizontal.y, level });
    if (level > bottom) bottom = level;
  });
  if (hits.length === 0) throw new Error("the object mask is empty");
  const band = bandPx ?? Math.max(2, 0.03 * Math.sqrt(hits.length));
  const base = hits.filter((h) => h.level >= bottom - band);
  let lo = base[0];
  let hi = base[0];
  for (const h of base) {
    if (h.t < lo.t) lo = h;
    if (h.t > hi.t) hi = h;
  }
  const sx = object.scaleX ?? 1;
  const sy = object.scaleY ?? 1;
  const halfAlong = 0.5 * (Math.abs(plumb.horizontal.x) * sx + Math.abs(plumb.horizontal.y) * sy);
  const halfDown = 0.5 * (Math.abs(plumb.down.x) * sx + Math.abs(plumb.down.y) * sy);
  // The pivot is the outer edge of the extreme base pixel, on the bottom face.
  const corner = (target: Hit, outward: 1 | -1): Vec2 => {
    let deepest = -Infinity;
    for (const h of base) if (Math.abs(h.t - target.t) <= 1.5) deepest = Math.max(deepest, h.level);
    const t = target.t + outward * halfAlong;
    const level = deepest + halfDown;
    return { x: t * plumb.horizontal.x + level * plumb.down.x, y: t * plumb.horizontal.y + level * plumb.down.y };
  };
  return { min: corner(lo, -1), max: corner(hi, 1) };
}

export type TipGeometry = {
  com: Vec2;
  corner: Vec2;
  side: BaseSide;
  /** Horizontal distance from the centre of mass to the corner, pixels (positive = corner outside the centre). */
  dPx: number;
  /** Height of the centre of mass above the corner, pixels. */
  hPx: number;
  angleDeg: number;
};

/** Tipping angle over one base corner. */
export function tipAngle(com: Vec2, corner: Vec2, side: BaseSide, plumb: Plumb): TipGeometry {
  const rel = { x: corner.x - com.x, y: corner.y - com.y };
  const along = dot(rel, plumb.horizontal);
  const dPx = side === "max" ? along : -along;
  const hPx = dot(rel, plumb.down);
  if (!(hPx > 0)) throw new Error("the base corner is not below the centre of mass");
  return { com, corner, side, dPx, hPx, angleDeg: radToDeg(Math.atan2(dPx, hPx)) };
}

export type TipPrediction = {
  side: BaseSide;
  geometry: TipGeometry;
  /** Both sides, so the tilt can go either way. */
  sides: Record<BaseSide, TipGeometry>;
  meanDeg: number;
  stdDeg: number;
  p5Deg: number;
  p95Deg: number;
  iterations: number;
  seed: number;
};

/**
 * Predicted tipping angle with its uncertainty: the centre of mass, the corner
 * and the gravity direction are jittered as in the edge margin (scale does not
 * enter). side "auto" picks the side it tips toward at the smaller angle.
 */
export function predictTipAngle(input: {
  object: BinaryMask;
  plumb: Plumb;
  sigma: Pick<MarginSigma, "comPx" | "edgePx" | "gravityRad">;
  side?: BaseSide | "auto";
  iterations?: number;
  seed?: number;
}): TipPrediction {
  const com = maskCentroid(input.object);
  const corners = baseCorners(input.object, input.plumb);
  const sides = {
    min: tipAngle(com, corners.min, "min", input.plumb),
    max: tipAngle(com, corners.max, "max", input.plumb),
  };
  const side: BaseSide =
    input.side === "min" || input.side === "max" ? input.side : sides.min.angleDeg <= sides.max.angleDeg ? "min" : "max";
  const iterations = input.iterations ?? MONTE_CARLO_ITERATIONS;
  const seed = input.seed ?? MONTE_CARLO_SEED;
  const rng = mulberry32(seed);
  const base = plumbAngle(input.plumb);
  const samples = new Float64Array(iterations);
  for (let i = 0; i < iterations; i += 1) {
    const c = { x: com.x + gauss(rng) * input.sigma.comPx, y: com.y + gauss(rng) * input.sigma.comPx };
    const k = {
      x: corners[side].x + gauss(rng) * input.sigma.edgePx,
      y: corners[side].y + gauss(rng) * input.sigma.edgePx,
    };
    const plumb = plumbFromAngle(base + gauss(rng) * input.sigma.gravityRad);
    const rel = { x: k.x - c.x, y: k.y - c.y };
    const along = dot(rel, plumb.horizontal);
    samples[i] = radToDeg(Math.atan2(side === "max" ? along : -along, Math.max(1e-9, dot(rel, plumb.down))));
  }
  const sorted = Float64Array.from(samples).sort();
  const at = (q: number) => sorted[Math.min(iterations - 1, Math.floor(q * iterations))];
  let sum = 0;
  for (const v of samples) sum += v;
  const meanDeg = sum / iterations;
  let sq = 0;
  for (const v of samples) sq += (v - meanDeg) * (v - meanDeg);
  return {
    side,
    geometry: sides[side],
    sides,
    meanDeg,
    stdDeg: Math.sqrt(sq / iterations),
    p5Deg: at(0.05),
    p95Deg: at(0.95),
    iterations,
    seed,
  };
}
