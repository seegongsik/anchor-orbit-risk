import { dot, type Vec2 } from "./geometry.js";

export type BinaryMask = {
  width: number;
  height: number;
  /** Row-major 0/1 values, length width * height. */
  data: Uint8Array;
  /** Source-image pixel where the raster's top-left corner sits. */
  originX?: number;
  originY?: number;
  /**
   * Source pixels per raster pixel. A SAM 3.1 raster covers its box and can be
   * smaller than it, so one raster pixel may span several source pixels.
   */
  scaleX?: number;
  scaleY?: number;
};

/** The compact mask shape the server sends to the browser. */
export type RunMask = {
  bounds: { left: number; top: number; right: number; bottom: number };
  width: number;
  height: number;
  /** Row-major run lengths; the first run counts zeros. */
  runs: number[];
};

export function maskFromRuns(input: RunMask): BinaryMask {
  const total = input.width * input.height;
  const data = new Uint8Array(total);
  let index = 0;
  let bit = 0;
  for (const run of input.runs) {
    if (!Number.isInteger(run) || run < 0) {
      throw new Error("mask runs must be non-negative integers");
    }
    if (index + run > total) {
      throw new Error("mask runs exceed width * height");
    }
    if (bit === 1) data.fill(1, index, index + run);
    index += run;
    bit ^= 1;
  }
  if (index !== total) {
    throw new Error("mask runs do not cover width * height");
  }
  const boxWidth = input.bounds.right - input.bounds.left;
  const boxHeight = input.bounds.bottom - input.bounds.top;
  return {
    width: input.width,
    height: input.height,
    data,
    originX: input.bounds.left,
    originY: input.bounds.top,
    scaleX: boxWidth / input.width,
    scaleY: boxHeight / input.height,
  };
}

/** Calls fn with the source-pixel centre of every set pixel. */
export function forEachMaskPixel(
  mask: BinaryMask,
  fn: (x: number, y: number, index: number) => void,
): void {
  if (mask.data.length !== mask.width * mask.height) {
    throw new Error("mask data length must equal width * height");
  }
  const ox = mask.originX ?? 0;
  const oy = mask.originY ?? 0;
  const sx = mask.scaleX ?? 1;
  const sy = mask.scaleY ?? 1;
  for (let y = 0; y < mask.height; y += 1) {
    const row = y * mask.width;
    const cy = oy + (y + 0.5) * sy;
    for (let x = 0; x < mask.width; x += 1) {
      const i = row + x;
      if (mask.data[i]) fn(ox + (x + 0.5) * sx, cy, i);
    }
  }
}

export function maskPixelCount(mask: BinaryMask): number {
  let n = 0;
  for (const bit of mask.data) if (bit) n += 1;
  return n;
}

/**
 * Uniform-density centroid using pixel centres.
 * Optional per-pixel positive weights (same length as data) stand in for a
 * mass-distribution hint. Weights are not invented when omitted.
 */
export function maskCentroid(mask: BinaryMask, weights?: Float64Array): Vec2 {
  if (weights && weights.length !== mask.data.length) {
    throw new Error("weight length must equal mask data length");
  }
  let sx = 0;
  let sy = 0;
  let mass = 0;
  forEachMaskPixel(mask, (x, y, i) => {
    const w = weights ? weights[i] : 1;
    if (!(w > 0)) return;
    sx += x * w;
    sy += y * w;
    mass += w;
  });
  if (mass === 0) {
    throw new Error("mask has no positive mass");
  }
  return { x: sx / mass, y: sy / mass };
}

/** Smallest and largest projection of the mask's pixel centres onto a direction. */
export function maskExtent(mask: BinaryMask, direction: Vec2): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  forEachMaskPixel(mask, (x, y) => {
    const t = dot({ x, y }, direction);
    if (t < min) min = t;
    if (t > max) max = t;
  });
  if (min === Infinity) throw new Error("mask is empty");
  return { min, max };
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

/** Even-odd point-in-polygon test. */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y) {
      const xAtY = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (p.x < xAtY) inside = !inside;
    }
  }
  return inside;
}

/** Rasterises a polygon into a mask cropped to its bounding box. */
export function polygonMask(poly: readonly Vec2[]): BinaryMask {
  if (poly.length < 3) throw new Error("a polygon needs at least 3 points");
  const left = Math.floor(Math.min(...poly.map((p) => p.x)));
  const top = Math.floor(Math.min(...poly.map((p) => p.y)));
  const right = Math.ceil(Math.max(...poly.map((p) => p.x)));
  const bottom = Math.ceil(Math.max(...poly.map((p) => p.y)));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pointInPolygon({ x: left + x + 0.5, y: top + y + 0.5 }, poly)) {
        data[y * width + x] = 1;
      }
    }
  }
  return { width, height, data, originX: left, originY: top };
}
