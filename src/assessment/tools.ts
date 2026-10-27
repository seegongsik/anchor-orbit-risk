/**
 * The physics and risk tools the assessment agent may call. Every number the
 * final table shows comes from one of these results; the agent only refers to
 * results by id (see checker.ts).
 */
import type { EdgeMeasurement, Hazard, LadderMeasurement } from "./types.js";
import {
  dropEnergy,
  fallProbabilityFromSamples,
  ladderCheck,
  likelihoodGrade,
  requiredMargin,
  riskRating,
  severityGrade,
  type Nudges,
} from "../risk/assess.js";
import {
  DEFAULT_DROP_HEIGHT,
  DEFAULT_NUDGES,
  ENERGY_REFERENCES,
  LADDER_REFERENCE,
  LIKELIHOOD_BANDS,
  type Text,
} from "../risk/config.js";
import type { ToolSpec } from "./tool-spec.js";

export type ToolResult = {
  id: string;
  tool: string;
  hazardId?: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
  assumptions: Text[];
};

export class ToolError extends Error {}

const STR = { type: "string" } as const;
const NUM = { type: "number" } as const;
const BOOL = { type: "boolean" } as const;

function spec(name: string, description: string, properties: Record<string, unknown>, required: string[]): ToolSpec {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", properties, required, additionalProperties: false },
    },
  };
}

export const TOOL_SPECS: ToolSpec[] = [
  spec(
    "tipover_margin",
    "Measured margin d between the object's centre of mass and the plumb line through the support edge, with its uncertainty. Positive d = over the support.",
    { hazard_id: STR },
    ["hazard_id"],
  ),
  spec(
    "fall_probability",
    "Probability that the object goes over the edge within the horizon, from the measured margin and nudging assumptions. Omit an assumption to use the default.",
    { hazard_id: STR, nudges_per_day: NUM, nudge_std_m: NUM, horizon_days: NUM },
    ["hazard_id"],
  ),
  spec(
    "drop_energy",
    "Impact speed and energy if the object falls. Mass defaults to the hazard's estimate and height to the measured drop height (or an assumed desk height).",
    { hazard_id: STR, mass_kg_low: NUM, mass_kg_high: NUM, drop_height_m: NUM },
    ["hazard_id"],
  ),
  spec(
    "severity_grade",
    "Severity grade from a drop_energy result. use = 'high' (conservative) or 'low'.",
    { drop_call: STR, use: { type: "string", enum: ["high", "low"] }, sharp_edge_down: BOOL },
    ["drop_call"],
  ),
  spec(
    "risk_rating",
    "Risk score = likelihood grade × severity grade. likelihood_call is a fall_probability, required_margin or ladder_angle result; severity_call is a severity_grade result.",
    { likelihood_call: STR, severity_call: STR },
    ["likelihood_call", "severity_call"],
  ),
  spec(
    "required_margin",
    "Margin needed to bring the fall probability down to target_probability, how far to move the object, and the resulting likelihood grade.",
    { hazard_id: STR, target_probability: NUM, nudges_per_day: NUM, nudge_std_m: NUM, horizon_days: NUM },
    ["hazard_id", "target_probability"],
  ),
  spec(
    "ladder_angle",
    "Measured ladder angle from the ground against the 4:1 rule, with a likelihood grade from an assumed mapping.",
    { hazard_id: STR },
    ["hazard_id"],
  ),
];

function clampAssumption(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function nudgesFrom(args: Record<string, unknown>): { nudges: Nudges; custom: boolean } {
  const nudges = {
    nudgesPerDay: clampAssumption(args.nudges_per_day, DEFAULT_NUDGES.nudgesPerDay, 0, 1000),
    nudgeStdM: clampAssumption(args.nudge_std_m, DEFAULT_NUDGES.nudgeStdM, 0, 0.1),
    horizonDays: clampAssumption(args.horizon_days, DEFAULT_NUDGES.horizonDays, 1, 3650),
  };
  const custom =
    args.nudges_per_day !== undefined || args.nudge_std_m !== undefined || args.horizon_days !== undefined;
  return { nudges, custom };
}

function nudgeText(n: Nudges, custom: boolean): Text {
  const who = custom ? { en: "chosen by the agent", ko: "에이전트가 정함" } : { en: "default", ko: "기본값" };
  return {
    en: `Assumption (${who.en}): ${n.nudgesPerDay} nudges a day, ${(n.nudgeStdM * 1000).toFixed(1)} mm each (std), over ${n.horizonDays} days.`,
    ko: `가정(${who.ko}): 하루 ${n.nudgesPerDay}번 밀림, 한 번에 표준편차 ${(n.nudgeStdM * 1000).toFixed(1)} mm, ${n.horizonDays}일 동안.`,
  };
}

export class ToolBox {
  readonly results: ToolResult[] = [];
  private readonly hazards: Map<string, Hazard>;

  constructor(hazards: Hazard[]) {
    this.hazards = new Map(hazards.map((h) => [h.id, h]));
  }

  hazardIds(): string[] {
    return [...this.hazards.keys()];
  }

  hazard(id: unknown): Hazard {
    const h = typeof id === "string" ? this.hazards.get(id) : undefined;
    if (!h) throw new ToolError(`unknown hazard_id ${String(id)}; known: ${this.hazardIds().join(", ")}`);
    return h;
  }

  find(id: unknown): ToolResult {
    const r = typeof id === "string" ? this.results.find((x) => x.id === id) : undefined;
    if (!r) throw new ToolError(`unknown result id ${String(id)}`);
    return r;
  }

  private edge(h: Hazard): EdgeMeasurement {
    if (h.measurement?.type !== "edge") throw new ToolError(`hazard ${h.id} has no edge measurement`);
    return h.measurement;
  }

  private ladder(h: Hazard): LadderMeasurement {
    if (h.measurement?.type !== "ladder") throw new ToolError(`hazard ${h.id} has no ladder measurement`);
    return h.measurement;
  }

  private record(
    tool: string,
    args: Record<string, unknown>,
    result: Record<string, unknown>,
    assumptions: Text[],
    hazardId?: string,
  ): ToolResult {
    const id = `call_${this.results.length + 1}`;
    const entry: ToolResult = { id, tool, args, result, assumptions, ...(hazardId ? { hazardId } : {}) };
    this.results.push(entry);
    return entry;
  }

  run(name: string, rawArgs: unknown): ToolResult {
    const args = (typeof rawArgs === "object" && rawArgs !== null ? rawArgs : {}) as Record<string, unknown>;
    switch (name) {
      case "tipover_margin": {
        const h = this.hazard(args.hazard_id);
        const m = this.edge(h);
        return this.record(
          name,
          args,
          {
            d_m: m.dM,
            d_std_m: m.dStdM,
            d_p5_m: m.dP5M,
            d_p95_m: m.dP95M,
            p_unstable_now: m.pUnstableNow,
            gravity_tilt_deg: m.gravityTiltDeg,
            margin_shift_without_gravity_m: m.shiftWithoutGravityM,
            com_height_above_edge_m: m.comHeightAboveEdgeM,
            iterations: m.iterations,
            seed: m.seed,
            mask_source: m.maskSource,
            scale_source: m.scaleSource,
          },
          [
            {
              en: `Measured from the photo with the phone's gravity vector (${m.maskSource} mask, scale: ${m.scaleSource}). Uniform density unless noted.`,
              ko: `휴대폰 중력 벡터로 사진에서 잼(${m.maskSource} 마스크, 축척: ${m.scaleSource}). 따로 적지 않으면 밀도는 균일하다고 가정.`,
            },
          ],
          h.id,
        );
      }
      case "fall_probability": {
        const h = this.hazard(args.hazard_id);
        const m = this.edge(h);
        const { nudges, custom } = nudgesFrom(args);
        const p = fallProbabilityFromSamples(m.samplesM, nudges);
        const band = likelihoodGrade(p);
        return this.record(
          name,
          args,
          {
            p_fall: p,
            likelihood_grade: band.grade,
            likelihood_label_en: band.label.en,
            likelihood_label_ko: band.label.ko,
            nudges_per_day: nudges.nudgesPerDay,
            nudge_std_m: nudges.nudgeStdM,
            horizon_days: nudges.horizonDays,
            model: "reflected random walk: P = 2(1 - Phi(d / (sigma * sqrt(N)))), averaged over the margin samples",
          },
          [nudgeText(nudges, custom)],
          h.id,
        );
      }
      case "drop_energy": {
        const h = this.hazard(args.hazard_id);
        const assumptions: Text[] = [];
        let low: number;
        let high: number;
        let massSource: string;
        if (typeof args.mass_kg_low === "number" || typeof args.mass_kg_high === "number") {
          low = clampAssumption(args.mass_kg_low, Number(args.mass_kg_high), 0, 2000);
          high = clampAssumption(args.mass_kg_high, low, low, 2000);
          massSource = "agent estimate";
          assumptions.push({
            en: `Mass ${low}–${high} kg estimated by the agent. Replace with a weighed value if known.`,
            ko: `질량 ${low}–${high} kg은 에이전트 추정값. 실제로 잰 값이 있으면 바꿀 것.`,
          });
        } else if (h.massKg) {
          low = h.massKg.low;
          high = h.massKg.high;
          massSource = h.massKg.source;
          if (h.massKg.source !== "user") {
            assumptions.push({
              en: `Mass ${low}–${high} kg is a ${h.massKg.source}, not a weighed value.`,
              ko: `질량 ${low}–${high} kg은 ${h.massKg.source === "model estimate" ? "모델 추정값" : "가정"}이며 실제로 잰 값이 아님.`,
            });
          }
        } else {
          throw new ToolError(`hazard ${h.id} has no mass estimate; pass mass_kg_low and mass_kg_high`);
        }
        let heightM: number;
        let heightSource: string;
        const measured =
          h.measurement?.type === "edge"
            ? h.measurement.dropHeightM
            : h.measurement?.type === "ladder"
              ? h.measurement.topHeightM
              : null;
        if (typeof args.drop_height_m === "number") {
          heightM = clampAssumption(args.drop_height_m, DEFAULT_DROP_HEIGHT.valueM, 0, 50);
          heightSource = "agent scenario";
          assumptions.push({
            en: `Drop height ${heightM} m set by the agent for a scenario.`,
            ko: `낙하 높이 ${heightM} m은 에이전트가 시나리오로 정함.`,
          });
        } else if (measured !== null && measured !== undefined) {
          heightM = measured;
          heightSource = "measured";
        } else {
          heightM = DEFAULT_DROP_HEIGHT.valueM;
          heightSource = "assumption";
          assumptions.push({
            en: `Drop height ${DEFAULT_DROP_HEIGHT.valueM} m is an assumed desk height (not measured).`,
            ko: `낙하 높이 ${DEFAULT_DROP_HEIGHT.valueM} m은 일반 책상 높이 가정(측정 아님).`,
          });
        }
        const drop = dropEnergy({ massLowKg: low, massHighKg: high, heightM });
        return this.record(
          name,
          args,
          {
            mass_low_kg: low,
            mass_high_kg: high,
            mass_source: massSource,
            drop_height_m: heightM,
            height_source: heightSource,
            impact_speed_mps: drop.impactSpeedMps,
            energy_low_J: drop.energyLowJ,
            energy_high_J: drop.energyHighJ,
            reference_helmet_test_J: ENERGY_REFERENCES[0].value,
            reference_toe_cap_test_J: ENERGY_REFERENCES[1].value,
          },
          assumptions,
          h.id,
        );
      }
      case "severity_grade": {
        const drop = this.find(args.drop_call);
        if (drop.tool !== "drop_energy") throw new ToolError("drop_call must be a drop_energy result");
        const use = args.use === "low" ? "low" : "high";
        const energy = Number(use === "low" ? drop.result.energy_low_J : drop.result.energy_high_J);
        const h = this.hazard(drop.hazardId);
        const sharp = typeof args.sharp_edge_down === "boolean" ? args.sharp_edge_down : h.sharpEdgeDown === true;
        const graded = severityGrade(energy, sharp);
        return this.record(
          name,
          args,
          {
            severity_grade: graded.band.grade,
            severity_label_en: graded.band.label.en,
            severity_label_ko: graded.band.label.ko,
            energy_J: energy,
            sharp_edge_down: sharp,
            raised_for_sharpness: graded.raisedForSharpness,
          },
          [
            {
              en: "Severity band edges are assumptions placed at protective-equipment test energies (EN 397: 49 J, EN ISO 20345: 200 J). Sharp edge down adds one grade (assumption).",
              ko: "중대성 경계는 보호구 시험 에너지(EN 397 49 J, EN ISO 20345 200 J)에 맞춘 가정. 날카로운 부분이 아래를 향하면 한 등급 올림(가정).",
            },
          ],
          h.id,
        );
      }
      case "risk_rating": {
        const l = this.find(args.likelihood_call);
        const s = this.find(args.severity_call);
        const lg = l.result.likelihood_grade ?? l.result.residual_likelihood_grade;
        if (typeof lg !== "number") throw new ToolError("likelihood_call has no likelihood grade");
        if (s.tool !== "severity_grade") throw new ToolError("severity_call must be a severity_grade result");
        if (l.hazardId !== s.hazardId) throw new ToolError("likelihood and severity belong to different hazards");
        const sg = Number(s.result.severity_grade);
        const rated = riskRating(lg, sg);
        return this.record(
          name,
          args,
          {
            likelihood_grade: lg,
            severity_grade: sg,
            risk_score: rated.score,
            risk_level_grade: rated.level.grade,
            risk_level_en: rated.level.label.en,
            risk_level_ko: rated.level.label.ko,
          },
          [],
          l.hazardId,
        );
      }
      case "required_margin": {
        const h = this.hazard(args.hazard_id);
        const m = this.edge(h);
        const target = clampAssumption(args.target_probability, 0.001, 1e-6, 0.5);
        const { nudges, custom } = nudgesFrom(args);
        const required = requiredMargin(target, nudges);
        const moveBy = Math.max(0, required - m.dP5M);
        const band = likelihoodGrade(target);
        return this.record(
          name,
          args,
          {
            target_probability: target,
            required_d_m: required,
            current_d_p5_m: m.dP5M,
            move_by_m: moveBy,
            residual_likelihood_grade: band.grade,
            residual_likelihood_label_en: band.label.en,
            residual_likelihood_label_ko: band.label.ko,
          },
          [
            nudgeText(nudges, custom),
            {
              en: "Move distance is measured from the lower 5% of the measured margin, so the target holds despite measurement error.",
              ko: "옮길 거리는 측정 여유의 하위 5% 값에서 계산해 측정 오차가 있어도 목표가 유지되게 함.",
            },
          ],
          h.id,
        );
      }
      case "ladder_angle": {
        const h = this.hazard(args.hazard_id);
        const m = this.ladder(h);
        const check = ladderCheck(m.angleFromGroundDeg);
        const off = Math.abs(check.deviationDeg);
        const grade = off <= LADDER_REFERENCE.toleranceDeg ? 2 : off <= 2 * LADDER_REFERENCE.toleranceDeg ? 4 : 5;
        const band = LIKELIHOOD_BANDS.find((b) => b.grade === grade) ?? LIKELIHOOD_BANDS[0];
        return this.record(
          name,
          args,
          {
            angle_from_ground_deg: m.angleFromGroundDeg,
            angle_std_deg: m.angleStdDeg,
            reference_deg: check.referenceDeg,
            deviation_deg: check.deviationDeg,
            verdict: check.verdict,
            likelihood_grade: band.grade,
            likelihood_label_en: band.label.en,
            likelihood_label_ko: band.label.ko,
          },
          [
            {
              en: `Reference: ${LADDER_REFERENCE.source}. Likelihood mapping (within ±5° = 2, within ±10° = 4, else 5) is an assumption.`,
              ko: `기준: ${LADDER_REFERENCE.source}. 가능성 대응(±5° 이내 2, ±10° 이내 4, 그 밖 5)은 가정.`,
            },
          ],
          h.id,
        );
      }
      default:
        throw new ToolError(`unknown tool ${name}`);
    }
  }
}
