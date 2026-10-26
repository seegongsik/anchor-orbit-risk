import { describe, expect, it } from "vitest";
import { DEFAULT_DROP_HEIGHT_M, STANDARD_G } from "../src/physics/constants.ts";
import { impactEnergy, impactSpeed } from "../src/physics/drop.ts";

describe("drop", () => {
  it("uses v = √(2gh) and E = mgh", () => {
    const v = impactSpeed(DEFAULT_DROP_HEIGHT_M);
    const e = impactEnergy(2, DEFAULT_DROP_HEIGHT_M);
    expect(v.value).toBeCloseTo(Math.sqrt(2 * STANDARD_G * DEFAULT_DROP_HEIGHT_M), 12);
    expect(e.value).toBeCloseTo(2 * STANDARD_G * DEFAULT_DROP_HEIGHT_M, 12);
  });
});
