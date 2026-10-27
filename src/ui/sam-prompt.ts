/**
 * What the person tells SAM 3.1 about one thing in the photo: a box dragged
 * around it, and taps that add a missed part or remove a wrong area. A single
 * tap in a cluttered photo is ambiguous (a point on a mug is also a point on
 * the desk under it), so the box and the corrections carry the intent. Whether
 * a tap adds or removes is the person's choice, not guessed from where it lands.
 */
import { forEachMaskPixel, maskContains, maskPixelCount, type BinaryMask } from "../physics/mask.js";
import type { Vec2 } from "../physics/geometry.js";

export type PromptBox = { left: number; top: number; right: number; bottom: number };
export type PromptPoint = { x: number; y: number; label: "positive" | "negative" };
export type RegionPrompt = { box?: PromptBox; points: PromptPoint[] };

/** The server accepts at most this many points in one prompt. */
export const MAX_PROMPT_POINTS = 8;

/** A drag longer than this share of the photo's shorter side is a box; shorter is a tap (an assumption). */
export const DRAG_MIN_SHARE = 0.04;

export type Gesture = { kind: "tap"; point: Vec2 } | { kind: "box"; box: PromptBox };

/** Integer box inside the image, or null when it is too small to mean anything. */
export function boxFromCorners(a: Vec2, b: Vec2, size: { width: number; height: number }): PromptBox | null {
  const left = Math.max(0, Math.floor(Math.min(a.x, b.x)));
  const top = Math.max(0, Math.floor(Math.min(a.y, b.y)));
  const right = Math.min(size.width, Math.ceil(Math.max(a.x, b.x)));
  const bottom = Math.min(size.height, Math.ceil(Math.max(a.y, b.y)));
  return right - left >= 2 && bottom - top >= 2 ? { left, top, right, bottom } : null;
}

export function classifyGesture(start: Vec2, end: Vec2, size: { width: number; height: number }): Gesture {
  const travel = Math.hypot(end.x - start.x, end.y - start.y);
  if (travel >= DRAG_MIN_SHARE * Math.min(size.width, size.height)) {
    const box = boxFromCorners(start, end, size);
    if (box) return { kind: "box", box };
  }
  return { kind: "tap", point: end };
}

/** The tight box around a mask's set pixels, in image pixels, or null for an empty mask. */
export function maskBox(mask: BinaryMask, size: { width: number; height: number }): PromptBox | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const hx = (mask.scaleX ?? 1) / 2;
  const hy = (mask.scaleY ?? 1) / 2;
  forEachMaskPixel(mask, (x, y) => {
    left = Math.min(left, x - hx);
    top = Math.min(top, y - hy);
    right = Math.max(right, x + hx);
    bottom = Math.max(bottom, y + hy);
  });
  if (left === Infinity) return null;
  return boxFromCorners({ x: left, y: top }, { x: right, y: bottom }, size);
}

/** Grows a box to take in a point, with a margin of this share of the shorter image side. */
export function boxWith(box: PromptBox, p: Vec2, size: { width: number; height: number }, marginShare = 0.02): PromptBox {
  const m = marginShare * Math.min(size.width, size.height);
  return (
    boxFromCorners(
      { x: Math.min(box.left, p.x - m), y: Math.min(box.top, p.y - m) },
      { x: Math.max(box.right, p.x + m), y: Math.max(box.bottom, p.y + m) },
      size,
    ) ?? box
  );
}

/** Adds a point, or returns null when the prompt already has the most the server takes. */
export function withPoint(prompt: RegionPrompt, point: PromptPoint): RegionPrompt | null {
  if (prompt.points.length >= MAX_PROMPT_POINTS) return null;
  return { ...prompt, points: [...prompt.points, point] };
}

/**
 * Which of several outlines (one per instance a concept prompt found) the tap
 * lands on. When outlines overlap, the smallest wins: it is the most specific.
 * Returns -1 when the tap is on none of them.
 */
export function instanceAt(masks: readonly BinaryMask[], p: Vec2): number {
  let best = -1;
  let bestArea = Infinity;
  masks.forEach((m, i) => {
    if (!maskContains(m, p)) return;
    const area = maskPixelCount(m) * (m.scaleX ?? 1) * (m.scaleY ?? 1);
    if (area < bestArea) {
      best = i;
      bestArea = area;
    }
  });
  return best;
}
