import { describe, expect, it } from "vitest";
import { filledRectMask } from "../src/physics/tipover.ts";
import {
  decodeSyntheticRaster,
  encodeSyntheticMaskLine,
  extractOutputTextFromResponsesSse,
  parseSamLine,
  parseSamOutput,
} from "../src/sam/parser.ts";

describe("SAM parser (synthetic + published grammar)", () => {
  it("parses out-of-order frames by the <Nf> value, not line order", () => {
    const text = [
      `<2f>4<|box;x1=1;y1=2;x2=3;y2=4;w=10;h=10|><|mask;x=0;y=0;data=1,1,#1|>`,
      `<0f>4<|box;x1=1;y1=2;x2=3;y2=4;w=10;h=10|><|mask;x=0;y=0;data=1,1,#1|>`,
    ].join("\n");
    const records = parseSamOutput(text);
    expect(records.map((r) => r.frameIndex)).toEqual([2, 0]);
    expect(records.every((r) => r.objectId === 4)).toBe(true);
  });

  it("parses a published-docs image line (payload not decoded)", () => {
    const line =
      "<0f>0<|box;x1=353;y1=382;x2=453;y2=427;w=537;h=561|><|mask;x=0;y=0;data=46,101,~elided|>,2<|box;x1=516;y1=117;x2=536;y2=150;w=537;h=561|><|mask;x=0;y=0;data=34,21,~elided|>";
    const records = parseSamLine(line);
    expect(records).toHaveLength(2);
    expect(records[0].objectId).toBe(0);
    expect(records[1].objectId).toBe(2);
    expect(records[0].box.w).toBe(537);
    expect(records[0].mask.height).toBe(46);
    expect(records[0].mask.width).toBe(101);
    expect(records[0].mask.encoding).toBe("~");
    const raster = decodeSyntheticRaster(records[0].mask);
    expect(raster.ok).toBe(false);
  });

  it("decodes a synthetic # raster and reads include_confidence", () => {
    const bits = new Uint8Array([1, 0, 1, 1, 0, 0]);
    const line = encodeSyntheticMaskLine({
      frameIndex: 0,
      objectId: 1,
      box: { x1: 0, y1: 0, x2: 2, y2: 3, w: 8, h: 8, c: 0.5 },
      height: 2,
      width: 3,
      bits,
    });
    const [record] = parseSamLine(line);
    expect(record.box.c).toBe(0.5);
    const raster = decodeSyntheticRaster(record.mask);
    expect(raster.ok).toBe(true);
    if (raster.ok) {
      expect(Array.from(raster.data)).toEqual([1, 0, 1, 1, 0, 0]);
      expect(raster.source).toBe("synthetic");
    }
  });

  it("round-trips a filled rectangle through the synthetic encoding", () => {
    const mask = filledRectMask(0, 0, 4, 3, 4, 3);
    const line = encodeSyntheticMaskLine({
      frameIndex: 0,
      objectId: 0,
      box: { x1: 0, y1: 0, x2: 4, y2: 3, w: 4, h: 3 },
      height: 3,
      width: 4,
      bits: mask.data,
    });
    const [record] = parseSamLine(line);
    const raster = decodeSyntheticRaster(record.mask);
    expect(raster.ok).toBe(true);
    if (raster.ok) expect(Array.from(raster.data)).toEqual(Array.from(mask.data));
  });

  it("collects Responses SSE output_text deltas", () => {
    const sse = [
      `data: {"type":"response.created"}`,
      `data: {"type":"response.output_text.delta","delta":"<0f>1"}`,
      `data: {"type":"response.output_text.delta","delta":"<|box;x1=1;y1=2;x2=3;y2=4;w=8;h=8|>"}`,
      `data: {"type":"response.completed"}`,
      `data: [DONE]`,
    ].join("\n");
    const extracted = extractOutputTextFromResponsesSse(sse);
    expect(extracted.completed).toBe(true);
    expect(extracted.outputText.startsWith("<0f>1")).toBe(true);
  });
});
