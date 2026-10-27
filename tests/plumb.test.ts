import { describe, expect, it } from "vitest";
import { degToRad, rotate } from "../src/physics/geometry.js";
import { filledRectMask, maskCentroid, maskFromRuns, polygonMask } from "../src/physics/mask.js";
import {
  edgeMargin,
  imageTiltDeg,
  marginMonteCarlo,
  marginShiftWithoutGravity,
  plumbFromAngle,
  plumbFromDown,
  supportCorner,
} from "../src/physics/plumb.js";

// All geometry below is SYNTHETIC: known rectangles, rotated by a known roll.

describe("plumb line (synthetic)", () => {
  it("reads zero tilt for an upright photo and the roll angle otherwise", () => {
    expect(imageTiltDeg(plumbFromDown({ x: 0, y: 1 }))).toBeCloseTo(0, 10);
    const rolled = plumbFromDown({ x: Math.sin(degToRad(7)), y: Math.cos(degToRad(7)) });
    expect(Math.abs(imageTiltDeg(rolled))).toBeCloseTo(7, 6);
    // The opposite sign convention gives the same line and the same tilt.
    const flipped = plumbFromDown({ x: -Math.sin(degToRad(7)), y: -Math.cos(degToRad(7)) });
    expect(Math.abs(imageTiltDeg(flipped))).toBeCloseTo(7, 6);
  });

  it("measures d perpendicular to gravity and is invariant to a camera roll", () => {
    // Upright scene: edge at x=250, COM at x=195 -> d = 55 px over the support.
    const com = { x: 195, y: 280 };
    const edge = { x: 250, y: 360 };
    const supportPoint = { x: 100, y: 360 };
    const upright = edgeMargin({
      com,
      edge,
      supportPoint,
      plumb: plumbFromDown({ x: 0, y: 1 }),
      metersPerPixel: 0.002,
    });
    expect(upright.dPx).toBeCloseTo(55, 9);
    expect(upright.dM).toBeCloseTo(0.11, 9);
    expect(upright.comHeightAboveEdgePx).toBeCloseTo(80, 9);

    // Roll the whole scene (and gravity with it) by 12 degrees about the edge.
    const roll = degToRad(12);
    const r = (p: { x: number; y: number }) => rotate(p, roll, edge);
    const rolledPlumb = plumbFromAngle(Math.PI / 2 + roll);
    const rolled = edgeMargin({
      com: r(com),
      edge: r(edge),
      supportPoint: r(supportPoint),
      plumb: rolledPlumb,
      metersPerPixel: 0.002,
    });
    expect(rolled.dPx).toBeCloseTo(55, 9);
    // Using the image vertical instead of gravity would be wrong by h*sin(roll)-ish.
    const shift = marginShiftWithoutGravity({
      com: r(com),
      edge: r(edge),
      supportPoint: r(supportPoint),
      plumb: rolledPlumb,
      metersPerPixel: 0.002,
    });
    expect(Math.abs(shift)).toBeGreaterThan(0.02);
  });

  it("marks a centre of mass beyond the edge as negative", () => {
    const result = edgeMargin({
      com: { x: 262, y: 300 },
      edge: { x: 250, y: 360 },
      supportPoint: { x: 100, y: 360 },
      plumb: plumbFromDown({ x: 0, y: 1 }),
      metersPerPixel: 0.001,
    });
    expect(result.dPx).toBeCloseTo(-12, 9);
  });

  it("finds the table corner nearest the object from masks", () => {
    const width = 400;
    const height = 520;
    // Table top 360..380 from x=20 to x=250, a leg below it, object on top.
    const table = filledRectMask(20, 360, 250, 380, width, height);
    for (let y = 380; y < 520; y += 1) for (let x = 200; x < 215; x += 1) table.data[y * width + x] = 1;
    const object = filledRectMask(180, 200, 240, 360, width, height);
    const found = supportCorner({
      support: table,
      object,
      plumb: plumbFromDown({ x: 0, y: 1 }),
      imageWidth: width,
      imageHeight: height,
    });
    expect(found.side).toBe("max");
    expect(found.corner.x).toBeCloseTo(250, 6);
    expect(found.marginPxToMax).toBeCloseTo(40, 6);
    const margin = edgeMargin({
      com: maskCentroid(object),
      edge: found.corner,
      supportPoint: found.supportPoint,
      plumb: plumbFromDown({ x: 0, y: 1 }),
      metersPerPixel: 0.001,
    });
    expect(margin.dPx).toBeCloseTo(40, 6);
  });

  it("ignores a support end that is cut off by the image border", () => {
    const width = 300;
    const height = 300;
    const table = filledRectMask(0, 200, 220, 215, width, height);
    const object = filledRectMask(30, 150, 60, 200, width, height);
    const found = supportCorner({
      support: table,
      object,
      plumb: plumbFromDown({ x: 0, y: 1 }),
      imageWidth: width,
      imageHeight: height,
    });
    expect(found.marginPxToMin).toBeNull();
    expect(found.side).toBe("max");
  });

  it("decodes run masks that are smaller than their box", () => {
    // A 2x2 raster covering a 10x10 box: one set pixel at raster (1,0).
    const mask = maskFromRuns({ bounds: { left: 100, top: 50, right: 110, bottom: 60 }, width: 2, height: 2, runs: [1, 1, 2] });
    const c = maskCentroid(mask);
    expect(c.x).toBeCloseTo(107.5, 9);
    expect(c.y).toBeCloseTo(52.5, 9);
  });

  it("rasterises a polygon into a cropped mask", () => {
    const mask = polygonMask([
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 20 },
      { x: 10, y: 20 },
    ]);
    const c = maskCentroid(mask);
    expect(c.x).toBeCloseTo(20, 6);
    expect(c.y).toBeCloseTo(15, 6);
  });

  it("Monte Carlo is reproducible and centred on the exact margin", () => {
    const input = {
      com: { x: 195, y: 280 },
      edge: { x: 250, y: 360 },
      supportPoint: { x: 100, y: 360 },
      plumb: plumbFromDown({ x: 0, y: 1 }),
      metersPerPixel: 0.002,
      sigma: { comPx: 2, edgePx: 1, gravityRad: degToRad(0.5), scaleRel: 0.02 },
    };
    const a = marginMonteCarlo(input);
    const b = marginMonteCarlo(input);
    expect(a.d.value).toBe(b.d.value);
    expect(a.pUnstable).toBe(b.pUnstable);
    expect(Math.abs(a.d.value - 0.11) / 0.11).toBeLessThan(0.01);
    expect(a.pUnstable).toBe(0);
    expect(a.percentiles.p5).toBeLessThan(a.percentiles.p95);
  });

  it("gives about one half unstable when the centre sits on the edge", () => {
    const mc = marginMonteCarlo({
      com: { x: 250, y: 300 },
      edge: { x: 250, y: 360 },
      supportPoint: { x: 100, y: 360 },
      plumb: plumbFromDown({ x: 0, y: 1 }),
      metersPerPixel: 0.001,
      sigma: { comPx: 2, edgePx: 1, gravityRad: degToRad(0.5), scaleRel: 0.02 },
      iterations: 4000,
    });
    expect(mc.pUnstable).toBeGreaterThan(0.45);
    expect(mc.pUnstable).toBeLessThan(0.55);
  });
});
