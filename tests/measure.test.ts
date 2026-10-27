import { describe, expect, it } from "vitest";
import { localAssessment } from "../src/assessment/local.js";
import { A4_LONG_SIDE_M } from "../src/physics/constants.js";
import { polygonMask } from "../src/physics/mask.js";
import { plumbFromDown } from "../src/physics/plumb.js";
import { measureEdge, measureLadder, scaleFromTaps } from "../src/pipeline/measure.js";
import { polygonsMask, syntheticScene } from "../src/pipeline/synthetic-scene.js";
import { imageDownFromSample } from "../src/sensors/gravity.js";

// End to end on the SYNTHETIC scene: a phone rolled by 6 degrees.

describe("edge measurement on the synthetic scene", () => {
  const scene = syntheticScene();
  const object = polygonMask(scene.objectPolygon);
  const support = polygonsMask(scene.supportPolygons, scene.width, scene.height);
  const scale = scaleFromTaps(scene.scaleTaps[0], scene.scaleTaps[1], A4_LONG_SIDE_M, "A4 long side");

  it("gets the plumb line from the simulated accelerometer sample", () => {
    const down = imageDownFromSample({
      accelerationIncludingGravity: scene.accelerationIncludingGravity,
      screenAngleDeg: 0,
      timestampMs: 0,
    });
    const plumb = plumbFromDown({ x: down.u, y: down.v });
    expect(plumb.down.x).toBeCloseTo(scene.plumb.down.x, 9);
    expect(plumb.down.y).toBeCloseTo(scene.plumb.down.y, 9);
  });

  it("recovers d, the drop height and the scale within 2% despite the roll", () => {
    expect(scale.metersPerPixel).toBeCloseTo(0.001, 9);
    const result = measureEdge({
      imageWidth: scene.width,
      imageHeight: scene.height,
      plumb: scene.plumb,
      gravityNoiseRad: 0,
      object,
      objectSource: "synthetic",
      support,
      supportSource: "synthetic",
      scale,
      floorPoint: scene.floorPoint,
    });
    const m = result.measurement;
    // Rasterising a rolled rectangle moves its corner by a fraction of a pixel,
    // so this end-to-end check allows 2%; exact-geometry tests hold to 1e-9.
    expect(Math.abs(result.geometry.dPx * 0.001 - scene.expected.dM) / scene.expected.dM).toBeLessThan(0.02);
    expect(Math.abs(m.dM - scene.expected.dM) / scene.expected.dM).toBeLessThan(0.02);
    expect(Math.abs((m.dropHeightM ?? 0) - scene.expected.dropHeightM) / scene.expected.dropHeightM).toBeLessThan(0.02);
    expect(Math.abs(m.comHeightAboveEdgeM - scene.expected.comHeightAboveEdgeM) / scene.expected.comHeightAboveEdgeM).toBeLessThan(0.02);
    expect(Math.abs(m.gravityTiltDeg)).toBeCloseTo(6, 6);
    // Ignoring gravity (using the photo's own vertical) would be wrong by centimetres.
    expect(Math.abs(m.shiftWithoutGravityM)).toBeGreaterThan(0.005);
    expect(m.samplesM).toHaveLength(1000);
    expect(m.pUnstableNow).toBe(0);
  });

  it("feeds the local assessment end to end", () => {
    const result = measureEdge({
      imageWidth: scene.width,
      imageHeight: scene.height,
      plumb: scene.plumb,
      gravityNoiseRad: 0,
      object,
      objectSource: "synthetic",
      support,
      supportSource: "synthetic",
      scale,
      floorPoint: scene.floorPoint,
    });
    const { table } = localAssessment(
      [
        {
          id: "h1",
          kind: "edge",
          object: "box",
          support: "desk",
          massKg: { low: 0.5, high: 1, source: "user" },
          measurement: result.measurement,
        },
      ],
      { place: "synthetic", createdAt: "2026-10-27" },
    );
    expect(table.rows[0].risk).not.toBeNull();
    expect(table.rows[0].measurements.some((x) => x.value.includes("measured"))).toBe(true);
  });
});

describe("ladder measurement (synthetic)", () => {
  it("reads the angle from the ground against the plumb line", () => {
    const plumb = plumbFromDown({ x: 0, y: 1 });
    const ladder = measureLadder({
      foot: { x: 100, y: 900 },
      top: { x: 300, y: 100 },
      plumb,
      gravityNoiseRad: 0,
      maskSource: "manual",
    });
    expect(ladder.angleFromGroundDeg).toBeCloseTo((Math.atan(4) * 180) / Math.PI, 6);
  });
});
