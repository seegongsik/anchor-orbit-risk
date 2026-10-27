import { radToDeg, type Vec3 } from "../physics/geometry.js";

export type DeviceAcceleration = Vec3;

/** +1 when the browser reports gravity as the spec says, -1 when it reports the opposite. */
export type GravitySign = 1 | -1;

export type GravitySample = {
  accelerationIncludingGravity: DeviceAcceleration;
  screenAngleDeg: number;
  timestampMs: number;
  /**
   * The browser's sign, found from the readings by SignEstimate. Absent means
   * +1, the spec's convention (upright portrait y ≈ +g).
   */
  sign?: GravitySign;
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
 * (W3C/MDN: upright portrait y ≈ +g). World-down is the negation. iOS Safari was
 * reported in 2014 to send the opposite sign; whether it still does is 확인 필요,
 * so the sign is not assumed per platform but found from the readings
 * (SignEstimate) and passed in GravitySample.sign.
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

/**
 * Camera pitch from a gravity projection: the angle between the rear camera's
 * axis (device -z) and the horizontal, in degrees. 0 = looking level, negative =
 * looking down, positive = looking up. The sign is right only once the
 * browser's sign is known (GravitySample.sign); the magnitude is right always.
 */
export function pitchFromProjection(towardUser: number, magnitude: number): number {
  if (!(magnitude > 0)) return 0;
  return radToDeg(Math.asin(Math.max(-1, Math.min(1, towardUser / magnitude))));
}

export function imageDownFromSample(sample: GravitySample): ImageDown {
  const s = sample.sign ?? 1;
  const a = sample.accelerationIncludingGravity;
  const down = worldDownFromAccelerationIncludingGravity({ x: s * a.x, y: s * a.y, z: s * a.z });
  return projectDownOntoRearImage(down);
}

/**
 * Sign check parameters (assumptions, not measured): a vote counts only when
 * the plumb line is within uprightWithinDeg of the screen's vertical, and the
 * sign is settled when `agree` of the last `window` votes (at least minVotes)
 * point the same way.
 */
export const SIGN_CHECK = { uprightWithinDeg: 30, window: 40, agree: 0.8, minVotes: 12 } as const;

/**
 * One vote on the browser's sign, from one sample read with the spec's sign.
 * The page turns with the phone so that its bottom edge faces the ground, so
 * while the phone is held near upright the plumb line must point toward the
 * bottom of the screen. If it does, the browser follows the spec (+1); if it
 * points to the top, the browser sends the opposite sign (-1). Far from
 * upright, or with the phone nearly flat, there is no vote (0).
 */
export function signVote(sample: GravitySample, uprightWithinDeg: number = SIGN_CHECK.uprightWithinDeg): 1 | -1 | 0 {
  const image = imageDownFromSample({ ...sample, sign: 1 });
  if (image.isFlat || !(image.inPlane > 0)) return 0;
  const screen = downInScreenPixels(image, sample.screenAngleDeg);
  const cos = screen.y / Math.hypot(screen.x, screen.y);
  const limit = Math.cos((uprightWithinDeg * Math.PI) / 180);
  if (cos >= limit) return 1;
  if (cos <= -limit) return -1;
  return 0;
}

export type SignState = "unknown" | "as specified" | "inverted";

/** Collects votes and settles the browser's sign. Until it settles, +1 is used. */
export class SignEstimate {
  private votes: (1 | -1)[] = [];
  private value: GravitySign = 1;
  private settled = false;

  constructor(private readonly check: { window: number; agree: number; minVotes: number } = SIGN_CHECK) {}

  add(vote: 1 | -1 | 0): void {
    if (vote === 0) return;
    this.votes.push(vote);
    if (this.votes.length > this.check.window) this.votes.shift();
    if (this.votes.length < this.check.minVotes) return;
    const plus = this.votes.filter((v) => v === 1).length / this.votes.length;
    if (plus >= this.check.agree) {
      this.value = 1;
      this.settled = true;
    } else if (1 - plus >= this.check.agree) {
      this.value = -1;
      this.settled = true;
    }
  }

  get sign(): GravitySign {
    return this.value;
  }

  get state(): SignState {
    if (!this.settled) return "unknown";
    return this.value === 1 ? "as specified" : "inverted";
  }

  get counts(): { asSpecified: number; inverted: number } {
    const asSpecified = this.votes.filter((v) => v === 1).length;
    return { asSpecified, inverted: this.votes.length - asSpecified };
  }
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
