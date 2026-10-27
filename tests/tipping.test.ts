import { describe, expect, it } from "vitest";
import { degToRad } from "../src/physics/geometry.js";
import { polygonMask } from "../src/physics/mask.js";
import { plumbFromAngle, plumbFromDown } from "../src/physics/plumb.js";
import { baseCorners, predictTipAngle, tipAngle } from "../src/physics/tipping.js";
import { angleBetweenDeg, detectTip, type TiltSample } from "../src/sensors/tilt.js";

// SYNTHETIC shapes: exact rectangles and an L, drawn into masks.

const rad = (deg: number) => degToRad(deg);

/** A w × h rectangle standing on its base at (cx, baseY), rotated by `rollDeg` in the image. */
function standing(cx: number, baseY: number, w: number, h: number, rollDeg: number) {
  const c = Math.cos(rad(rollDeg));
  const s = Math.sin(rad(rollDeg));
  const local = [
    { x: -w / 2, y: 0 },
    { x: w / 2, y: 0 },
    { x: w / 2, y: -h },
    { x: -w / 2, y: -h },
  ];
  return local.map((p) => ({ x: cx + p.x * c - p.y * s, y: baseY + p.x * s + p.y * c }));
}

describe("tipping angle about the base (synthetic)", () => {
  it("is atan(half width / centre height) for an upright block", () => {
    const plumb = plumbFromDown({ x: 0, y: 1 });
    const object = polygonMask(standing(300, 500, 60, 200, 0));
    const corners = baseCorners(object, plumb);
    expect(corners.min.x).toBeCloseTo(270, 0);
    expect(corners.max.x).toBeCloseTo(330, 0);
    expect(corners.max.y).toBeCloseTo(500, 0);
    const expected = (Math.atan(30 / 100) * 180) / Math.PI;
    const p = predictTipAngle({ object, plumb, sigma: { comPx: 0, edgePx: 0, gravityRad: 0 } });
    expect(Math.abs(p.geometry.angleDeg - expected)).toBeLessThan(0.4);
    expect(Math.abs(p.sides.min.angleDeg - p.sides.max.angleDeg)).toBeLessThan(0.4);
  });

  it("measures against gravity when the phone is rolled", () => {
    // The block stands upright in the world; the phone is rolled by 6°, so the
    // block and gravity both appear rotated by 6° in the photo.
    const roll = 6;
    const plumb = plumbFromAngle(Math.PI / 2 + rad(roll));
    const object = polygonMask(standing(300, 500, 60, 200, roll));
    const p = predictTipAngle({ object, plumb, sigma: { comPx: 0, edgePx: 0, gravityRad: 0 } });
    const expected = (Math.atan(30 / 100) * 180) / Math.PI;
    expect(Math.abs(p.geometry.angleDeg - expected)).toBeLessThan(0.5);
    // Reading the same corners against the photo's own vertical would make one
    // side 6° steeper and the other 6° shallower.
    const imagePlumb = plumbFromDown({ x: 0, y: 1 });
    const corners = baseCorners(object, plumb);
    const naiveMin = tipAngle(p.geometry.com, corners.min, "min", imagePlumb).angleDeg;
    const naiveMax = tipAngle(p.geometry.com, corners.max, "max", imagePlumb).angleDeg;
    expect(Math.abs(naiveMin - naiveMax)).toBeGreaterThan(11);
    expect(Math.abs(naiveMin - naiveMax)).toBeLessThan(13);
  });

  it("picks the easier side of an uneven outline and spreads with the errors", () => {
    const plumb = plumbFromDown({ x: 0, y: 1 });
    // An L: a wide foot on the right lowers and shifts the centre of mass.
    const object = polygonMask([
      { x: 200, y: 500 },
      { x: 360, y: 500 },
      { x: 360, y: 460 },
      { x: 240, y: 460 },
      { x: 240, y: 300 },
      { x: 200, y: 300 },
    ]);
    const p = predictTipAngle({ object, plumb, sigma: { comPx: 2, edgePx: 3, gravityRad: rad(0.5) } });
    expect(p.side).toBe("min");
    expect(p.sides.min.angleDeg).toBeLessThan(p.sides.max.angleDeg);
    expect(p.p5Deg).toBeLessThan(p.meanDeg);
    expect(p.p95Deg).toBeGreaterThan(p.meanDeg);
    expect(p.stdDeg).toBeGreaterThan(0);
    expect(Math.abs(p.meanDeg - p.geometry.angleDeg)).toBeLessThan(0.5);
  });

  it("rejects a corner above the centre of mass", () => {
    const plumb = plumbFromDown({ x: 0, y: 1 });
    expect(() => tipAngle({ x: 0, y: 0 }, { x: 10, y: -5 }, "max", plumb)).toThrow();
  });
});

describe("board tilt and tip detection (synthetic samples)", () => {
  it("reads the angle between two gravity readings", () => {
    const level = { x: 0, y: 0, z: 9.8 };
    const tilted = { x: 0, y: 9.8 * Math.sin(rad(20)), z: 9.8 * Math.cos(rad(20)) };
    expect(angleBetweenDeg(level, tilted)).toBeCloseTo(20, 9);
    expect(angleBetweenDeg(level, level)).toBeCloseTo(0, 9);
    expect(() => angleBetweenDeg(level, { x: 0, y: 0, z: 0 })).toThrow();
  });

  it("reads the board angle just before the landing jolt", () => {
    const samples: TiltSample[] = [];
    for (let t = 0; t <= 15000; t += 50) {
      const tiltDeg = t * 0.002; // 2° per second
      const jolt = t === 300 ? 3 : t === 10500 ? 6 : 0.2; // a bump while picking the board up, then the landing
      samples.push({ t, tiltDeg, jolt });
    }
    const tip = detectTip(samples);
    expect(tip?.atMs).toBe(10500);
    expect(tip?.tiltDeg).toBeCloseTo(20.5, 9);
    expect(detectTip(samples.map((s) => ({ ...s, jolt: 0.2 })))).toBeNull();
  });
});
