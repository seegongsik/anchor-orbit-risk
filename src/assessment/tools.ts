/**
 * The physics and risk tools the assessment agent may call. Every number the
 * final table shows comes from one of these results; the agent only refers to
 * results by id (see checker.ts).
 */
import type { EdgeMeasurement, Hazard, LadderMeasurement } from "./types.js";
import { dropEnergy, ladderCheck, marginLikelihood, moveTarget, riskRating, severityGrade } from "../risk/assess.js";
import {
  CONTROL_TARGET_MARGIN_M,
  CONTROL_TARGET_RANGE_M,
  DEFAULT_DROP_HEIGHT,
  LADDER_REFERENCE,
  LIKELIHOOD_LABELS,
  SIDE_VIEW_MAX_PITCH_DEG,
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
    "Measured margin d between the object's estimated centre of mass and the plumb line through the support edge, with its uncertainty, and the likelihood grade the lower 5% of the margin suggests. Positive d = over the support. If the object was measured again after a change, it also gives the margin before and the change.",
    { hazard_id: STR },
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
    "Severity grade a drop_energy result suggests, one grade per tenfold step in energy. use = 'high' (conservative) or 'low'.",
    { drop_call: STR, use: { type: "string", enum: ["high", "low"] }, sharp_edge_down: BOOL },
    ["drop_call"],
  ),
  spec(
    "risk_rating",
    "Risk score = likelihood grade × severity grade. likelihood_call is a tipover_margin, move_target or ladder_angle result; severity_call is a severity_grade result.",
    { likelihood_call: STR, severity_call: STR },
    ["likelihood_call", "severity_call"],
  ),
  spec(
    "move_target",
    `How far to move the object inward so that the lower 5% of its margin reaches target_d_m (default ${CONTROL_TARGET_MARGIN_M} m, allowed ${CONTROL_TARGET_RANGE_M.min} to ${CONTROL_TARGET_RANGE_M.max}), and the likelihood grade that margin suggests.`,
    { hazard_id: STR, target_d_m: NUM },
    ["hazard_id"],
  ),
  spec(
    "ladder_angle",
    "Measured ladder angle from the ground against the quarter-length (4:1) rule for leaning ladders, with a suggested likelihood grade.",
    { hazard_id: STR },
    ["hazard_id"],
  ),
];

function clampAssumption(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function marginRuleText(): Text {
  return {
    en: "Suggested likelihood from the lower 5% of the margin: at or below 0 → 5, under 1 cm → 4, under 3 cm → 3, under 10 cm → 2, else 1. The band edges are assumptions; the supervisor sets the grade, knowing how often the spot is touched.",
    ko: "가능성 제안은 여유의 하위 5% 값으로 정함: 0 이하 5, 1 cm 미만 4, 3 cm 미만 3, 10 cm 미만 2, 그 밖 1. 경계는 가정이며, 그 자리를 얼마나 자주 건드리는지 아는 관리감독자가 등급을 정함.",
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
        const suggested = marginLikelihood(m.dP5M);
        const result: Record<string, unknown> = {
          d_m: m.dM,
          d_std_m: m.dStdM,
          d_p5_m: m.dP5M,
          d_p95_m: m.dP95M,
          share_past_line: m.pUnstableNow,
          likelihood_grade: suggested.grade,
          likelihood_label_en: suggested.label.en,
          likelihood_label_ko: suggested.label.ko,
          gravity_source: m.gravitySource,
          gravity_tilt_deg: m.gravityTiltDeg,
          margin_shift_without_gravity_m: m.shiftWithoutGravityM,
          com_height_above_edge_m: m.comHeightAboveEdgeM,
          iterations: m.iterations,
          seed: m.seed,
          mask_source: m.maskSource,
          scale_source: m.scaleSource,
        };
        const assumptions: Text[] = [
          m.gravitySource === "sensor"
            ? {
                en: `Measured from the photo with the phone's gravity vector (${m.maskSource} mask, scale: ${m.scaleSource}).`,
                ko: `휴대폰 중력 벡터로 사진에서 잼(${m.maskSource} 마스크, 축척: ${m.scaleSource}).`,
              }
            : {
                en: `Gravity source: ${m.gravitySource}; the plumb line is not a sensor reading (${m.maskSource} mask, scale: ${m.scaleSource}).`,
                ko: `중력 출처: ${m.gravitySource === "synthetic" ? "합성 장면" : "사진의 세로축을 가정"}. 센서 측정이 아님(${m.maskSource} 마스크, 축척: ${m.scaleSource}).`,
              },
          {
            en: "The centre of mass is estimated from the outline with uniform density. A heavier part on one side moves the real one.",
            ko: "무게중심은 윤곽에서 밀도가 균일하다고 보고 추정한 값. 한쪽이 더 무거우면 실제 무게중심은 달라짐.",
          },
          {
            en: "The share past the line is the fraction of measurement-error draws in which the centre of mass is already beyond the edge line. It is not a probability that the object falls.",
            ko: "선을 넘은 비율은 측정 오차를 넣어 다시 계산한 값 가운데 무게중심이 이미 가장자리 선 밖에 있는 비율. 떨어질 확률이 아님.",
          },
          marginRuleText(),
        ];
        if (m.cameraPitchDeg === null) {
          assumptions.push({
            en: "Camera pitch unknown (no sensor reading); a side view at the height of the edge is assumed.",
            ko: "카메라 앞뒤 기울기를 모름(센서 기록 없음). 가장자리 높이에서 옆으로 찍었다고 가정.",
          });
        } else {
          result.camera_pitch_deg = m.cameraPitchDeg;
          if (Math.abs(m.cameraPitchDeg) > SIDE_VIEW_MAX_PITCH_DEG) {
            assumptions.push({
              en: `The phone was pitched ${Math.abs(m.cameraPitchDeg).toFixed(0)}° up or down (beyond ${SIDE_VIEW_MAX_PITCH_DEG}°, an assumption), so this is not a clean side view and distances may be foreshortened.`,
              ko: `휴대폰이 앞뒤로 ${Math.abs(m.cameraPitchDeg).toFixed(0)}° 기울어 있었음(기준 ${SIDE_VIEW_MAX_PITCH_DEG}°는 가정). 옆에서 찍은 사진이 아니라 거리가 줄어 보일 수 있음.`,
            });
          }
        }
        if (h.before) {
          result.before_d_m = h.before.dM;
          result.before_d_p5_m = h.before.dP5M;
          result.change_d_p5_m = m.dP5M - h.before.dP5M;
          assumptions.push({
            en: `Before value from the earlier capture of the same hazard (${h.before.capturedAt}).`,
            ko: `이전 값은 같은 위험요인을 먼저 찍은 사진에서 잼(${h.before.capturedAt}).`,
          });
        }
        return this.record(name, args, result, assumptions, h.id);
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
              en: "Suggested severity by energy decade: under 1 J → 1, under 10 J → 2, under 100 J → 3, else 4; a sharp edge or point facing down adds one grade. These edges are assumptions about the energy released, not predictions of injury. The supervisor sets the grade, knowing who and what is below.",
              ko: "중대성 제안은 에너지 자릿수로 정함: 1 J 미만 1, 10 J 미만 2, 100 J 미만 3, 그 밖 4. 날카로운 부분이 아래를 향하면 한 등급 올림. 경계는 풀려나는 에너지에 대한 가정이지 다칠 정도의 예측이 아님. 아래에 누가, 무엇이 있는지 아는 관리감독자가 등급을 정함.",
            },
          ],
          h.id,
        );
      }
      case "risk_rating": {
        const l = this.find(args.likelihood_call);
        const s = this.find(args.severity_call);
        if (!["tipover_margin", "move_target", "ladder_angle"].includes(l.tool)) {
          throw new ToolError("likelihood_call must be a tipover_margin, move_target or ladder_angle result");
        }
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
      case "move_target": {
        const h = this.hazard(args.hazard_id);
        const m = this.edge(h);
        const custom = typeof args.target_d_m === "number";
        const target = clampAssumption(args.target_d_m, CONTROL_TARGET_MARGIN_M, CONTROL_TARGET_RANGE_M.min, CONTROL_TARGET_RANGE_M.max);
        const plan = moveTarget(m.dP5M, target);
        return this.record(
          name,
          args,
          {
            required_d_m: plan.targetM,
            current_d_p5_m: m.dP5M,
            move_by_m: plan.moveByM,
            residual_likelihood_grade: plan.residual.grade,
            residual_likelihood_label_en: plan.residual.label.en,
            residual_likelihood_label_ko: plan.residual.label.ko,
          },
          [
            custom
              ? { en: `Target margin ${formatTarget(target)} chosen by the agent.`, ko: `목표 여유 ${formatTarget(target)}는 에이전트가 정함.` }
              : { en: `Target margin ${formatTarget(target)} is the default (assumption).`, ko: `목표 여유 ${formatTarget(target)}는 기본값(가정).` },
            {
              en: "The move is counted from the lower 5% of the measured margin, so the target holds despite measurement error. Whether there is room to move it is for the supervisor to check.",
              ko: "옮길 거리는 측정 여유의 하위 5% 값에서 셈해 측정 오차가 있어도 목표가 유지되게 함. 옮길 자리가 있는지는 관리감독자가 확인.",
            },
            marginRuleText(),
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
        const label = LIKELIHOOD_LABELS[grade];
        const assumptions: Text[] = [
          {
            en: `Reference: ${LADDER_REFERENCE.source}. ${LADDER_REFERENCE.appliesTo.en} Likelihood suggestion (within ±5° = 2, within ±10° = 4, else 5) is an assumption.`,
            ko: `기준: ${LADDER_REFERENCE.source}. ${LADDER_REFERENCE.appliesTo.ko} 가능성 제안(±5° 이내 2, ±10° 이내 4, 그 밖 5)은 가정.`,
          },
          {
            en: "The angle alone does not show whether the ladder is secured, on firm footing or extends far enough above the landing.",
            ko: "각도만으로는 사다리가 고정됐는지, 바닥이 단단한지, 위쪽으로 충분히 올라와 있는지 알 수 없음.",
          },
        ];
        if (m.cameraPitchDeg !== null && Math.abs(m.cameraPitchDeg) > SIDE_VIEW_MAX_PITCH_DEG) {
          assumptions.push({
            en: `The phone was pitched ${Math.abs(m.cameraPitchDeg).toFixed(0)}°, so the angle may be off; photograph the ladder from the side.`,
            ko: `휴대폰이 앞뒤로 ${Math.abs(m.cameraPitchDeg).toFixed(0)}° 기울어 각도가 틀릴 수 있음. 사다리를 옆에서 찍을 것.`,
          });
        }
        return this.record(
          name,
          args,
          {
            angle_from_ground_deg: m.angleFromGroundDeg,
            angle_std_deg: m.angleStdDeg,
            reference_deg: check.referenceDeg,
            deviation_deg: check.deviationDeg,
            verdict: check.verdict,
            likelihood_grade: grade,
            likelihood_label_en: label.en,
            likelihood_label_ko: label.ko,
          },
          assumptions,
          h.id,
        );
      }
      default:
        throw new ToolError(`unknown tool ${name}`);
    }
  }
}

function formatTarget(m: number): string {
  return `${Math.round(m * 100)} cm`;
}
