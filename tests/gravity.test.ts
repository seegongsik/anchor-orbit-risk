import { describe, expect, it } from "vitest";
import { STANDARD_G } from "../src/physics/constants.js";
import {
  downInScreenPixels,
  imageDownFromSample,
  isStationary,
  pitchFromProjection,
  projectDownOntoRearImage,
  requestMotionPermission,
  SIGN_CHECK,
  SignEstimate,
  signVote,
  worldDownFromAccelerationIncludingGravity,
} from "../src/sensors/gravity.js";

describe("camera pitch", () => {
  it("is zero when the phone stands upright and grows as it looks down", () => {
    const upright = imageDownFromSample({ accelerationIncludingGravity: { x: 0, y: STANDARD_G, z: 0 }, screenAngleDeg: 0, timestampMs: 0 });
    expect(pitchFromProjection(upright.towardUser, upright.magnitude)).toBeCloseTo(0, 9);
    const a = { x: 0, y: STANDARD_G * Math.cos(Math.PI / 6), z: STANDARD_G * Math.sin(Math.PI / 6) };
    const tilted = imageDownFromSample({ accelerationIncludingGravity: a, screenAngleDeg: 0, timestampMs: 0 });
    expect(Math.abs(pitchFromProjection(tilted.towardUser, tilted.magnitude))).toBeCloseTo(30, 9);
    expect(pitchFromProjection(0, 0)).toBe(0);
  });
});

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

describe("browser gravity sign", () => {
  const upright = (sign: 1 | -1, rollDeg = 0) => {
    const r = (rollDeg * Math.PI) / 180;
    // The spec's upright portrait reading is y ≈ +g; a browser with the opposite sign sends -g.
    return {
      accelerationIncludingGravity: { x: sign * STANDARD_G * Math.sin(r), y: sign * STANDARD_G * Math.cos(r), z: 0 },
      screenAngleDeg: 0,
      timestampMs: 0,
    };
  };

  it("votes from an upright phone and abstains when flat or sideways", () => {
    expect(signVote(upright(1))).toBe(1);
    expect(signVote(upright(-1))).toBe(-1);
    expect(signVote(upright(1, 20))).toBe(1);
    expect(signVote(upright(1, 60))).toBe(0);
    expect(signVote({ accelerationIncludingGravity: { x: 0, y: 0, z: STANDARD_G }, screenAngleDeg: 0, timestampMs: 0 })).toBe(0);
  });

  it("settles only after enough agreeing votes, and keeps +1 until then", () => {
    const est = new SignEstimate();
    expect(est.state).toBe("unknown");
    for (let i = 0; i < SIGN_CHECK.minVotes - 1; i += 1) est.add(-1);
    expect(est.state).toBe("unknown");
    expect(est.sign).toBe(1);
    est.add(-1);
    expect(est.state).toBe("inverted");
    expect(est.sign).toBe(-1);
    est.add(0);
    expect(est.counts).toEqual({ asSpecified: 0, inverted: SIGN_CHECK.minVotes });
  });

  it("does not settle on mixed votes", () => {
    const est = new SignEstimate();
    for (let i = 0; i < 30; i += 1) est.add(i % 2 === 0 ? 1 : -1);
    expect(est.state).toBe("unknown");
  });

  it("gives the same plumb direction and pitch sign for both browser signs once the sign is known", () => {
    const tilt = Math.PI / 9; // camera looking 20° down
    const spec = { x: 0, y: STANDARD_G * Math.cos(tilt), z: STANDARD_G * Math.sin(tilt) };
    const a = imageDownFromSample({ accelerationIncludingGravity: spec, screenAngleDeg: 0, timestampMs: 0 });
    const flipped = { x: -spec.x, y: -spec.y, z: -spec.z };
    const b = imageDownFromSample({ accelerationIncludingGravity: flipped, screenAngleDeg: 0, timestampMs: 0, sign: -1 });
    expect(b.v).toBeCloseTo(a.v, 9);
    expect(a.v).toBeGreaterThan(0);
    expect(pitchFromProjection(a.towardUser, a.magnitude)).toBeCloseTo(-20, 9);
    expect(pitchFromProjection(b.towardUser, b.magnitude)).toBeCloseTo(-20, 9);
  });
});
