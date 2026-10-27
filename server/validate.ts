/** Input checks for data that arrives from the browser. */
import {
  HAZARD_ID,
  type EdgeMeasurement,
  type Hazard,
  type LadderMeasurement,
  type MaskSource,
} from "../src/assessment/types.js";

type JsonRecord = Record<string, unknown>;

export class InputError extends Error {}

function rec(value: unknown, where: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InputError(`${where} must be an object`);
  }
  return value as JsonRecord;
}

function finite(value: unknown, where: string, min = -Infinity, max = Infinity): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new InputError(`${where} must be a number in [${min}, ${max}]`);
  }
  return value;
}

function short(value: unknown, where: string, max = 60, optional = true): string | undefined {
  if (value === undefined || value === null || value === "") {
    if (optional) return undefined;
    throw new InputError(`${where} is required`);
  }
  if (typeof value !== "string") throw new InputError(`${where} must be a string`);
  return value.slice(0, max);
}

function vec(value: unknown, where: string) {
  const v = rec(value, where);
  return { x: finite(v.x, `${where}.x`), y: finite(v.y, `${where}.y`) };
}

function maskSource(value: unknown): MaskSource {
  return value === "sam-3.1" || value === "synthetic" ? value : "manual";
}

function edgeMeasurement(value: JsonRecord, where: string): EdgeMeasurement {
  const samples = Array.isArray(value.samplesM) ? value.samplesM : [];
  if (samples.length < 1000 || samples.length > 5000) {
    throw new InputError(`${where}.samplesM needs 1000 to 5000 Monte Carlo samples`);
  }
  const inputs = rec(value.inputs, `${where}.inputs`);
  const sigma = rec(inputs.sigma, `${where}.inputs.sigma`);
  return {
    type: "edge",
    dM: finite(value.dM, `${where}.dM`, -10, 10),
    dStdM: finite(value.dStdM, `${where}.dStdM`, 0, 10),
    dP5M: finite(value.dP5M, `${where}.dP5M`, -10, 10),
    dP95M: finite(value.dP95M, `${where}.dP95M`, -10, 10),
    pUnstableNow: finite(value.pUnstableNow, `${where}.pUnstableNow`, 0, 1),
    samplesM: samples.map((s, i) => finite(s, `${where}.samplesM[${i}]`, -10, 10)),
    iterations: finite(value.iterations, `${where}.iterations`, 1000, 1e6),
    seed: finite(value.seed, `${where}.seed`),
    gravityTiltDeg: finite(value.gravityTiltDeg, `${where}.gravityTiltDeg`, -90, 90),
    shiftWithoutGravityM: finite(value.shiftWithoutGravityM, `${where}.shiftWithoutGravityM`, -10, 10),
    comHeightAboveEdgeM: finite(value.comHeightAboveEdgeM, `${where}.comHeightAboveEdgeM`, -10, 10),
    dropHeightM: value.dropHeightM === null || value.dropHeightM === undefined ? null : finite(value.dropHeightM, `${where}.dropHeightM`, 0, 50),
    metersPerPixel: finite(value.metersPerPixel, `${where}.metersPerPixel`, 1e-6, 1),
    scaleSource: short(value.scaleSource, `${where}.scaleSource`, 120) ?? "unknown",
    maskSource: maskSource(value.maskSource),
    inputs: {
      comPx: vec(inputs.comPx, `${where}.inputs.comPx`),
      edgePx: vec(inputs.edgePx, `${where}.inputs.edgePx`),
      plumbDown: vec(inputs.plumbDown, `${where}.inputs.plumbDown`),
      sigma: {
        comPx: finite(sigma.comPx, "sigma.comPx", 0, 1000),
        edgePx: finite(sigma.edgePx, "sigma.edgePx", 0, 1000),
        gravityRad: finite(sigma.gravityRad, "sigma.gravityRad", 0, 1),
        scaleRel: finite(sigma.scaleRel, "sigma.scaleRel", 0, 1),
      },
    },
  };
}

function ladderMeasurement(value: JsonRecord, where: string): LadderMeasurement {
  const inputs = rec(value.inputs, `${where}.inputs`);
  return {
    type: "ladder",
    angleFromGroundDeg: finite(value.angleFromGroundDeg, `${where}.angleFromGroundDeg`, 0, 90),
    angleStdDeg: finite(value.angleStdDeg, `${where}.angleStdDeg`, 0, 90),
    gravityTiltDeg: finite(value.gravityTiltDeg, `${where}.gravityTiltDeg`, -90, 90),
    topHeightM: value.topHeightM === null || value.topHeightM === undefined ? null : finite(value.topHeightM, `${where}.topHeightM`, 0, 50),
    maskSource: maskSource(value.maskSource),
    inputs: {
      footPx: vec(inputs.footPx, `${where}.inputs.footPx`),
      topPx: vec(inputs.topPx, `${where}.inputs.topPx`),
      plumbDown: vec(inputs.plumbDown, `${where}.inputs.plumbDown`),
    },
  };
}

export function sanitizeHazards(value: unknown): Hazard[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    throw new InputError("hazards must be an array of 1 to 8 items");
  }
  const ids = new Set<string>();
  return value.map((raw, i) => {
    const where = `hazards[${i}]`;
    const h = rec(raw, where);
    const id = short(h.id, `${where}.id`, 4, false) ?? "";
    if (!HAZARD_ID.test(id) || ids.has(id)) throw new InputError(`${where}.id must be a unique id like h1`);
    ids.add(id);
    const kind = h.kind === "edge" || h.kind === "ladder" ? h.kind : "other";
    const hazard: Hazard = { id, kind, object: short(h.object, `${where}.object`, 60, false) ?? "" };
    const support = short(h.support, `${where}.support`);
    if (support) hazard.support = support;
    const below = short(h.below, `${where}.below`);
    if (below) hazard.below = below;
    const material = short(h.material, `${where}.material`);
    if (material) hazard.material = material;
    if (typeof h.sharpEdgeDown === "boolean") hazard.sharpEdgeDown = h.sharpEdgeDown;
    if (h.massKg !== undefined && h.massKg !== null) {
      const m = rec(h.massKg, `${where}.massKg`);
      const low = finite(m.low, `${where}.massKg.low`, 0, 2000);
      const high = finite(m.high, `${where}.massKg.high`, low, 2000);
      const source = m.source === "user" || m.source === "assumption" ? m.source : "model estimate";
      hazard.massKg = { low, high, source };
    }
    if (h.measurement !== undefined && h.measurement !== null) {
      const m = rec(h.measurement, `${where}.measurement`);
      if (m.type === "edge") hazard.measurement = edgeMeasurement(m, `${where}.measurement`);
      else if (m.type === "ladder") hazard.measurement = ladderMeasurement(m, `${where}.measurement`);
      else throw new InputError(`${where}.measurement.type must be edge or ladder`);
    }
    return hazard;
  });
}

const DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export function imageDataUrl(value: unknown, required: boolean): string | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) throw new InputError("imageDataUrl is required");
    return undefined;
  }
  if (typeof value !== "string" || !DATA_URL.test(value)) {
    throw new InputError("imageDataUrl must be a base64 JPEG, PNG or WebP data URL");
  }
  return value;
}
