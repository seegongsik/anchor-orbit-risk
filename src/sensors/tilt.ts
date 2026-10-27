/**
 * Board tilt from the phone lying on it, and the moment an object tips over.
 * Pure functions: the browser listener lives in the page.
 */
import { radToDeg, type Vec3 } from "../physics/geometry.js";

/** Angle between two gravity readings, degrees: how far the phone (and the board under it) has turned. */
export function angleBetweenDeg(a: Vec3, b: Vec3): number {
  const na = Math.hypot(a.x, a.y, a.z);
  const nb = Math.hypot(b.x, b.y, b.z);
  if (!(na > 0) || !(nb > 0)) throw new Error("gravity readings must be non-zero");
  const c = (a.x * b.x + a.y * b.y + a.z * b.z) / (na * nb);
  return radToDeg(Math.acos(Math.max(-1, Math.min(1, c))));
}

export type TiltSample = {
  /** Milliseconds. */
  t: number;
  /** Board tilt from the level reading taken at the start, degrees. */
  tiltDeg: number;
  /** Size of the sudden acceleration, m/s² (linear acceleration, or the change from the smoothed reading). */
  jolt: number;
};

/** Assumptions for the jolt detector: the threshold and how far back the board angle is read. */
export const TIP_DETECTION = { joltMps2: 2, lookbackMs: 250, minTiltDeg: 2 } as const;

/**
 * Finds the first jolt (the object landing after it tips) and reads the board
 * angle a little before it, while the object was still standing. Jolts while
 * the board is still almost level (picking it up) are ignored.
 */
export function detectTip(
  samples: readonly TiltSample[],
  options: { joltMps2: number; lookbackMs: number; minTiltDeg: number } = TIP_DETECTION,
): { tiltDeg: number; atMs: number } | null {
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i];
    if (s.jolt < options.joltMps2 || s.tiltDeg < options.minTiltDeg) continue;
    const readAt = s.t - options.lookbackMs;
    let chosen = samples[0];
    for (let j = 0; j <= i; j += 1) {
      if (samples[j].t <= readAt) chosen = samples[j];
      else break;
    }
    return { tiltDeg: chosen.tiltDeg, atMs: s.t };
  }
  return null;
}
