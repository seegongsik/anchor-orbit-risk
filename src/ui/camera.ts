/** Live camera preview with the gravity plumb line, and still capture. */
import type { GravitySource } from "../assessment/types.js";
import type { Vec2 } from "../physics/geometry.js";
import { SIDE_VIEW_MAX_PITCH_DEG } from "../risk/config.js";
import { imageTiltDeg, plumbFromDown, type Plumb } from "../physics/plumb.js";
import {
  downInScreenPixels,
  imageDownFromSample,
  isStationary,
  pitchFromProjection,
  readScreenAngleDeg,
  SignEstimate,
  signVote,
  type DeviceAcceleration,
  type GravitySample,
  type SignState,
} from "../sensors/gravity.js";

export const MAX_STILL_SIDE = 1600;

export type GravityReading = {
  plumb: Plumb;
  noiseRad: number;
  /** The last quarter second was still enough to capture. */
  stationary: boolean;
  /** Steadiness for display, with hysteresis so it does not flicker. */
  steady: boolean;
  flat: boolean;
  /**
   * How far the rear camera's axis is from horizontal, degrees: negative looks
   * down, positive looks up. A side view of an edge needs it near zero.
   */
  pitchDeg: number;
  /** Whether the browser's gravity sign is settled; up/down words wait for it. */
  signState: SignState;
  sample: GravitySample;
};

export type GravityDetails = {
  mean: DeviceAcceleration;
  magnitude: number;
  rateHz: number | null;
  screenAngleDeg: number;
  signState: SignState;
  votes: { asSpecified: number; inverted: number };
};

/** Steadiness hysteresis (assumptions): enter below 0.4 m/s² per axis for 0.3 s, leave above 0.7. */
const STEADY_ENTER_STD = 0.4;
const STEADY_LEAVE_STD = 0.7;
const STEADY_ENTER_MS = 300;

/** Averages the last few devicemotion samples (about a quarter of a second). */
export class GravityReader {
  private buffer: DeviceAcceleration[] = [];
  private times: number[] = [];
  private lastAt = 0;
  private readonly signs = new SignEstimate();
  private steady = false;
  private calmSince: number | null = null;
  private readonly handler = (event: DeviceMotionEvent) => {
    const a = event.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    const sample = { x: a.x, y: a.y, z: a.z };
    this.buffer.push(sample);
    if (this.buffer.length > 15) this.buffer.shift();
    this.times.push(event.timeStamp);
    if (this.times.length > 30) this.times.shift();
    this.lastAt = Date.now();
    this.signs.add(
      signVote({ accelerationIncludingGravity: sample, screenAngleDeg: readScreenAngleDeg(screen.orientation), timestampMs: 0 }),
    );
  };

  start(): void {
    window.addEventListener("devicemotion", this.handler);
  }

  stop(): void {
    window.removeEventListener("devicemotion", this.handler);
  }

  hasSignal(): boolean {
    return this.buffer.length >= 3 && Date.now() - this.lastAt < 1000;
  }

  private mean(): DeviceAcceleration {
    const n = this.buffer.length;
    return this.buffer.reduce(
      (acc, s) => ({ x: acc.x + s.x / n, y: acc.y + s.y / n, z: acc.z + s.z / n }),
      { x: 0, y: 0, z: 0 },
    );
  }

  details(): GravityDetails | null {
    if (!this.hasSignal()) return null;
    const mean = this.mean();
    const span = this.times.length > 1 ? this.times[this.times.length - 1] - this.times[0] : 0;
    return {
      mean,
      magnitude: Math.hypot(mean.x, mean.y, mean.z),
      rateHz: span > 0 ? ((this.times.length - 1) * 1000) / span : null,
      screenAngleDeg: readScreenAngleDeg(screen.orientation),
      signState: this.signs.state,
      votes: this.signs.counts,
    };
  }

  reading(): GravityReading | null {
    if (!this.hasSignal()) return null;
    const n = this.buffer.length;
    const mean = this.mean();
    const screenAngleDeg = readScreenAngleDeg(screen.orientation);
    const sign = this.signs.sign;
    const sample: GravitySample = { accelerationIncludingGravity: mean, screenAngleDeg, timestampMs: Date.now(), sign };
    const projected = imageDownFromSample(sample);
    if (projected.inPlane === 0) return null;
    const down = downInScreenPixels(projected, screenAngleDeg);
    const plumb = plumbFromDown(down);
    const base = Math.atan2(down.y, down.x);
    let sq = 0;
    for (const s of this.buffer) {
      const p = imageDownFromSample({ accelerationIncludingGravity: s, screenAngleDeg, timestampMs: 0, sign });
      const d = downInScreenPixels(p, screenAngleDeg);
      let delta = Math.atan2(d.y, d.x) - base;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      sq += delta * delta;
    }
    const now = Date.now();
    if (isStationary(this.buffer, STEADY_ENTER_STD)) {
      this.calmSince ??= now;
      if (now - this.calmSince >= STEADY_ENTER_MS) this.steady = true;
    } else {
      this.calmSince = null;
      if (!isStationary(this.buffer, STEADY_LEAVE_STD)) this.steady = false;
    }
    return {
      plumb,
      noiseRad: Math.sqrt(sq / n),
      stationary: isStationary(this.buffer),
      steady: this.steady,
      flat: projected.isFlat,
      pitchDeg: pitchFromProjection(projected.towardUser, projected.magnitude),
      signState: this.signs.state,
      sample,
    };
  }
}

export type Still = {
  canvas: HTMLCanvasElement;
  dataUrl: string;
  width: number;
  height: number;
  plumb: Plumb;
  gravitySource: GravitySource;
  gravityNoiseRad: number;
  gravitySample: GravitySample | null;
  stationary: boolean;
  /** Camera pitch at capture, degrees; null without a sensor reading. */
  pitchDeg: number | null;
  capturedAt: string;
  origin: "camera" | "upload" | "synthetic";
};

export function fitSize(width: number, height: number, maxSide = MAX_STILL_SIDE): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function stillFromSource(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  gravity: {
    plumb: Plumb;
    source: GravitySource;
    noiseRad: number;
    sample: GravitySample | null;
    stationary: boolean;
    pitchDeg?: number | null;
  },
  origin: Still["origin"],
): Still {
  const size = fitSize(sourceWidth, sourceHeight);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  ctx.drawImage(source, 0, 0, size.width, size.height);
  return {
    canvas,
    dataUrl: canvas.toDataURL("image/jpeg", 0.85),
    width: size.width,
    height: size.height,
    plumb: gravity.plumb,
    gravitySource: gravity.source,
    gravityNoiseRad: gravity.noiseRad,
    gravitySample: gravity.sample,
    stationary: gravity.stationary,
    pitchDeg: gravity.pitchDeg ?? null,
    capturedAt: new Date().toISOString(),
    origin,
  };
}

export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play().catch(() => undefined);
  return stream;
}

/** Within this many degrees of the side-view limit the bar turns amber (display only, an assumption). */
const NEAR_LIMIT_DEG = 3;

export type PitchBand = "level" | "near" | "off";

export function pitchBand(pitchDeg: number, limitDeg: number = SIDE_VIEW_MAX_PITCH_DEG): PitchBand {
  const a = Math.abs(pitchDeg);
  if (a > limitDeg) return "off";
  if (a > limitDeg - NEAR_LIMIT_DEG) return "near";
  return "level";
}

/** Whole degrees, with one decimal near the limit so "15°" never reads as both sides of it. */
function degText(a: number, limitDeg: number): string {
  return Math.abs(a - limitDeg) < 1 ? a.toFixed(1) : a.toFixed(0);
}

/** Up and down are named only once the browser's gravity sign is settled. */
export function pitchText(pitchDeg: number, signKnown: boolean, limitDeg: number = SIDE_VIEW_MAX_PITCH_DEG): string {
  const a = Math.abs(pitchDeg);
  if (a < 1) return "Camera level · side view OK";
  const dir = signKnown ? (pitchDeg < 0 ? " down" : " up") : "";
  const deg = `${degText(a, limitDeg)}°${dir}`;
  const band = pitchBand(pitchDeg, limitDeg);
  if (band === "level") return `Camera ${deg} · side view OK`;
  if (band === "near") return `Camera ${deg} · near the ${limitDeg}° limit`;
  return `Camera ${deg} · aim it level`;
}

/** Roll is corrected by the plumb line, so it is reported, not judged. Positive = turned left. */
export function rollText(rollDeg: number): string {
  const a = Math.abs(rollDeg);
  if (a < 1) return "Phone upright";
  return `Phone turned ${a.toFixed(0)}° ${rollDeg > 0 ? "left" : "right"} · the line corrects it`;
}

const BAND_COLOUR: Record<PitchBand, string> = { level: "#9fe0b5", near: "#f2d07a", off: "#ff9d8f" };

/** Draws the live plumb line, the phone's turn and the camera's pitch over the preview. */
export function drawLiveOverlay(canvas: HTMLCanvasElement, video: HTMLVideoElement, reading: GravityReading | null): void {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(video.clientWidth * dpr));
  const h = Math.max(1, Math.round(video.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  const centre: Vec2 = { x: w / 2, y: h / 2 };
  const row = 22 * dpr;
  ctx.lineWidth = 3 * dpr;
  ctx.font = `${Math.round(15 * dpr)}px system-ui, sans-serif`;
  if (!reading) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, w, row + 12 * dpr);
    ctx.fillStyle = "#f4efe4";
    ctx.fillText("No gravity reading yet. Tap “Allow motion sensors”.", 10 * dpr, row);
    return;
  }
  const { down } = reading.plumb;
  const len = Math.hypot(w, h);
  ctx.strokeStyle = "#7fd3a0";
  ctx.setLineDash([12 * dpr, 8 * dpr]);
  ctx.beginPath();
  ctx.moveTo(centre.x - down.x * len, centre.y - down.y * len);
  ctx.lineTo(centre.x + down.x * len, centre.y + down.y * len);
  ctx.stroke();
  ctx.setLineDash([]);
  // A small plumb bob at the lower end of the line.
  const bob = { x: centre.x + down.x * h * 0.32, y: centre.y + down.y * h * 0.32 };
  ctx.fillStyle = "#7fd3a0";
  ctx.beginPath();
  ctx.arc(bob.x, bob.y, 8 * dpr, 0, Math.PI * 2);
  ctx.fill();

  // Top: the plumb line and how far the phone is turned (corrected, so only reported).
  const topH = 2 * row + 8 * dpr;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, w, topH);
  ctx.fillStyle = "#f4efe4";
  const steady = reading.flat ? "phone is flat: hold it upright" : reading.steady ? "steady" : "hold still";
  ctx.fillText(`Plumb line from gravity · ${steady}`, 10 * dpr, row);
  ctx.fillText(rollText(imageTiltDeg(reading.plumb)), 10 * dpr, 2 * row);

  // Bottom: the camera's pitch, the one angle that has to be near zero for a side view.
  const signKnown = reading.signState !== "unknown";
  const band = pitchBand(reading.pitchDeg);
  const bottomH = row + 12 * dpr;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, h - bottomH, w, bottomH);
  ctx.fillStyle = BAND_COLOUR[band];
  ctx.fillText(pitchText(reading.pitchDeg, signKnown), 10 * dpr, h - 12 * dpr);

  // Right edge: a pitch gauge from 45° down to 45° up, the side-view band in green.
  const top = topH + 14 * dpr;
  const bottom = h - bottomH - 14 * dpr;
  if (bottom - top < 60 * dpr) return;
  const x = w - 20 * dpr;
  const span = 45;
  const yOf = (deg: number) => {
    const t = (Math.max(-span, Math.min(span, deg)) + span) / (2 * span);
    return bottom - t * (bottom - top);
  };
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(x - 7 * dpr, top - 6 * dpr, 14 * dpr, bottom - top + 12 * dpr);
  ctx.fillStyle = "rgba(127,211,160,0.45)";
  ctx.fillRect(x - 5 * dpr, yOf(SIDE_VIEW_MAX_PITCH_DEG), 10 * dpr, yOf(-SIDE_VIEW_MAX_PITCH_DEG) - yOf(SIDE_VIEW_MAX_PITCH_DEG));
  ctx.strokeStyle = "#f4efe4";
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  ctx.moveTo(x - 7 * dpr, yOf(0));
  ctx.lineTo(x + 7 * dpr, yOf(0));
  ctx.stroke();
  ctx.fillStyle = BAND_COLOUR[band];
  ctx.beginPath();
  ctx.arc(x, yOf(signKnown ? reading.pitchDeg : -Math.abs(reading.pitchDeg)), 6 * dpr, 0, Math.PI * 2);
  ctx.fill();
}

/** The numbers behind the overlay, for a screenshot when a reading looks wrong. */
export function sensorDetailsText(details: GravityDetails | null, reading: GravityReading | null): string {
  if (!details) return "No devicemotion events in the last second. Tap “Allow motion sensors”.";
  const f = (v: number) => (v >= 0 ? " " : "") + v.toFixed(2);
  const lines = [
    "accelerationIncludingGravity (m/s²)",
    `x ${f(details.mean.x)}  y ${f(details.mean.y)}  z ${f(details.mean.z)}  |a| ${details.magnitude.toFixed(2)}`,
    `${details.rateHz === null ? "rate –" : `${details.rateHz.toFixed(0)} Hz`} · screen angle ${details.screenAngleDeg}°`,
    `Sign: ${details.signState} (upright votes ${details.votes.asSpecified} as specified, ${details.votes.inverted} inverted)`,
  ];
  if (reading) {
    const roll = imageTiltDeg(reading.plumb);
    lines.push(
      `Turned ${roll >= 0 ? "left" : "right"} ${Math.abs(roll).toFixed(1)}° · pitch ${reading.pitchDeg >= 0 ? "+" : ""}${reading.pitchDeg.toFixed(1)}° (minus = down)`,
      `Plumb noise ±${((reading.noiseRad * 180) / Math.PI).toFixed(2)}° · ${reading.flat ? "flat" : reading.steady ? "steady" : "moving"}`,
    );
  }
  return lines.join("\n");
}
