import { describe, expect, it } from "vitest";
import { fitCircle } from "../src/physics/rotation.js";

describe("arc fit", () => {
  it("recovers a known circle centre and radius within 1%", () => {
    const center = { x: 100, y: 80 };
    const radius = 40;
    const points = Array.from({ length: 36 }, (_, i) => {
      const t = (i / 36) * Math.PI * 1.2;
      return { x: center.x + radius * Math.cos(t), y: center.y + radius * Math.sin(t) };
    });
    const fit = fitCircle(points);
    expect(Math.abs(fit.center.x - center.x) / radius).toBeLessThan(0.01);
    expect(Math.abs(fit.center.y - center.y) / radius).toBeLessThan(0.01);
    expect(Math.abs(fit.radius - radius) / radius).toBeLessThan(0.01);
    expect(fit.isRotation).toBe(true);
  });

  it("rejects a square path as not rotation", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 20, y: 20 },
      { x: 10, y: 20 },
      { x: 0, y: 20 },
      { x: 0, y: 10 },
    ];
    const fit = fitCircle(points);
    expect(fit.isRotation).toBe(false);
  });
});
