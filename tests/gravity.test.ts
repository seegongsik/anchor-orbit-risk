import { describe, expect, it } from "vitest";
import { STANDARD_G } from "../src/physics/constants.js";
import {
  downInScreenPixels,
  imageDownFromSample,
  isStationary,
  projectDownOntoRearImage,
  requestMotionPermission,
  worldDownFromAccelerationIncludingGravity,
} from "../src/sensors/gravity.js";

describe("gravity mapping", () => {
  it("treats rest a+g as support acceleration: world-down is the negation", () => {
    const down = worldDownFromAccelerationIncludingGravity({
      x: 0,
      y: STANDARD_G,
      z: 0,
    });
    expect(down.x).toBeCloseTo(0, 8);
    expect(down.y).toBeCloseTo(-STANDARD_G, 8);
    expect(down.z).toBeCloseTo(0, 8);
  });

  it("maps upright portrait so image down is +v", () => {
    const image = imageDownFromSample({
      accelerationIncludingGravity: { x: 0, y: STANDARD_G, z: 0 },
      screenAngleDeg: 0,
      timestampMs: 0,
    });
    expect(image.isFlat).toBe(false);
    expect(image.u).toBeCloseTo(0, 8);
    expect(image.v).toBeCloseTo(STANDARD_G, 8);
    expect(image.rotationDegToAlignDown).toBeCloseTo(0, 5);
  });

  it("marks a face-up rest sample as flat", () => {
    const image = projectDownOntoRearImage(
      worldDownFromAccelerationIncludingGravity({ x: 0, y: 0, z: STANDARD_G }),
    );
    expect(image.isFlat).toBe(true);
    expect(image.inPlane).toBeCloseTo(0, 8);
  });

  it("rotates sensor down through 90° screen angle", () => {
    const mapped = downInScreenPixels({ u: 0, v: STANDARD_G }, 90);
    expect(mapped.x).toBeCloseTo(STANDARD_G, 8);
    expect(mapped.y).toBeCloseTo(0, 8);
  });

  it("detects a stationary buffer and rejects a short one", () => {
    const still = Array.from({ length: 8 }, () => ({ x: 0.01, y: 9.8, z: 0.02 }));
    expect(isStationary(still)).toBe(true);
    expect(isStationary(still.slice(0, 2))).toBe(false);
    const shaking = [
      { x: 0, y: 9.8, z: 0 },
      { x: 3, y: 6, z: 1 },
      { x: -2, y: 12, z: -1 },
    ];
    expect(isStationary(shaking)).toBe(false);
  });

  it("requests iOS permission only when the API exists", async () => {
    await expect(requestMotionPermission(undefined)).resolves.toBe("not-required");
    await expect(
      requestMotionPermission({ requestPermission: async () => "granted" }),
    ).resolves.toBe("granted");
    await expect(
      requestMotionPermission({ requestPermission: async () => "denied" }),
    ).resolves.toBe("denied");
  });
});
