import { describe, expect, it } from "vitest";
import { assessLadder } from "../src/physics/ladder.js";

describe("ladder", () => {
  it("recovers the 4:1 angle from vertical within 1%", () => {
    const result = assessLadder({
      foot: { x: 0, y: 400 },
      top: { x: 100, y: 0 },
      gravityImage: { x: 0, y: 1 },
    });
    const expectedFromVertical = (Math.atan(1 / 4) * 180) / Math.PI;
    const expectedFromHorizontal = (Math.atan(4) * 180) / Math.PI;
    expect(
      Math.abs(result.angleFromGravityDeg.value - expectedFromVertical) /
        expectedFromVertical,
    ).toBeLessThan(0.01);
    expect(
      Math.abs(result.angleFromHorizontalDeg.value - expectedFromHorizontal) /
        expectedFromHorizontal,
    ).toBeLessThan(0.01);
    expect(result.referenceFromHorizontalDeg.source).toBe("assumption");
  });
});
