import type { PipelineResult } from "../pipeline/tipover-pipeline.ts";
import type { Vec2 } from "../physics/geometry.ts";

export type OverlayInput = {
  image: HTMLImageElement | HTMLCanvasElement;
  result: PipelineResult;
  edgeA: Vec2;
  edgeB: Vec2;
};

export function drawOverlay(canvas: HTMLCanvasElement, input: OverlayInput): void {
  const width =
    input.image instanceof HTMLImageElement
      ? input.image.naturalWidth
      : input.image.width;
  const height =
    input.image instanceof HTMLImageElement
      ? input.image.naturalHeight
      : input.image.height;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(input.image, 0, 0, width, height);

  if (input.result.maskSource === "synthetic") {
    ctx.fillStyle = "rgba(227, 178, 60, 0.92)";
    ctx.fillRect(0, 0, width, 28);
    ctx.fillStyle = "#12140f";
    ctx.font = "700 13px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText("SYNTHETIC — not a camera frame, not a SAM result", 10, 19);
  }

  ctx.strokeStyle = "#e3b23c";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(input.edgeA.x, input.edgeA.y);
  ctx.lineTo(input.edgeB.x, input.edgeB.y);
  ctx.stroke();

  const { com } = input.result;
  ctx.fillStyle = "#f4efe4";
  ctx.beginPath();
  ctx.arc(com.x, com.y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#12140f";
  ctx.lineWidth = 2;
  ctx.stroke();

  const down = input.result.gravity;
  if (!down.isFlat && down.inPlane > 0) {
    const scale = 48 / down.inPlane;
    ctx.strokeStyle = "#8ec8ff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(com.x, com.y);
    ctx.lineTo(com.x + down.u * scale, com.y + down.v * scale);
    ctx.stroke();
  }

  const edgeX = (input.edgeA.x + input.edgeB.x) / 2;
  ctx.strokeStyle = "#e07a5f";
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(com.x, com.y);
  ctx.lineTo(edgeX, com.y);
  ctx.stroke();
  ctx.setLineDash([]);

  const radius = Math.hypot(edgeX - com.x, 80);
  ctx.strokeStyle = "#6f8f7a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(edgeX, com.y, radius, -Math.PI / 2, Math.PI / 2, false);
  ctx.stroke();

  ctx.fillStyle = "rgba(224, 122, 95, 0.28)";
  ctx.fillRect(Math.max(edgeX, 0), 0, Math.max(0, width - edgeX), height);

  ctx.fillStyle = "#f4efe4";
  ctx.font = "700 14px ui-monospace, monospace";
  const label = `d = ${input.result.d.value.toFixed(3)} m`;
  ctx.fillText(label, Math.min(com.x, edgeX) + 8, com.y - 10);
}
