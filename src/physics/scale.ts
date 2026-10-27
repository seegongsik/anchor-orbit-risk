import {
  A4_LONG_SIDE_M,
  CREDIT_CARD_LONG_SIDE_M,
} from "./constants.js";
import { quantity, type Quantity } from "./quantity.js";
import { hypot2, type Vec2 } from "./geometry.js";

export type ScalePreset = "a4-long" | "credit-card" | "custom";

export function knownLengthMetres(preset: ScalePreset, customMetres?: number): number {
  if (preset === "a4-long") return A4_LONG_SIDE_M;
  if (preset === "credit-card") return CREDIT_CARD_LONG_SIDE_M;
  if (customMetres === undefined || !(customMetres > 0)) {
    throw new Error("custom scale needs a positive length in metres");
  }
  return customMetres;
}

export function pixelDistance(a: Vec2, b: Vec2): number {
  return hypot2({ x: b.x - a.x, y: b.y - a.y });
}

export function metersPerPixel(
  knownLengthM: number,
  lengthPx: number,
): Quantity {
  if (!(knownLengthM > 0)) {
    throw new Error("known length must be positive");
  }
  if (!(lengthPx > 0)) {
    throw new Error("pixel length must be positive");
  }
  return quantity(knownLengthM / lengthPx, "m/px", { source: "computed" });
}
