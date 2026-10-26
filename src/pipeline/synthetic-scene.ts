import { STANDARD_G } from "../physics/constants.ts";
import { filledRectMask } from "../physics/tipover.ts";
import type { Vec2 } from "../physics/geometry.ts";
import type { DeviceAcceleration } from "../sensors/gravity.ts";

/**
 * Labeled synthetic side-view: a block sitting on a table, near an edge.
 * Used only in tests and in the UI path marked SYNTHETIC.
 */
export const SYNTHETIC_SCENE = {
  label: "synthetic" as const,
  width: 390,
  height: 520,
  tableTopY: 360,
  edgeX: 250,
  object: { x0: 150, y0: 200, x1: 240, y1: 360 },
  supportToward: { x: 40, y: 400 } satisfies Vec2,
  metersPerPixel: 0.002,
  /** Upright portrait, W3C/MDN rest: +y ≈ +g. */
  accelerationIncludingGravity: {
    x: 0,
    y: STANDARD_G,
    z: 0,
  } satisfies DeviceAcceleration,
  comSigmaPx: 1,
  edgeSigmaPx: 0.5,
  metersPerPixelSigma: 0,
};

export function syntheticObjectMask() {
  return filledRectMask(
    SYNTHETIC_SCENE.object.x0,
    SYNTHETIC_SCENE.object.y0,
    SYNTHETIC_SCENE.object.x1,
    SYNTHETIC_SCENE.object.y1,
    SYNTHETIC_SCENE.width,
    SYNTHETIC_SCENE.height,
  );
}

export function expectedSyntheticCom(): Vec2 {
  const { object } = SYNTHETIC_SCENE;
  return {
    x: (object.x0 + object.x1) / 2,
    y: (object.y0 + object.y1) / 2,
  };
}

export function expectedSyntheticDMetres(): number {
  const com = expectedSyntheticCom();
  return (SYNTHETIC_SCENE.edgeX - com.x) * SYNTHETIC_SCENE.metersPerPixel;
}

export function drawSyntheticScene(canvas: HTMLCanvasElement): void {
  canvas.width = SYNTHETIC_SCENE.width;
  canvas.height = SYNTHETIC_SCENE.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  ctx.fillStyle = "#2a2d22";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#7a6240";
  ctx.fillRect(0, SYNTHETIC_SCENE.tableTopY, SYNTHETIC_SCENE.edgeX, canvas.height - SYNTHETIC_SCENE.tableTopY);
  ctx.fillStyle = "#5a4a30";
  ctx.fillRect(0, SYNTHETIC_SCENE.tableTopY, SYNTHETIC_SCENE.edgeX, 10);
  ctx.fillStyle = "#e6c27a";
  ctx.fillRect(
    SYNTHETIC_SCENE.object.x0,
    SYNTHETIC_SCENE.object.y0,
    SYNTHETIC_SCENE.object.x1 - SYNTHETIC_SCENE.object.x0,
    SYNTHETIC_SCENE.object.y1 - SYNTHETIC_SCENE.object.y0,
  );
  ctx.strokeStyle = "#5a3f18";
  ctx.lineWidth = 2;
  ctx.strokeRect(
    SYNTHETIC_SCENE.object.x0,
    SYNTHETIC_SCENE.object.y0,
    SYNTHETIC_SCENE.object.x1 - SYNTHETIC_SCENE.object.x0,
    SYNTHETIC_SCENE.object.y1 - SYNTHETIC_SCENE.object.y0,
  );
  ctx.strokeStyle = "#e3b23c";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(SYNTHETIC_SCENE.edgeX, 40);
  ctx.lineTo(SYNTHETIC_SCENE.edgeX, canvas.height - 20);
  ctx.stroke();
}
