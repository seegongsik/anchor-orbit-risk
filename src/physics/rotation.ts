import { ROTATION_RESIDUAL_FRACTION_ASSUMPTION } from "./constants.js";
import type { Vec2 } from "./geometry.js";

export type CircleFit = {
  center: Vec2;
  radius: number;
  rmsResidual: number;
  isRotation: boolean;
  residualFractionAssumption: number;
};

function solve3(a: number[][], b: number[]): number[] {
  const m = a.map((row, i) => [...row, b[i]]);
  const n = 3;
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const diag = m[col][col];
    if (Math.abs(diag) < 1e-12) {
      throw new Error("circle fit is singular (points are likely collinear)");
    }
    for (let c = col; c <= n; c += 1) m[col][c] /= diag;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = m[r][col];
      for (let c = col; c <= n; c += 1) m[r][c] -= f * m[col][c];
    }
  }
  return [m[0][3], m[1][3], m[2][3]];
}

/**
 * Algebraic least-squares circle fit (Kåsa):
 * x² + y² + D x + E y + F = 0.
 */
export function fitCircle(
  points: Vec2[],
  residualFraction = ROTATION_RESIDUAL_FRACTION_ASSUMPTION,
): CircleFit {
  if (points.length < 3) {
    throw new Error("circle fit needs at least 3 points");
  }
  let sumX = 0;
  let sumY = 0;
  let sumX2 = 0;
  let sumY2 = 0;
  let sumXY = 0;
  let sumXz = 0;
  let sumYz = 0;
  let sumZ = 0;
  for (const p of points) {
    const z = p.x * p.x + p.y * p.y;
    sumX += p.x;
    sumY += p.y;
    sumX2 += p.x * p.x;
    sumY2 += p.y * p.y;
    sumXY += p.x * p.y;
    sumXz += p.x * z;
    sumYz += p.y * z;
    sumZ += z;
  }
  const n = points.length;
  const [D, E, F] = solve3(
    [
      [sumX2, sumXY, sumX],
      [sumXY, sumY2, sumY],
      [sumX, sumY, n],
    ],
    [-sumXz, -sumYz, -sumZ],
  );
  const center = { x: -D / 2, y: -E / 2 };
  const radiusSq = center.x * center.x + center.y * center.y - F;
  if (!(radiusSq > 0)) {
    throw new Error("circle fit produced a non-positive radius");
  }
  const radius = Math.sqrt(radiusSq);
  let rss = 0;
  for (const p of points) {
    const ri = Math.hypot(p.x - center.x, p.y - center.y);
    const e = ri - radius;
    rss += e * e;
  }
  const rmsResidual = Math.sqrt(rss / n);
  return {
    center,
    radius,
    rmsResidual,
    isRotation: rmsResidual <= residualFraction * radius,
    residualFractionAssumption: residualFraction,
  };
}

export function sweepSector(
  center: Vec2,
  _radius: number,
  points: Vec2[],
): { startRad: number; endRad: number } {
  const angles = points
    .map((p) => Math.atan2(p.y - center.y, p.x - center.x))
    .sort((a, b) => a - b);
  if (angles.length === 0) {
    return { startRad: 0, endRad: 0 };
  }
  let start = angles[0];
  let end = angles[angles.length - 1];
  let maxGap = 0;
  for (let i = 0; i < angles.length; i += 1) {
    const a = angles[i];
    const b = i + 1 === angles.length ? angles[0] + Math.PI * 2 : angles[i + 1];
    const gap = b - a;
    if (gap > maxGap) {
      maxGap = gap;
      start = b;
      end = a + (i + 1 === angles.length ? Math.PI * 2 : 0);
    }
  }
  return { startRad: start, endRad: end };
}
