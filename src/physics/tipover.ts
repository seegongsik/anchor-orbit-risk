import { quantity, type Quantity } from "./quantity.ts";
import type { Vec2 } from "./geometry.ts";

export type BinaryMask = {
  width: number;
  height: number;
  /** Row-major 0/1 values, length width * height. */
  data: Uint8Array;
  originX?: number;
  originY?: number;
};

export type TipoverResult = {
  com: Vec2;
  /** Signed horizontal margin in metres. Positive = COM on the support side. */
  d: Quantity;
  currentlyUnstable: boolean;
};

function pixelCount(mask: BinaryMask): number {
  let n = 0;
  for (const bit of mask.data) {
    if (bit) n += 1;
  }
  return n;
}

/**
 * Uniform-density centroid using pixel centres.
 * Optional per-pixel positive weights (same length as data) stand in for a
 * mass-distribution hint. Weights are not invented when omitted.
 */
export function maskCentroid(mask: BinaryMask, weights?: Float64Array): Vec2 {
  if (mask.data.length !== mask.width * mask.height) {
    throw new Error("mask data length must equal width * height");
  }
  if (weights && weights.length !== mask.data.length) {
    throw new Error("weight length must equal mask data length");
  }
  const originX = mask.originX ?? 0;
  const originY = mask.originY ?? 0;
  let sx = 0;
  let sy = 0;
  let mass = 0;
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      const i = y * mask.width + x;
      if (!mask.data[i]) continue;
      const w = weights ? weights[i] : 1;
      if (!(w > 0)) continue;
      sx += (originX + x + 0.5) * w;
      sy += (originY + y + 0.5) * w;
      mass += w;
    }
  }
  if (mass === 0) {
    throw new Error("mask has no positive mass");
  }
  return { x: sx / mass, y: sy / mass };
}

/** Edge x at a given y. Undefined if the edge is horizontal. */
export function edgeXAtY(edgeA: Vec2, edgeB: Vec2, y: number): number {
  const dy = edgeB.y - edgeA.y;
  if (Math.abs(dy) < 1e-12) {
    throw new Error("edge is horizontal; horizontal distance is undefined");
  }
  const t = (y - edgeA.y) / dy;
  return edgeA.x + t * (edgeB.x - edgeA.x);
}

/**
 * Signed image-x of a point relative to the edge (positive = right of edge).
 */
export function signedXFromEdge(point: Vec2, edgeA: Vec2, edgeB: Vec2): number {
  return point.x - edgeXAtY(edgeA, edgeB, point.y);
}

export function filledRectMask(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  canvasWidth: number,
  canvasHeight: number,
): BinaryMask {
  const data = new Uint8Array(canvasWidth * canvasHeight);
  const left = Math.max(0, Math.min(x0, x1));
  const right = Math.min(canvasWidth, Math.max(x0, x1));
  const top = Math.max(0, Math.min(y0, y1));
  const bottom = Math.min(canvasHeight, Math.max(y0, y1));
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      data[y * canvasWidth + x] = 1;
    }
  }
  return { width: canvasWidth, height: canvasHeight, data };
}

export function tipoverMargin(input: {
  com: Vec2;
  edgeA: Vec2;
  edgeB: Vec2;
  supportToward: Vec2;
  metersPerPixel: number;
  source?: Quantity["source"];
}): TipoverResult {
  if (!(input.metersPerPixel > 0)) {
    throw new Error("metersPerPixel must be positive");
  }
  const comSide = signedXFromEdge(input.com, input.edgeA, input.edgeB);
  const supportSide = signedXFromEdge(
    input.supportToward,
    input.edgeA,
    input.edgeB,
  );
  if (supportSide === 0) {
    throw new Error("supportToward lies on the edge; pick a point on the table");
  }
  const onSupport = comSide === 0 ? false : comSide * supportSide > 0;
  const signedPx = (onSupport ? 1 : -1) * Math.abs(comSide);
  const dMetres = signedPx * input.metersPerPixel;
  return {
    com: input.com,
    d: quantity(dMetres, "m", { source: input.source ?? "computed" }),
    currentlyUnstable: signedPx <= 0,
  };
}

export function tipoverFromMask(input: {
  mask: BinaryMask;
  edgeA: Vec2;
  edgeB: Vec2;
  supportToward: Vec2;
  metersPerPixel: number;
  weights?: Float64Array;
  source?: Quantity["source"];
}): TipoverResult & { pixelCount: number } {
  const com = maskCentroid(input.mask, input.weights);
  const result = tipoverMargin({ ...input, com });
  return { ...result, pixelCount: pixelCount(input.mask) };
}
