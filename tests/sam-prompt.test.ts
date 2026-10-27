import { describe, expect, it } from "vitest";
import { filledRectMask, maskContains } from "../src/physics/mask.js";
import {
  boxFromCorners,
  boxWith,
  classifyGesture,
  DRAG_MIN_SHARE,
  instanceAt,
  MAX_PROMPT_POINTS,
  maskBox,
  withPoint,
} from "../src/ui/sam-prompt.js";
import { pitchBand, pitchText, rollText } from "../src/ui/camera.js";

const size = { width: 1000, height: 800 };

describe("gestures on the photo", () => {
  it("treats a short movement as a tap and a long drag as a box, in either direction", () => {
    const short = (DRAG_MIN_SHARE * 800) / 2;
    expect(classifyGesture({ x: 100, y: 100 }, { x: 100 + short, y: 100 }, size)).toEqual({ kind: "tap", point: { x: 100 + short, y: 100 } });
    expect(classifyGesture({ x: 400, y: 300 }, { x: 200, y: 100 }, size)).toEqual({
      kind: "box",
      box: { left: 200, top: 100, right: 400, bottom: 300 },
    });
  });

  it("clips a box to the photo and refuses a sliver", () => {
    expect(boxFromCorners({ x: -20, y: 790.2 }, { x: 50.4, y: 900 }, size)).toEqual({ left: 0, top: 790, right: 51, bottom: 800 });
    expect(boxFromCorners({ x: 10, y: 10 }, { x: 11, y: 300 }, size)).toBeNull();
  });
});

describe("prompt points", () => {
  it("stops at the server's limit", () => {
    let prompt: { points: { x: number; y: number; label: "positive" | "negative" }[] } | null = { points: [] };
    for (let i = 0; i < MAX_PROMPT_POINTS; i += 1) prompt = withPoint(prompt!, { x: i, y: i, label: "positive" });
    expect(prompt!.points).toHaveLength(MAX_PROMPT_POINTS);
    expect(withPoint(prompt!, { x: 0, y: 0, label: "negative" })).toBeNull();
  });
});

describe("outlines and taps", () => {
  const desk = filledRectMask(0, 400, 1000, 800, size.width, size.height);
  const mug = filledRectMask(600, 300, 680, 420, size.width, size.height);

  it("finds the most specific outline under a tap", () => {
    expect(instanceAt([desk, mug], { x: 640, y: 410 })).toBe(1);
    expect(instanceAt([desk, mug], { x: 100, y: 700 })).toBe(0);
    expect(instanceAt([desk, mug], { x: 100, y: 100 })).toBe(-1);
  });

  it("reads a scaled SAM raster in image pixels", () => {
    // A 10 × 5 raster covering a 100 × 50 box at (200, 300), left half set.
    const data = new Uint8Array(50);
    for (let y = 0; y < 5; y += 1) for (let x = 0; x < 5; x += 1) data[y * 10 + x] = 1;
    const m = { width: 10, height: 5, data, originX: 200, originY: 300, scaleX: 10, scaleY: 10 };
    expect(maskContains(m, { x: 245, y: 320 })).toBe(true);
    expect(maskContains(m, { x: 255, y: 320 })).toBe(false);
    expect(maskContains(m, { x: 199, y: 320 })).toBe(false);
    expect(maskBox(m, size)).toEqual({ left: 200, top: 300, right: 250, bottom: 350 });
  });

  it("grows a box to take in an added spot", () => {
    const box = maskBox(mug, size)!;
    expect(box).toEqual({ left: 600, top: 300, right: 680, bottom: 420 });
    const grown = boxWith(box, { x: 700, y: 360 }, size);
    expect(grown.left).toBe(600);
    expect(grown.right).toBeGreaterThan(700);
    expect(boxWith(box, { x: 640, y: 360 }, size)).toEqual(box);
  });
});

describe("live readouts", () => {
  it("names the pitch band with the side-view limit", () => {
    expect(pitchBand(4)).toBe("level");
    expect(pitchBand(-13)).toBe("near");
    expect(pitchBand(15.2)).toBe("off");
    expect(pitchText(0.4, true)).toBe("Camera level · side view OK");
    expect(pitchText(-7.6, true)).toBe("Camera 8° down · side view OK");
    expect(pitchText(-7.6, false)).toBe("Camera 8° · side view OK");
    expect(pitchText(15.3, true)).toBe("Camera 15.3° up · aim it level");
    expect(pitchText(-13.2, true)).toBe("Camera 13° down · near the 15° limit");
  });

  it("reports the phone's turn with its direction", () => {
    expect(rollText(0.6)).toBe("Phone upright");
    expect(rollText(12.4)).toBe("Phone turned 12° left · the line corrects it");
    expect(rollText(-12.4)).toBe("Phone turned 12° right · the line corrects it");
  });
});
