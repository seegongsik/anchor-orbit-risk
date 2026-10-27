/** Draws the anchor (edge), the plumb line, the orbit and the margin on a still. */
import type { Vec2 } from "../physics/geometry.js";
import type { BinaryMask } from "../physics/mask.js";
import type { Plumb } from "../physics/plumb.js";
import { formatLength } from "../risk/format.js";
import type { EdgeGeometry } from "../pipeline/measure.js";

export type Overlay = {
  object?: BinaryMask;
  support?: BinaryMask;
  polygonDraft: Vec2[];
  scaleTaps: Vec2[];
  scaleLabel: string;
  floorPoint?: Vec2;
  manualEdge?: Vec2;
  manualSupportPoint?: Vec2;
  ladder: Vec2[];
  geometry?: EdgeGeometry;
  dM?: number;
  /** Replaces the "d = …" label, for the tilt check. */
  marginLabel?: string;
  plumb: Plumb;
  label: string;
};

function paintMask(ctx: CanvasRenderingContext2D, mask: BinaryMask, rgba: [number, number, number, number]): void {
  const off = document.createElement("canvas");
  off.width = mask.width;
  off.height = mask.height;
  const octx = off.getContext("2d");
  if (!octx) return;
  const img = octx.createImageData(mask.width, mask.height);
  for (let i = 0; i < mask.data.length; i += 1) {
    if (!mask.data[i]) continue;
    img.data[i * 4] = rgba[0];
    img.data[i * 4 + 1] = rgba[1];
    img.data[i * 4 + 2] = rgba[2];
    img.data[i * 4 + 3] = rgba[3];
  }
  octx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    off,
    mask.originX ?? 0,
    mask.originY ?? 0,
    mask.width * (mask.scaleX ?? 1),
    mask.height * (mask.scaleY ?? 1),
  );
  ctx.imageSmoothingEnabled = true;
}

function dot(ctx: CanvasRenderingContext2D, p: Vec2, r: number, fill: string, ring = "#12140f"): void {
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(2, r * 0.35);
  ctx.strokeStyle = ring;
  ctx.stroke();
}

function label(ctx: CanvasRenderingContext2D, text: string, p: Vec2, size: number, align: "left" | "center" = "left"): void {
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width;
  const x = align === "center" ? p.x - w / 2 : p.x;
  ctx.fillStyle = "rgba(18,20,15,0.82)";
  ctx.fillRect(x - 4, p.y - size, w + 8, size * 1.3);
  ctx.fillStyle = "#f4efe4";
  ctx.fillText(text, x, p.y);
}

export function drawStill(canvas: HTMLCanvasElement, image: HTMLCanvasElement, o: Overlay): void {
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  // One unit is about one CSS pixel when the still is shown 360 px wide.
  const unit = image.width / 360;
  ctx.drawImage(image, 0, 0);
  if (o.support) paintMask(ctx, o.support, [80, 150, 230, 90]);
  if (o.object) paintMask(ctx, o.object, [235, 120, 60, 120]);

  if (o.polygonDraft.length > 0) {
    ctx.strokeStyle = "#e3b23c";
    ctx.lineWidth = unit * 2;
    ctx.beginPath();
    o.polygonDraft.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    for (const p of o.polygonDraft) dot(ctx, p, unit * 4, "#e3b23c");
  }

  const g = o.geometry;
  if (g) {
    const len = Math.hypot(image.width, image.height);
    const { down, horizontal } = g.plumb;
    // Plumb line through the anchor.
    ctx.setLineDash([unit * 6, unit * 4]);
    ctx.strokeStyle = "#f4efe4";
    ctx.lineWidth = unit * 1.5;
    ctx.beginPath();
    ctx.moveTo(g.edge.x - down.x * len, g.edge.y - down.y * len);
    ctx.lineTo(g.edge.x + down.x * len, g.edge.y + down.y * len);
    ctx.stroke();
    ctx.setLineDash([]);

    // Orbit: if the object tips about the anchor, its centre of mass moves on a
    // circle around it, over the top of the plumb line and down the fall side.
    const fallSide = -g.supportSide;
    const rel = { x: g.com.x - g.edge.x, y: g.com.y - g.edge.y };
    const r = Math.max(unit * 4, Math.hypot(rel.x, rel.y));
    const start = Math.atan2(rel.y, rel.x);
    const up = Math.atan2(-down.y, -down.x);
    const outward = Math.atan2(horizontal.y * fallSide, horizontal.x * fallSide);
    const wrap = (a: number) => {
      let v = a;
      while (v > Math.PI) v -= 2 * Math.PI;
      while (v < -Math.PI) v += 2 * Math.PI;
      return v;
    };
    const sweep = (o.dM ?? 1) > 0 ? wrap(up - start) + wrap(outward - up) : wrap(outward - start);
    ctx.strokeStyle = "#8ec8ff";
    ctx.lineWidth = unit * 2;
    ctx.setLineDash([unit * 5, unit * 3]);
    ctx.beginPath();
    ctx.arc(g.edge.x, g.edge.y, r, start, start + sweep, sweep < 0);
    ctx.stroke();
    ctx.setLineDash([]);
    const end = { x: g.edge.x + Math.cos(start + sweep) * r, y: g.edge.y + Math.sin(start + sweep) * r };
    if (o.floorPoint) {
      ctx.strokeStyle = "rgba(142,200,255,0.6)";
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      const drop = (o.floorPoint.x - end.x) * down.x + (o.floorPoint.y - end.y) * down.y;
      ctx.lineTo(end.x + down.x * drop, end.y + down.y * drop);
      ctx.stroke();
    }
    const top = { x: g.edge.x - down.x * r, y: g.edge.y - down.y * r };
    label(ctx, "orbit", { x: top.x + unit * 4, y: top.y - unit * 4 }, unit * 12);

    // Margin d: from the centre of mass across to the plumb line.
    const across = (g.com.x - g.edge.x) * horizontal.x + (g.com.y - g.edge.y) * horizontal.y;
    const foot = { x: g.com.x - horizontal.x * across, y: g.com.y - horizontal.y * across };
    const bad = (o.dM ?? 1) <= 0;
    ctx.strokeStyle = bad ? "#ff7a6b" : "#7fd3a0";
    ctx.lineWidth = unit * 2.5;
    ctx.beginPath();
    ctx.moveTo(g.com.x, g.com.y);
    ctx.lineTo(foot.x, foot.y);
    ctx.stroke();
    dot(ctx, g.com, unit * 5, bad ? "#ff7a6b" : "#7fd3a0");
    dot(ctx, g.edge, unit * 6, "#e3b23c");
    label(ctx, "anchor", { x: g.edge.x + unit * 8, y: g.edge.y + unit * 16 }, unit * 12);
    const marginText = o.marginLabel ?? (o.dM !== undefined ? `d = ${formatLength(o.dM)}` : undefined);
    if (marginText) {
      // Above the centre of mass, clear of the anchor below it.
      const lift = Math.max(unit * 30, Math.abs(g.comHeightAboveEdgePx) * 0.6);
      label(ctx, marginText, { x: g.com.x - down.x * lift, y: g.com.y - down.y * lift }, unit * 14, "center");
    }
  } else {
    if (o.manualEdge) dot(ctx, o.manualEdge, unit * 6, "#e3b23c");
    if (o.manualSupportPoint) dot(ctx, o.manualSupportPoint, unit * 5, "#5096e6");
  }

  if (o.scaleTaps.length > 0) {
    ctx.strokeStyle = "#f4efe4";
    ctx.lineWidth = unit * 2;
    ctx.beginPath();
    o.scaleTaps.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    for (const p of o.scaleTaps) dot(ctx, p, unit * 4, "#f4efe4");
    if (o.scaleTaps.length === 2) {
      const mid = { x: (o.scaleTaps[0].x + o.scaleTaps[1].x) / 2 + unit * 6, y: (o.scaleTaps[0].y + o.scaleTaps[1].y) / 2 };
      label(ctx, o.scaleLabel, mid, unit * 11);
    }
  }
  if (o.floorPoint) dot(ctx, o.floorPoint, unit * 5, "#c9c2ad");
  if (o.ladder.length > 0) {
    ctx.strokeStyle = "#e3b23c";
    ctx.lineWidth = unit * 3;
    ctx.beginPath();
    o.ladder.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    for (const p of o.ladder) dot(ctx, p, unit * 5, "#e3b23c");
  }
  label(ctx, o.label, { x: unit * 8, y: unit * 18 }, unit * 11);
}

export function canvasPoint(canvas: HTMLCanvasElement, event: { clientX: number; clientY: number }): Vec2 {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}
