/**
 * Assessment without the agent: the same tools in a fixed order and fixed
 * template text, checked by the same number checker. Used when no model key is
 * configured, and as a baseline to compare the agent against.
 */
import type { AssessmentTable } from "../risk/table.js";
import { checkSubmission } from "./checker.js";
import { ToolBox } from "./tools.js";
import type { Hazard } from "./types.js";

type Row = Record<string, unknown>;

function edgeRow(box: ToolBox, h: Hazard): Row {
  const tip = box.run("tipover_margin", { hazard_id: h.id });
  const drop = box.run("drop_energy", { hazard_id: h.id });
  const sev = box.run("severity_grade", { drop_call: drop.id, use: "high" });
  const risk = box.run("risk_rating", { likelihood_call: tip.id, severity_call: sev.id });
  const need = box.run("move_target", { hazard_id: h.id });
  const residual = box.run("risk_rating", { likelihood_call: need.id, severity_call: sev.id });
  const beyond = Number(tip.result.d_m) <= 0;
  const support = h.support ?? "support";
  const before =
    typeof tip.result.before_d_p5_m === "number"
      ? {
          en: ` Measured again after a change: allowing for measurement error, the margin went from {${tip.id}.before_d_p5_m} to {${tip.id}.d_p5_m}.`,
          ko: ` 바꾼 뒤 다시 잼: 측정 오차를 넣은 여유가 {${tip.id}.before_d_p5_m}에서 {${tip.id}.d_p5_m}가 됨.`,
        }
      : { en: "", ko: "" };
  return {
    hazard_id: h.id,
    hazard: {
      en: `${h.object} near the edge of the ${support}`,
      ko: `${h.object}: ${support} 가장자리 근처`,
    },
    current_state: beyond
      ? {
          en: `Its estimated centre of mass is {${tip.id}.d_m} past the edge line; something other than its weight is holding it.${before.en}`,
          ko: `추정한 무게중심이 가장자리 선 밖으로 {${tip.id}.d_m} 나가 있다. 무게가 아닌 다른 것이 붙잡고 있다.${before.ko}`,
        }
      : {
          en: `Its estimated centre of mass is {${tip.id}.d_m} inside the edge line; allowing for measurement error, at least {${tip.id}.d_p5_m}.${before.en}`,
          ko: `추정한 무게중심이 가장자리 선 안쪽 {${tip.id}.d_m}에 있다. 측정 오차를 넣어도 {${tip.id}.d_p5_m} 이상이다.${before.ko}`,
        },
    controls: [
      {
        en: `Move it inward by at least {${need.id}.move_by_m}, so that even allowing for measurement error the margin is at least {${need.id}.required_d_m}.`,
        ko: `안쪽으로 {${need.id}.move_by_m} 이상 옮겨, 측정 오차를 넣어도 여유가 {${need.id}.required_d_m} 이상이 되게 한다.`,
      },
      {
        en: "If it must stay there, add a physical stop: an edge lip, a tray or an anti-slip mat.",
        ko: "그 자리에 두어야 한다면 가장자리 턱, 트레이, 미끄럼 방지 매트 같은 물리적 막이를 둔다.",
      },
    ],
    likelihood_from: tip.id,
    severity_from: sev.id,
    risk_from: risk.id,
    residual_from: residual.id,
  };
}

function ladderRow(box: ToolBox, h: Hazard): Row {
  const angle = box.run("ladder_angle", { hazard_id: h.id });
  const drop = box.run("drop_energy", { hazard_id: h.id });
  const sev = box.run("severity_grade", { drop_call: drop.id, use: "high" });
  const risk = box.run("risk_rating", { likelihood_call: angle.id, severity_call: sev.id });
  return {
    hazard_id: h.id,
    hazard: { en: `Leaning ${h.object}`, ko: `기대어 세운 ${h.object}` },
    current_state: {
      en: `It stands at {${angle.id}.angle_from_ground_deg} from the ground; the four-to-one rule gives {${angle.id}.reference_deg}.`,
      ko: `바닥에서 {${angle.id}.angle_from_ground_deg}로 서 있다. 사 대 일 규칙 각도는 {${angle.id}.reference_deg}다.`,
    },
    controls: [
      {
        en: `Reset the base so the angle is close to {${angle.id}.reference_deg}.`,
        ko: `각도가 {${angle.id}.reference_deg}에 가깝도록 아래쪽을 다시 놓는다.`,
      },
      {
        en: "Tie off the top or have someone hold the base while it is in use.",
        ko: "쓰는 동안 위쪽을 묶거나 다른 사람이 아래를 잡는다.",
      },
    ],
    likelihood_from: angle.id,
    severity_from: sev.id,
    risk_from: risk.id,
  };
}

function unmeasuredRow(h: Hazard): Row {
  return {
    hazard_id: h.id,
    hazard: { en: h.object, ko: h.object },
    current_state: { en: "Seen in the photo, not measured.", ko: "사진에서 보였지만 재지 않았다." },
    controls: [{ en: "Measure it or check it on site.", ko: "현장에서 재거나 확인한다." }],
  };
}

export function localAssessment(
  hazards: Hazard[],
  context: { place: string; createdAt: string },
): { table: AssessmentTable; results: ToolBox["results"] } {
  const box = new ToolBox(hazards);
  const sources = new Set(hazards.map((h) => h.measurement?.maskSource).filter(Boolean));
  const models = sources.has("sam-3.1")
    ? ["sam-3.1"]
    : sources.has("synthetic")
      ? ["no model: synthetic scene"]
      : ["no model: masks drawn by hand"];
  const rows = hazards.map((h) =>
    h.measurement?.type === "edge" ? edgeRow(box, h) : h.measurement?.type === "ladder" ? ladderRow(box, h) : unmeasuredRow(h),
  );
  const outcome = checkSubmission(
    {
      rows,
      summary: {
        en: "Computed without the agent: fixed template text over the same tools.",
        ko: "에이전트 없이 계산함: 같은 도구 위에 고정 문장을 씀.",
      },
    },
    { results: box.results, hazards, place: context.place, createdAt: context.createdAt, models },
  );
  if (!outcome.ok) throw new Error(`local assessment failed the checker: ${outcome.problems.join("; ")}`);
  return { table: outcome.table, results: box.results };
}
