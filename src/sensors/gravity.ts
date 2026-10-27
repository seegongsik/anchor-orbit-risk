import { radToDeg, type Vec3 } from "../physics/geometry.js";

export type DeviceAcceleration = Vec3;

export type GravitySample = {
  accelerationIncludingGravity: DeviceAcceleration;
  screenAngleDeg: number;
  timestampMs: number;
};

export type ImageDown = {
  /** +right in the rear-camera sensor image (before CSS rotation). */
  u: number;
  /** +down in the rear-camera sensor image. */
  v: number;
  towardUser: number;
  inPlane: number;
  magnitude: number;
  isFlat: boolean;
  rotationDegToAlignDown: number;
};

/**
 * At rest, accelerationIncludingGravity is treated as the support acceleration
 * (W3C/MDN: upright portrait y ≈ +g). World-down is the negation.
 * Real-device sign: 확인 필요.
 */
export function worldDownFromAccelerationIncludingGravity(
  a: DeviceAcceleration,
): DeviceAcceleration {
  return { x: -a.x, y: -a.y, z: -a.z };
}

/**
 * Rear camera looks toward device −z. Sensor image: +u = device +x, +v = device −y.
 */
export function projectDownOntoRearImage(down: DeviceAcceleration): ImageDown {
  const u = down.x;
  const v = -down.y;
  const towardUser = down.z;
  const inPlane = Math.hypot(u, v);
  const magnitude = Math.hypot(u, v, towardUser);
  const isFlat = magnitude === 0 ? true : inPlane < 0.2 * magnitude;
  const rotationDegToAlignDown =
    inPlane === 0 ? 0 : 90 - radToDeg(Math.atan2(v, u));
  return { u, v, towardUser, inPlane, magnitude, isFlat, rotationDegToAlignDown };
}

/**
 * Map sensor-image down through screen.orientation.angle (degrees clockwise
 * from the device's natural portrait). Convention locked in tests; mapping
 * against a live getUserMedia preview is 확인 필요.
 */
export function downInScreenPixels(
  image: Pick<ImageDown, "u" | "v">,
  screenAngleDeg: number,
): { x: number; y: number } {
  const turns = ((screenAngleDeg % 360) + 360) % 360;
  if (turns === 0) return { x: image.u, y: image.v };
  if (turns === 90) return { x: image.v, y: -image.u };
  if (turns === 180) return { x: -image.u, y: -image.v };
  if (turns === 270) return { x: -image.v, y: image.u };
  const rad = (turns * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: c * image.u + s * image.v, y: -s * image.u + c * image.v };
}

export function imageDownFromSample(sample: GravitySample): ImageDown {
  const down = worldDownFromAccelerationIncludingGravity(
    sample.accelerationIncludingGravity,
  );
  return projectDownOntoRearImage(down);
}

export function axisStd(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const varr =
    values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / values.length;
  return Math.sqrt(varr);
}

export function isStationary(
  samples: DeviceAcceleration[],
  maxStd = 0.4,
): boolean {
  if (samples.length < 3) return false;
  const sx = axisStd(samples.map((s) => s.x));
  const sy = axisStd(samples.map((s) => s.y));
  const sz = axisStd(samples.map((s) => s.z));
  return sx <= maxStd && sy <= maxStd && sz <= maxStd;
}

export type MotionPermission = "granted" | "denied" | "not-required";

export type MotionRequestApi = {
  requestPermission?: () => Promise<string>;
};

export async function requestMotionPermission(
  motion: MotionRequestApi | undefined,
): Promise<MotionPermission> {
  if (!motion || typeof motion.requestPermission !== "function") {
    return "not-required";
  }
  const result = await motion.requestPermission();
  return result === "granted" ? "granted" : "denied";
}

export function readScreenAngleDeg(
  orientation: { angle?: number } | null | undefined,
): number {
  const angle = orientation?.angle;
  if (typeof angle !== "number" || !Number.isFinite(angle)) return 0;
  return angle;
}
