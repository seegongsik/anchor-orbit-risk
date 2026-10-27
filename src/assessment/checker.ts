/**
 * The number checker. The agent's final table may not contain a number it
 * typed itself: grades and scores are references to tool results, and free
 * text may only show numbers through {call_N.field} placeholders, which the
 * server fills in. Anything else is rejected and sent back to the agent.
 */
import type { Hazard } from "./types.js";
import { LIKELIHOOD_LABELS, SEVERITY_BANDS, type Text } from "../risk/config.js";
import { formatField, formatLength, formatPercent } from "../risk/format.js";
import type { AssessmentTable, Graded, ResolvedRow } from "../risk/table.js";
import type { ToolResult } from "./tools.js";

const PLACEHOLDER = /\{(call_\d+)\.([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : null;
}

export type CheckOutcome =
  | { ok: true; table: AssessmentTable }
  | { ok: false; problems: string[] };

class Checker {
  readonly problems: string[] = [];
  private readonly byId: Map<string, ToolResult>;

  constructor(readonly results: ToolResult[]) {
    this.byId = new Map(results.map((r) => [r.id, r]));
  }

  /** Names of things in the scene may contain digits ("A4 binder"); they are not measurements. */
  names: string[] = [];

  text(value: unknown, where: string): Text | null {
    const rec = asRecord(value);
    const out: Partial<Text> = {};
    for (const lang of ["en", "ko"] as const) {
      const s = rec?.[lang];
      if (typeof s !== "string" || s.trim() === "") {
        this.problems.push(`${where}.${lang} must be a non-empty string`);
        continue;
      }
      let stripped = s.replace(PLACEHOLDER, "");
      for (const name of this.names) if (name) stripped = stripped.split(name).join("");
      if (/[0-9]/.test(stripped)) {
        this.problems.push(
          `${where}.${lang} contains a number you typed ("${s.slice(0, 80)}"). Numbers must come from tool results: use a placeholder such as {call_1.d_m}.`,
        );
      }
      for (const match of s.matchAll(PLACEHOLDER)) {
        const result = this.byId.get(match[1]);
        if (!result) {
          this.problems.push(`${where}.${lang} refers to unknown result ${match[1]}`);
        } else if (typeof result.result[match[2]] !== "number") {
          this.problems.push(`${where}.${lang} refers to ${match[1]}.${match[2]}, which is not a number in that result`);
        }
      }
      out[lang] = s.trim();
    }
    return out.en !== undefined && out.ko !== undefined ? (out as Text) : null;
  }

  ref(value: unknown, tools: string[], hazardId: string, where: string): ToolResult | null {
    const result = typeof value === "string" ? this.byId.get(value) : undefined;
    if (!result) {
      this.problems.push(`${where} must be the id of a ${tools.join(" or ")} result (got ${JSON.stringify(value)})`);
      return null;
    }
    if (!tools.includes(result.tool)) {
      this.problems.push(`${where} is ${result.id} (${result.tool}); it must be a ${tools.join(" or ")} result`);
      return null;
    }
    if (result.hazardId !== hazardId) {
      this.problems.push(`${where} is ${result.id}, which belongs to hazard ${result.hazardId}, not ${hazardId}`);
      return null;
    }
    return result;
  }

  fill(text: Text): Text {
    const fill = (s: string) =>
      s.replace(PLACEHOLDER, (_, id: string, field: string) => {
        const value = this.byId.get(id)?.result[field];
        return typeof value === "number" ? formatField(field, value) : "";
      });
    return { en: fill(text.en), ko: fill(text.ko) };
  }
}

function measurementLines(hazardId: string, results: ToolResult[]): ResolvedRow["measurements"] {
  const lines: ResolvedRow["measurements"] = [];
  const last = (tool: string) => [...results].reverse().find((r) => r.tool === tool && r.hazardId === hazardId);
  const tip = last("tipover_margin");
  if (tip) {
    const d = Number(tip.result.d_m);
    const s = Number(tip.result.d_std_m);
    lines.push({ label: { en: "Margin d", ko: "여유 d" }, value: `${formatLength(d)} ± ${formatLength(s)}` });
    lines.push({
      label: { en: "Margin, lower 5%", ko: "여유 하위 5%" },
      value: formatLength(Number(tip.result.d_p5_m)),
    });
    if (typeof tip.result.before_d_p5_m === "number") {
      const change = Number(tip.result.change_d_p5_m);
      lines.push({
        label: { en: "Lower 5%: before → after", ko: "하위 5%: 이전 → 지금" },
        value: `${formatLength(Number(tip.result.before_d_p5_m))} → ${formatLength(Number(tip.result.d_p5_m))} (${change >= 0 ? "+" : ""}${formatLength(change)})`,
      });
    }
    lines.push({
      label: { en: "Measurement draws past the line", ko: "측정 오차 계산 중 선을 넘은 비율" },
      value: formatPercent(Number(tip.result.share_past_line)),
    });
    lines.push({
      label: { en: "Phone tilt corrected", ko: "보정한 휴대폰 기울기" },
      value: `${Number(tip.result.gravity_tilt_deg).toFixed(1)}°`,
    });
    if (typeof tip.result.camera_pitch_deg === "number") {
      lines.push({
        label: { en: "Camera pitch", ko: "카메라 앞뒤 기울기" },
        value: `${Math.abs(Number(tip.result.camera_pitch_deg)).toFixed(1)}°`,
      });
    }
  }
  const drop = last("drop_energy");
  if (drop) {
    const source = String(drop.result.height_source);
    const ko = source === "measured" ? "측정" : source === "assumption" ? "가정" : "시나리오";
    lines.push({
      label: { en: `Drop height (${source})`, ko: `낙하 높이(${ko})` },
      value: formatLength(Number(drop.result.drop_height_m)),
    });
    lines.push({
      label: { en: "Impact speed", ko: "충돌 속도" },
      value: formatField("impact_speed_mps", Number(drop.result.impact_speed_mps)),
    });
    lines.push({
      label: { en: "Impact energy", ko: "충돌 에너지" },
      value: `${formatField("energy_low_J", Number(drop.result.energy_low_J))} – ${formatField("energy_high_J", Number(drop.result.energy_high_J))}`,
    });
  }
  const ladder = last("ladder_angle");
  if (ladder) {
    lines.push({
      label: { en: "Ladder angle", ko: "사다리 각도" },
      value: `${Number(ladder.result.angle_from_ground_deg).toFixed(1)}° (4:1 = ${Number(ladder.result.reference_deg).toFixed(1)}°)`,
    });
  }
  return lines;
}

function likelihoodOf(result: ToolResult): Graded {
  const grade = Number(result.result.likelihood_grade);
  const label = LIKELIHOOD_LABELS[grade] ?? LIKELIHOOD_LABELS[1];
  if (result.tool === "tipover_margin") {
    const p5 = formatLength(Number(result.result.d_p5_m));
    return {
      grade,
      label,
      suggested: grade,
      by: "tool",
      basis: {
        en: `margin lower 5% ${p5}`,
        ko: `여유 하위 5% ${p5}`,
      },
    };
  }
  return {
    grade,
    label,
    suggested: grade,
    by: "tool",
    basis: {
      en: `ladder ${Number(result.result.angle_from_ground_deg).toFixed(1)}° vs ${Number(result.result.reference_deg).toFixed(1)}°`,
      ko: `사다리 ${Number(result.result.angle_from_ground_deg).toFixed(1)}° (기준 ${Number(result.result.reference_deg).toFixed(1)}°)`,
    },
  };
}

function severityOf(result: ToolResult): Graded {
  const grade = Number(result.result.severity_grade);
  const band = SEVERITY_BANDS.find((b) => b.grade === grade) ?? SEVERITY_BANDS[0];
  const e = formatField("energy_J", Number(result.result.energy_J));
  const sharp = result.result.raised_for_sharpness === true;
  return {
    grade,
    label: band.label,
    suggested: grade,
    by: "tool",
    basis: {
      en: `E up to ${e}${sharp ? ", sharp edge down (+1)" : ""}`,
      ko: `에너지 최대 ${e}${sharp ? ", 날카로운 부분 아래(+1)" : ""}`,
    },
  };
}

export function checkSubmission(
  submission: unknown,
  ctx: { results: ToolResult[]; hazards: Hazard[]; place: string; createdAt: string; models: string[] },
): CheckOutcome {
  const c = new Checker(ctx.results);
  c.names = ctx.hazards
    .flatMap((h) => [h.object, h.support ?? "", h.below ?? "", h.material ?? ""])
    .filter((n) => /[0-9]/.test(n))
    .sort((a, b) => b.length - a.length);
  const sub = asRecord(submission);
  if (!sub) return { ok: false, problems: ["submission must be an object with rows and summary"] };
  const rowsIn = Array.isArray(sub.rows) ? sub.rows : null;
  if (!rowsIn || rowsIn.length === 0) c.problems.push("rows must be a non-empty array");
  const summary = c.text(sub.summary, "summary");
  const seen = new Set<string>();
  const rows: ResolvedRow[] = [];
  const hazards = new Map(ctx.hazards.map((h) => [h.id, h]));

  (rowsIn ?? []).forEach((raw, i) => {
    const where = `rows[${i}]`;
    const row = asRecord(raw);
    if (!row) {
      c.problems.push(`${where} must be an object`);
      return;
    }
    const id = typeof row.hazard_id === "string" ? row.hazard_id : "";
    const hazard = hazards.get(id);
    if (!hazard) {
      c.problems.push(`${where}.hazard_id ${JSON.stringify(row.hazard_id)} is not a known hazard`);
      return;
    }
    if (seen.has(id)) c.problems.push(`${where}: hazard ${id} appears twice`);
    seen.add(id);
    const hazardText = c.text(row.hazard, `${where}.hazard`);
    const state = c.text(row.current_state, `${where}.current_state`);
    const controlsIn = Array.isArray(row.controls) ? row.controls : [];
    const controls = controlsIn.map((x, j) => c.text(x, `${where}.controls[${j}]`)).filter((x): x is Text => x !== null);
    let likelihood: Graded | null = null;
    let severity: Graded | null = null;
    let risk: ResolvedRow["risk"] = null;
    let residual: ResolvedRow["residual"] = null;
    if (hazard.measurement) {
      if (controls.length === 0) c.problems.push(`${where}.controls needs at least one control`);
      const l = c.ref(row.likelihood_from, ["tipover_margin", "ladder_angle"], id, `${where}.likelihood_from`);
      const s = c.ref(row.severity_from, ["severity_grade"], id, `${where}.severity_from`);
      const r = c.ref(row.risk_from, ["risk_rating"], id, `${where}.risk_from`);
      if (l && s && r) {
        if (r.args.likelihood_call !== l.id || r.args.severity_call !== s.id) {
          c.problems.push(`${where}.risk_from (${r.id}) must rate ${l.id} with ${s.id}`);
        } else {
          likelihood = likelihoodOf(l);
          severity = severityOf(s);
          risk = { score: Number(r.result.risk_score), level: { en: String(r.result.risk_level_en), ko: String(r.result.risk_level_ko) } };
        }
      }
      if (row.residual_from !== undefined && row.residual_from !== null) {
        const rr = c.ref(row.residual_from, ["risk_rating"], id, `${where}.residual_from`);
        const sameSeverity = typeof row.severity_from === "string" && rr?.args.severity_call === row.severity_from;
        if (rr && !sameSeverity) {
          c.problems.push(`${where}.residual_from (${rr.id}) must use the same severity_grade result as severity_from`);
        } else if (rr) {
          const rl = Number(rr.result.likelihood_grade);
          residual = {
            likelihood: rl,
            likelihoodSuggested: rl,
            likelihoodBy: "tool",
            severity: Number(rr.result.severity_grade),
            score: Number(rr.result.risk_score),
            level: { en: String(rr.result.risk_level_en), ko: String(rr.result.risk_level_ko) },
          };
        }
      }
    }
    const used = ctx.results.filter((r) => r.hazardId === id);
    rows.push({
      id,
      hazard: hazardText ? c.fill(hazardText) : { en: "", ko: "" },
      currentState: state ? c.fill(state) : { en: "", ko: "" },
      measurements: measurementLines(id, ctx.results),
      likelihood,
      severity,
      risk,
      controls: controls.map((t) => c.fill(t)),
      residual,
      evidence: used.map((r) => `${r.id} ${r.tool}`),
      assumptions: used.flatMap((r) => r.assumptions),
    });
  });

  for (const h of ctx.hazards) {
    if (h.measurement && !seen.has(h.id)) c.problems.push(`measured hazard ${h.id} is missing from rows`);
  }
  if (c.problems.length > 0) return { ok: false, problems: c.problems };
  return {
    ok: true,
    table: {
      title: { en: "Risk assessment", ko: "위험성평가표" },
      place: ctx.place,
      createdAt: ctx.createdAt,
      rows,
      summary: summary ? c.fill(summary) : { en: "", ko: "" },
      models: ctx.models,
    },
  };
}
