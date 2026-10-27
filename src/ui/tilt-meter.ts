/** Live board tilt from the phone lying on the board, with tip detection. */
import type { Vec3 } from "../physics/geometry.js";
import { angleBetweenDeg, detectTip, TIP_DETECTION, type TiltSample } from "../sensors/tilt.js";

export type TiltMeterEvents = {
  onTilt: (tiltDeg: number) => void;
  onTip: (tip: { tiltDeg: number; atMs: number; how: "jolt" | "button" }) => void;
};

/**
 * Takes the first readings as level (the board flat, the phone lying on it),
 * then reports how far the board has turned. A sudden acceleration after the
 * board has started to tilt counts as the object landing.
 */
export class TiltMeter {
  private tare: Vec3 | null = null;
  private tareBuffer: Vec3[] = [];
  private smooth: Vec3 | null = null;
  private samples: TiltSample[] = [];
  private done = false;
  private readonly handler = (event: DeviceMotionEvent) => this.onMotion(event);

  constructor(private readonly events: TiltMeterEvents) {}

  start(): void {
    window.addEventListener("devicemotion", this.handler);
  }

  stop(): void {
    window.removeEventListener("devicemotion", this.handler);
  }

  current(): number | null {
    return this.samples.length > 0 ? this.samples[this.samples.length - 1].tiltDeg : null;
  }

  /** The user saw it tip: record the angle a reaction time ago. */
  tipped(): void {
    if (this.done || this.samples.length === 0) return;
    const now = this.samples[this.samples.length - 1].t;
    const readAt = now - TIP_DETECTION.lookbackMs;
    let chosen = this.samples[0];
    for (const s of this.samples) if (s.t <= readAt) chosen = s;
    this.finish({ tiltDeg: chosen.tiltDeg, atMs: now, how: "button" });
  }

  private finish(tip: { tiltDeg: number; atMs: number; how: "jolt" | "button" }): void {
    this.done = true;
    this.stop();
    this.events.onTip(tip);
  }

  private onMotion(event: DeviceMotionEvent): void {
    if (this.done) return;
    const a = event.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    const g = { x: a.x, y: a.y, z: a.z };
    const t = event.timeStamp;
    if (!this.tare) {
      this.tareBuffer.push(g);
      if (this.tareBuffer.length < 10) return;
      const n = this.tareBuffer.length;
      this.tare = this.tareBuffer.reduce((m, s) => ({ x: m.x + s.x / n, y: m.y + s.y / n, z: m.z + s.z / n }), { x: 0, y: 0, z: 0 });
      this.smooth = this.tare;
      return;
    }
    const prev = this.smooth ?? g;
    const k = 0.25;
    this.smooth = { x: prev.x + k * (g.x - prev.x), y: prev.y + k * (g.y - prev.y), z: prev.z + k * (g.z - prev.z) };
    const lin = event.acceleration;
    const jolt =
      lin && lin.x !== null && lin.y !== null && lin.z !== null
        ? Math.hypot(lin.x, lin.y, lin.z)
        : Math.hypot(g.x - prev.x, g.y - prev.y, g.z - prev.z);
    const tiltDeg = angleBetweenDeg(this.tare, this.smooth);
    this.samples.push({ t, tiltDeg, jolt });
    while (this.samples.length > 0 && this.samples[0].t < t - 5000) this.samples.shift();
    this.events.onTilt(tiltDeg);
    const tip = detectTip(this.samples);
    if (tip) this.finish({ ...tip, how: "jolt" });
  }
}
