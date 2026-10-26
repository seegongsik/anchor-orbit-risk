import { STANDARD_G } from "./constants.ts";
import { quantity, type Quantity } from "./quantity.ts";

export function impactSpeed(
  heightM: number,
  g: number = STANDARD_G,
): Quantity {
  if (heightM < 0) {
    throw new Error("height must be non-negative");
  }
  if (!(g > 0)) {
    throw new Error("g must be positive");
  }
  return quantity(Math.sqrt(2 * g * heightM), "m/s", { source: "computed" });
}

export function impactEnergy(
  massKg: number,
  heightM: number,
  g: number = STANDARD_G,
): Quantity {
  if (massKg < 0) {
    throw new Error("mass must be non-negative");
  }
  if (heightM < 0) {
    throw new Error("height must be non-negative");
  }
  if (!(g > 0)) {
    throw new Error("g must be positive");
  }
  return quantity(massKg * g * heightM, "J", { source: "computed" });
}
