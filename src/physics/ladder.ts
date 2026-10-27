import { LADDER_RISE_RUN } from "./constants.js";
import { angleBetween, radToDeg, type Vec2 } from "./geometry.js";
import { quantity, type Quantity } from "./quantity.js";

export type LadderAssessment = {
  angleFromGravityDeg: Quantity;
  angleFromHorizontalDeg: Quantity;
  referenceFromHorizontalDeg: Quantity;
  referenceLabel: string;
};

/**
 * Angle between the ladder line and gravity, in gravity-corrected image
 * coordinates (+x right, +y down). Gravity is the 2D down vector in that frame.
 */
export function assessLadder(input: {
  foot: Vec2;
  top: Vec2;
  gravityImage: Vec2;
}): LadderAssessment {
  const along = { x: input.top.x - input.foot.x, y: input.top.y - input.foot.y };
  const opposite = { x: -along.x, y: -along.y };
  const a1 = angleBetween(along, input.gravityImage);
  const a2 = angleBetween(opposite, input.gravityImage);
  const fromGravity = Math.min(a1, a2);
  const fromHorizontal = Math.PI / 2 - fromGravity;
  const refFromHorizontal = Math.atan(
    LADDER_RISE_RUN.rise / LADDER_RISE_RUN.run,
  );
  return {
    angleFromGravityDeg: quantity(radToDeg(fromGravity), "deg"),
    angleFromHorizontalDeg: quantity(radToDeg(fromHorizontal), "deg"),
    referenceFromHorizontalDeg: quantity(radToDeg(refFromHorizontal), "deg", {
      source: "assumption",
    }),
    referenceLabel:
      "4:1 rise:run comparison from the product brief (≈75°). Workplace-rule source: 확인 필요.",
  };
}
