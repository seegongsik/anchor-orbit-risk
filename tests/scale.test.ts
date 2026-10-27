import { describe, expect, it } from "vitest";
import { A4_LONG_SIDE_M, CREDIT_CARD_LONG_SIDE_M } from "../src/physics/constants.js";
import { knownLengthMetres, metersPerPixel } from "../src/physics/scale.js";

describe("scale", () => {
  it("uses ISO 216 and ISO/IEC 7810 lengths", () => {
    expect(knownLengthMetres("a4-long")).toBe(A4_LONG_SIDE_M);
    expect(knownLengthMetres("credit-card")).toBe(CREDIT_CARD_LONG_SIDE_M);
    expect(knownLengthMetres("custom", 0.5)).toBe(0.5);
  });

  it("restores metres per pixel on a 1:1 A4 marking", () => {
    const q = metersPerPixel(A4_LONG_SIDE_M, 297);
    expect(q.value).toBeCloseTo(0.001, 12);
    expect(q.unit).toBe("m/px");
  });
});
