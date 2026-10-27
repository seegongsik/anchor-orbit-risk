/**
 * A labeled SYNTHETIC side view used by tests and by the "Load synthetic
 * example" button: a box near a desk edge, an A4 sheet for scale, the floor,
 * all rolled by a known angle as if the phone were tilted. Nothing here is a
 * camera frame or a SAM result.
 */
import { STANDARD_G } from "../physics/constants.js";
import { degToRad, rotate, type Vec2 } from "../physics/geometry.js";
import { pointInPolygon, type BinaryMask } from "../physics/mask.js";
import { plumbFromDown, type Plumb } from "../physics/plumb.js";
import type { DeviceAcceleration } from "../sensors/gravity.js";

export const SYNTHETIC = {
  width: 960,
  height: 1280,
  metersPerPixel: 0.001,
  rollDeg: 6,
  floorY: 1240,
  tableTopY: 500,
  tableLeftX: 60,
  edgeX: 485,
  slabPx: 30,
  leg: { x0: 420, x1: 455 },
  object: { x0: 380, y0: 360, x1: 470, y1: 500 },
  a4: { x0: 150, y0: 203, x1: 360, y1: 500 },
} as const;

const centre = { x: SYNTHETIC.width / 2, y: SYNTHETIC.height / 2 };

function roll(p: Vec2): Vec2 {
  return rotate(p, degToRad(SYNTHETIC.rollDeg), centre);
}

function rect(x0: number, y0: number, x1: number, y1: number): Vec2[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ].map(roll);
}

export type SyntheticScene = {
  width: number;
  height: number;
  plumb: Plumb;
  accelerationIncludingGravity: DeviceAcceleration;
  objectPolygon: Vec2[];
  supportPolygons: Vec2[][];
  a4Polygon: Vec2[];
  scaleTaps: [Vec2, Vec2];
  floorPoint: Vec2;
  expected: { dM: number; dropHeightM: number; comHeightAboveEdgeM: number };
};

export function syntheticScene(): SyntheticScene {
  const s = SYNTHETIC;
  const theta = degToRad(s.rollDeg);
  const down = { x: -Math.sin(theta), y: Math.cos(theta) };
  const objectCom = { x: (s.object.x0 + s.object.x1) / 2, y: (s.object.y0 + s.object.y1) / 2 };
  return {
    width: s.width,
    height: s.height,
    plumb: plumbFromDown(down),
    // Image down (u, v) = (down.x, -down.y_device) with down = -a, so a = (-u, v, 0) * g.
    accelerationIncludingGravity: { x: -down.x * STANDARD_G, y: down.y * STANDARD_G, z: 0 },
    objectPolygon: rect(s.object.x0, s.object.y0, s.object.x1, s.object.y1),
    supportPolygons: [
      rect(s.tableLeftX, s.tableTopY, s.edgeX, s.tableTopY + s.slabPx),
      rect(s.leg.x0, s.tableTopY + s.slabPx, s.leg.x1, s.floorY),
    ],
    a4Polygon: rect(s.a4.x0, s.a4.y0, s.a4.x1, s.a4.y1),
    scaleTaps: [roll({ x: s.a4.x0 + 4, y: s.a4.y0 }), roll({ x: s.a4.x0 + 4, y: s.a4.y1 })],
    floorPoint: roll({ x: s.edgeX, y: s.floorY }),
    expected: {
      dM: (s.edgeX - objectCom.x) * s.metersPerPixel,
      dropHeightM: (s.floorY - s.tableTopY) * s.metersPerPixel,
      comHeightAboveEdgeM: (s.tableTopY - objectCom.y) * s.metersPerPixel,
    },
  };
}

/** Rasterises polygons into one full-frame mask. */
export function polygonsMask(polygons: Vec2[][], width: number, height: number): BinaryMask {
  const data = new Uint8Array(width * height);
  for (const poly of polygons) {
    const x0 = Math.max(0, Math.floor(Math.min(...poly.map((p) => p.x))));
    const x1 = Math.min(width, Math.ceil(Math.max(...poly.map((p) => p.x))));
    const y0 = Math.max(0, Math.floor(Math.min(...poly.map((p) => p.y))));
    const y1 = Math.min(height, Math.ceil(Math.max(...poly.map((p) => p.y))));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        if (pointInPolygon({ x: x + 0.5, y: y + 0.5 }, poly)) data[y * width + x] = 1;
      }
    }
  }
  return { width, height, data };
}

function fillPoly(ctx: CanvasRenderingContext2D, poly: Vec2[], color: string): void {
  ctx.beginPath();
  poly.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

export function drawSyntheticScene(canvas: HTMLCanvasElement, scene: SyntheticScene): void {
  canvas.width = scene.width;
  canvas.height = scene.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  ctx.fillStyle = "#d9d4c7";
  ctx.fillRect(0, 0, scene.width, scene.height);
  const s = SYNTHETIC;
  fillPoly(ctx, rect(-400, s.floorY, s.width + 400, s.height + 600), "#8a8172");
  for (const poly of scene.supportPolygons) fillPoly(ctx, poly, "#6b4f35");
  fillPoly(ctx, scene.a4Polygon, "#fbfbf6");
  fillPoly(ctx, scene.objectPolygon, "#c8553d");
  ctx.save();
  ctx.translate(centre.x, centre.y);
  ctx.rotate(degToRad(s.rollDeg));
  ctx.fillStyle = "#1b1b1b";
  ctx.font = "bold 34px system-ui, sans-serif";
  ctx.fillText("SYNTHETIC", -centre.x + 40, -centre.y + 70);
  ctx.font = "22px system-ui, sans-serif";
  ctx.fillText("A4 297 mm", s.a4.x0 - centre.x + 20, (s.a4.y0 + s.a4.y1) / 2 - centre.y);
  ctx.restore();
}
