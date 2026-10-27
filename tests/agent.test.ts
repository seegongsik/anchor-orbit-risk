import { describe, expect, it } from "vitest";
import type { Hazard } from "../src/assessment/types.js";
import { degToRad } from "../src/physics/geometry.js";
import { marginMonteCarlo, plumbFromDown } from "../src/physics/plumb.js";
import { marginLikelihood } from "../src/risk/assess.js";
import { runAssessment, type ChatFn, type TraceEvent } from "../server/agent.js";
import { checkSubmission } from "../src/assessment/checker.js";
import { SparkError, type SparkReply, type ToolCall } from "../server/spark.js";
import { ToolBox } from "../src/assessment/tools.js";

// SYNTHETIC: the hazard comes from a known geometry, and the "model" below is a
// scripted fake that returns fixed replies. No real model output is used here.

function syntheticHazard(): Hazard {
  const plumb = plumbFromDown({ x: 0, y: 1 });
  const sigma = { comPx: 2, edgePx: 1, gravityRad: degToRad(0.5), scaleRel: 0.02 };
  const mc = marginMonteCarlo({
    com: { x: 240, y: 300 },
    edge: { x: 250, y: 360 },
    supportPoint: { x: 100, y: 360 },
    plumb,
    metersPerPixel: 0.001,
    sigma,
  });
  return {
    id: "h1",
    kind: "edge",
    object: "mug",
    support: "desk",
    below: "floor",
    material: "ceramic",
    massKg: { low: 0.3, high: 0.4, source: "model estimate" },
    sharpEdgeDown: false,
    measurement: {
      type: "edge",
      dM: mc.d.value,
      dStdM: mc.d.uncertainty,
      dP5M: mc.percentiles.p5,
      dP95M: mc.percentiles.p95,
      pUnstableNow: mc.pUnstable,
      iterations: mc.iterations,
      seed: mc.seed,
      gravitySource: "synthetic",
      gravityTiltDeg: 0,
      shiftWithoutGravityM: 0,
      cameraPitchDeg: null,
      comHeightAboveEdgeM: 0.06,
      dropHeightM: null,
      metersPerPixel: 0.001,
      scaleSource: "synthetic",
      maskSource: "synthetic",
      inputs: { comPx: { x: 240, y: 300 }, edgePx: { x: 250, y: 360 }, plumbDown: plumb.down, sigma },
    },
  };
}

let callCounter = 0;
function call(name: string, args: Record<string, unknown>): ToolCall {
  callCounter += 1;
  return { id: `fake_${callCounter}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function reply(toolCalls: ToolCall[], content = ""): SparkReply {
  return {
    content,
    reasoningChars: 0,
    toolCalls,
    finishReason: toolCalls.length ? "tool_calls" : "stop",
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    latencyMs: 1,
  };
}

function scripted(replies: Array<SparkReply | Error>): ChatFn {
  let i = 0;
  return async () => {
    const next = replies[i];
    i += 1;
    if (!next) throw new Error("script ran out");
    if (next instanceof Error) throw next;
    return next;
  };
}

const goodRow = {
  hazard_id: "h1",
  hazard: { en: "Ceramic mug close to the desk edge", ko: "책상 가장자리에 가까운 도자기 머그컵" },
  current_state: { en: "Its centre is {call_1.d_m} from the edge.", ko: "무게중심이 가장자리에서 {call_1.d_m} 떨어져 있다." },
  controls: [{ en: "Move it inward by at least {call_5.move_by_m}.", ko: "안쪽으로 {call_5.move_by_m} 이상 옮긴다." }],
  likelihood_from: "call_1",
  severity_from: "call_3",
  risk_from: "call_4",
  residual_from: "call_6",
};
const summary = { en: "One hazard assessed.", ko: "위험 요인 하나를 평가했다." };

describe("assessment agent (scripted fake model)", () => {
  it("runs native tool calls, rejects a typed number, then accepts", async () => {
    const events: TraceEvent[] = [];
    const chat = scripted([
      reply([call("tipover_margin", { hazard_id: "h1" }), call("drop_energy", { hazard_id: "h1" })]),
      reply([
        call("severity_grade", { drop_call: "call_2", use: "high" }),
        call("risk_rating", { likelihood_call: "call_1", severity_call: "call_3" }),
        call("move_target", { hazard_id: "h1" }),
      ]),
      reply([call("risk_rating", { likelihood_call: "call_5", severity_call: "call_3" })]),
      reply([
        call("submit_assessment", {
          rows: [{ ...goodRow, controls: [{ en: "Move it 5 cm inward.", ko: "5 cm 안쪽으로 옮긴다." }] }],
          summary,
        }),
      ]),
      reply([call("submit_assessment", { rows: [goodRow], summary })]),
    ]);
    const run = await runAssessment({ hazards: [syntheticHazard()], place: "test desk" }, { chat, onEvent: (e) => events.push(e) });
    expect(run.mode).toBe("tools");
    expect(run.turns).toBe(5);
    const checks = events.filter((e) => e.type === "check");
    expect(checks).toHaveLength(2);
    expect(checks[0]).toMatchObject({ ok: false });
    expect(checks[1]).toMatchObject({ ok: true });

    const row = run.table.rows[0];
    const m = syntheticHazard().measurement;
    const tip = run.results.find((r) => r.id === "call_1");
    expect(m?.type).toBe("edge");
    if (m?.type === "edge") expect(tip?.result.likelihood_grade).toBe(marginLikelihood(m.dP5M).grade);
    expect(row.likelihood).toMatchObject({ grade: tip?.result.likelihood_grade, by: "tool" });
    expect(row.likelihood?.suggested).toBe(row.likelihood?.grade);
    // A 0.3 to 0.4 kg mug from the assumed 0.75 m desk: up to 2.94 J, the 1-10 J decade.
    expect(row.severity?.grade).toBe(2);
    expect(row.risk?.score).toBe(Number(tip?.result.likelihood_grade) * 2);
    expect(row.residual?.likelihood).toBe(1);
    expect(row.controls[0].en).toMatch(/^Move it inward by at least \d/);
    expect(row.currentState.en).not.toContain("{call_");
    expect(run.table.rows[0].evidence.length).toBe(6);
  });

  it("falls back to the JSON protocol when native tools are refused", async () => {
    const events: TraceEvent[] = [];
    const json = (value: unknown) => reply([], JSON.stringify(value));
    const chat = scripted([
      new SparkError(400, "tools are not supported for this model"),
      json({ calls: [{ tool: "tipover_margin", args: { hazard_id: "h1" } }, { tool: "drop_energy", args: { hazard_id: "h1" } }] }),
      json({ calls: [{ tool: "severity_grade", args: { drop_call: "call_2" } }, { tool: "risk_rating", args: { likelihood_call: "call_1", severity_call: "call_3" } }, { tool: "move_target", args: { hazard_id: "h1" } }] }),
      json({ calls: [{ tool: "risk_rating", args: { likelihood_call: "call_5", severity_call: "call_3" } }] }),
      reply([], "```json\n" + JSON.stringify({ submit: { rows: [goodRow], summary } }) + "\n```"),
    ]);
    const run = await runAssessment({ hazards: [syntheticHazard()] }, { chat, onEvent: (e) => events.push(e) });
    expect(run.mode).toBe("json");
    expect(events.find((e) => e.type === "mode" && e.mode === "json")).toBeTruthy();
    expect(run.table.rows).toHaveLength(1);
  });

  it("gives up after repeated rejections", async () => {
    const bad = reply([call("submit_assessment", { rows: [{ ...goodRow, likelihood_from: "call_99" }], summary })]);
    const chat = scripted([bad, bad, bad, bad, bad]);
    await expect(runAssessment({ hazards: [syntheticHazard()] }, { chat, maxRejections: 3 })).rejects.toThrow(/rejected/);
  });
});

describe("number checker", () => {
  function prepared() {
    const hazards = [syntheticHazard()];
    const box = new ToolBox(hazards);
    box.run("tipover_margin", { hazard_id: "h1" });
    box.run("drop_energy", { hazard_id: "h1" });
    box.run("severity_grade", { drop_call: "call_2" });
    box.run("risk_rating", { likelihood_call: "call_1", severity_call: "call_3" });
    box.run("move_target", { hazard_id: "h1" });
    box.run("risk_rating", { likelihood_call: "call_5", severity_call: "call_3" });
    return { hazards, results: box.results, place: "", createdAt: "2026-10-27", models: [] };
  }

  it("accepts placeholders and rejects typed digits", () => {
    expect(checkSubmission({ rows: [goodRow], summary }, prepared()).ok).toBe(true);
    const typed = checkSubmission({ rows: [{ ...goodRow, hazard: { en: "Mug 3 cm from edge", ko: "가장자리에서 3 cm" } }], summary }, prepared());
    expect(typed.ok).toBe(false);
  });

  it("rejects a risk rating that does not match the cited grades", () => {
    const wrong = checkSubmission({ rows: [{ ...goodRow, risk_from: "call_6" }], summary }, prepared());
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.problems.join(" ")).toMatch(/must rate call_1 with call_3/);
  });

  it("rejects placeholders to unknown results or non-numeric fields", () => {
    const unknown = checkSubmission(
      { rows: [{ ...goodRow, current_state: { en: "See {call_42.d_m}", ko: "{call_42.d_m}" } }], summary },
      prepared(),
    );
    expect(unknown.ok).toBe(false);
    const text = checkSubmission(
      { rows: [{ ...goodRow, current_state: { en: "{call_1.mask_source}", ko: "{call_1.mask_source}" } }], summary },
      prepared(),
    );
    expect(text.ok).toBe(false);
  });

  it("requires every measured hazard in the table", () => {
    const missing = checkSubmission({ rows: [], summary }, prepared());
    expect(missing.ok).toBe(false);
  });
});

describe("local assessment (no agent)", () => {
  it("builds a checked table from the same tools", async () => {
    const { localAssessment } = await import("../src/assessment/local.js");
    const { table, results } = localAssessment([syntheticHazard(), { id: "h2", kind: "other", object: "A4 binder" }], {
      place: "test",
      createdAt: "2026-10-27",
    });
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0].likelihood).not.toBeNull();
    expect(table.rows[0].residual?.likelihood).toBe(1);
    expect(table.rows[1].likelihood).toBeNull();
    expect(table.rows[1].hazard.en).toBe("A4 binder");
    expect(results.length).toBe(6);
  });

  it("reports the margin before and after a re-shoot", async () => {
    const { localAssessment } = await import("../src/assessment/local.js");
    const hazard = { ...syntheticHazard(), before: { dM: 0.004, dP5M: 0.001, capturedAt: "2026-10-27T01:00:00.000Z" } };
    const { table, results } = localAssessment([hazard], { place: "test", createdAt: "2026-10-27" });
    const tip = results.find((r) => r.tool === "tipover_margin");
    expect(tip?.result.before_d_p5_m).toBe(0.001);
    const m = hazard.measurement;
    if (m?.type === "edge") expect(tip?.result.change_d_p5_m).toBeCloseTo(m.dP5M - 0.001, 12);
    expect(table.rows[0].currentState.en).toContain("Measured again after a change");
    expect(table.rows[0].measurements.some((x) => x.label.en === "Lower 5%: before → after")).toBe(true);
  });
});

describe("tool and checker guards", () => {
  it("rates risk only from a likelihood result and a severity result", () => {
    const box = new ToolBox([syntheticHazard()]);
    box.run("tipover_margin", { hazard_id: "h1" });
    box.run("drop_energy", { hazard_id: "h1" });
    box.run("severity_grade", { drop_call: "call_2" });
    expect(() => box.run("risk_rating", { likelihood_call: "call_2", severity_call: "call_3" })).toThrow(/likelihood_call/);
    expect(() => box.run("move_target", { hazard_id: "h1", target_d_m: 5 })).not.toThrow();
    expect(box.results.at(-1)?.result.required_d_m).toBe(0.3);
  });

  it("rejects a residual risk rated with a different severity", () => {
    const box = new ToolBox([syntheticHazard()]);
    box.run("tipover_margin", { hazard_id: "h1" });
    box.run("drop_energy", { hazard_id: "h1" });
    box.run("severity_grade", { drop_call: "call_2" });
    box.run("risk_rating", { likelihood_call: "call_1", severity_call: "call_3" });
    box.run("move_target", { hazard_id: "h1" });
    box.run("severity_grade", { drop_call: "call_2", use: "low" });
    box.run("risk_rating", { likelihood_call: "call_5", severity_call: "call_6" });
    const outcome = checkSubmission(
      { rows: [{ ...goodRow, residual_from: "call_7" }], summary },
      { hazards: [syntheticHazard()], results: box.results, place: "", createdAt: "2026-10-27", models: [] },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.problems.join(" ")).toMatch(/same severity_grade/);
  });
});
