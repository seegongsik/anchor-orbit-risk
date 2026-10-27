/** Live camera preview with the gravity plumb line, and still capture. */
import type { GravitySource } from "../assessment/types.js";
import { radToDeg, type Vec2 } from "../physics/geometry.js";
import { SIDE_VIEW_MAX_PITCH_DEG } from "../risk/config.js";
import { imageTiltDeg, plumbFromDown, type Plumb } from "../physics/plumb.js";
import {
  downInScreenPixels,
  imageDownFromSample,
  isStationary,
  pitchFromProjection,
  readScreenAngleDeg,
  type DeviceAcceleration,
  type GravitySample,
} from "../sensors/gravity.js";

export const MAX_STILL_SIDE = 1600;

export type GravityReading = {
  plumb: Plumb;
  noiseRad: number;
  stationary: boolean;
  flat: boolean;
  /**
   * How far the camera axis is from horizontal, degrees (sign follows the
   * browser's accelerometer convention, which differs between platforms; use the
   * magnitude). A side view of an edge needs it near zero.
   */
  pitchDeg: number;
  sample: GravitySample;
};


/** Averages the last few devicemotion samples (about a quarter of a second). */
export class GravityReader {
  private buffer: DeviceAcceleration[] = [];
  private lastAt = 0;
  private readonly handler = (event: DeviceMotionEvent) => {
    const a = event.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    this.buffer.push({ x: a.x, y: a.y, z: a.z });
    if (this.buffer.length > 15) this.buffer.shift();
    this.lastAt = Date.now();
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

  reading(): GravityReading | null {
    if (!this.hasSignal()) return null;
    const n = this.buffer.length;
    const mean = this.buffer.reduce(
      (acc, s) => ({ x: acc.x + s.x / n, y: acc.y + s.y / n, z: acc.z + s.z / n }),
      { x: 0, y: 0, z: 0 },
    );
    const screenAngleDeg = readScreenAngleDeg(screen.orientation);
    const sample: GravitySample = { accelerationIncludingGravity: mean, screenAngleDeg, timestampMs: Date.now() };
    const projected = imageDownFromSample(sample);
    if (projected.inPlane === 0) return null;
    const down = downInScreenPixels(projected, screenAngleDeg);
    const plumb = plumbFromDown(down);
    const base = Math.atan2(down.y, down.x);
    let sq = 0;
    for (const s of this.buffer) {
      const p = imageDownFromSample({ accelerationIncludingGravity: s, screenAngleDeg, timestampMs: 0 });
      const d = downInScreenPixels(p, screenAngleDeg);
      let delta = Math.atan2(d.y, d.x) - base;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      sq += delta * delta;
    }
    return {
      plumb,
      noiseRad: Math.sqrt(sq / n),
      stationary: isStationary(this.buffer),
      flat: projected.isFlat,
      pitchDeg: pitchFromProjection(projected.towardUser, projected.magnitude),
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

/** Draws the live plumb line and tilt over the preview. */
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
  ctx.lineWidth = 3 * dpr;
  ctx.font = `${Math.round(15 * dpr)}px system-ui, sans-serif`;
  if (!reading) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, w, 34 * dpr);
    ctx.fillStyle = "#f4efe4";
    ctx.fillText("No gravity reading yet. Tap “Allow motion sensors”.", 10 * dpr, 23 * dpr);
    return;
  }
  const { down } = reading.plumb;
  const len = Math.hypot(w, h);
  ctx.strokeStyle = reading.stationary ? "#7fd3a0" : "#e3b23c";
  ctx.setLineDash([12 * dpr, 8 * dpr]);
  ctx.beginPath();
  ctx.moveTo(centre.x - down.x * len, centre.y - down.y * len);
  ctx.lineTo(centre.x + down.x * len, centre.y + down.y * len);
  ctx.stroke();
  ctx.setLineDash([]);
  // A small plumb bob at the lower end of the line.
  const bob = { x: centre.x + down.x * h * 0.32, y: centre.y + down.y * h * 0.32 };
  ctx.fillStyle = ctx.strokeStyle;
  ctx.beginPath();
  ctx.arc(bob.x, bob.y, 8 * dpr, 0, Math.PI * 2);
  ctx.fill();
  const tilt = imageTiltDeg(reading.plumb);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, w, 34 * dpr);
  ctx.fillStyle = "#f4efe4";
  const steady = reading.flat ? "phone is flat: hold it upright" : reading.stationary ? "steady" : "hold still";
  ctx.fillText(
    `Plumb line from gravity · tilt ${Math.abs(tilt).toFixed(1)}° · ±${radToDeg(reading.noiseRad).toFixed(2)}° · ${steady}`,
    10 * dpr,
    23 * dpr,
  );
  // Side-view check: the camera should look level at the edge, not down at it.
  const pitch = Math.abs(reading.pitchDeg);
  const level = pitch <= SIDE_VIEW_MAX_PITCH_DEG;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, h - 34 * dpr, w, 34 * dpr);
  ctx.fillStyle = level ? "#9fe0b5" : "#ff9d8f";
  ctx.fillText(
    level
      ? `Camera level within ${pitch.toFixed(0)}° · side view OK`
      : `Camera pitched ${pitch.toFixed(0)}° · hold the phone level with the edge`,
    10 * dpr,
    h - 11 * dpr,
  );
}
