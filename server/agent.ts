/**
 * The assessment agent: Muse Spark Open calls the physics and risk tools for
 * each hazard, then submits a table that the number checker accepts or sends
 * back. It uses native tool calls when the deployment supports them and a
 * plain JSON protocol otherwise.
 */
import type { Hazard } from "../src/assessment/types.js";
import type { AssessmentTable } from "../src/risk/table.js";
import { checkSubmission } from "../src/assessment/checker.js";
import { MUSE_SPARK_OPEN_MODEL } from "./meta-client.js";
import {
  extractJsonObject,
  SparkError,
  type ChatMessage,
  type ContentPart,
  type SparkReply,
  type ToolSpec,
} from "./spark.js";
import { TOOL_SPECS, ToolBox, ToolError, type ToolResult } from "../src/assessment/tools.js";

const TEXT_SCHEMA = {
  type: "object",
  properties: { en: { type: "string" }, ko: { type: "string" } },
  required: ["en", "ko"],
  additionalProperties: false,
};

export const SUBMIT_SPEC: ToolSpec = {
  type: "function",
  function: {
    name: "submit_assessment",
    description:
      "Submit the final risk assessment. Do not type grades or scores: refer to tool result ids. Text may show numbers only through {call_N.field} placeholders.",
    parameters: {
      type: "object",
      properties: {
        rows: {
          type: "array",
          items: {
            type: "object",
            properties: {
              hazard_id: { type: "string" },
              hazard: TEXT_SCHEMA,
              current_state: TEXT_SCHEMA,
              controls: { type: "array", items: TEXT_SCHEMA },
              likelihood_from: { type: "string" },
              severity_from: { type: "string" },
              risk_from: { type: "string" },
              residual_from: { type: "string" },
            },
            required: ["hazard_id", "hazard", "current_state", "controls"],
          },
        },
        summary: TEXT_SCHEMA,
      },
      required: ["rows", "summary"],
    },
  },
};

export const SYSTEM_PROMPT = `You help a workplace supervisor write a risk assessment (likelihood x severity) for things photographed with a phone.
The phone measured each hazard with its gravity sensor and Meta SAM 3.1 segmentation. You see those measurements only through tools.
The tools suggest grades from measured geometry and energy. The supervisor confirms or changes every grade afterwards, so your table is a draft for them.

Rules:
1. Every number in the assessment comes from a tool result. In text you may not type digits at all. To show a number, write a placeholder {call_N.field} naming a numeric field of a tool result, for example "Move it inward by at least {call_5.move_by_m}." The server fills placeholders in and formats units.
2. For each measured edge hazard call: tipover_margin (it gives the margin and a suggested likelihood grade); drop_energy; severity_grade on that drop_energy result; risk_rating with the tipover_margin and severity_grade results. Then propose controls. For the main control call move_target, then risk_rating with the move_target result and the same severity_grade result, and cite it as residual_from. Keep the default target margin unless the scene clearly needs a larger one, and say why.
3. For a ladder hazard call: ladder_angle; drop_energy (a person on the ladder, defaults are set); severity_grade; risk_rating.
4. If tipover_margin reports a margin before and after a change, say in current_state how the margin changed, with placeholders.
5. Write every text field in English (en) and Korean (ko), in short plain sentences. Name objects by what they are, never by brand. Do not describe or identify people. Give no medical advice and do not predict injuries or the chance of an accident: speak about the measured margin, how far the object would have to move, and the impact energy. Call the centre of mass an estimate.
6. Order controls by the hierarchy: remove the hazard, move it, add a physical barrier (edge lip, tray, anti-slip mat), then rules and signs.
7. You may call several tools in one turn. Finish by calling submit_assessment once, with one row per hazard.`;

export type TraceEvent =
  | { type: "mode"; mode: "tools" | "json"; reason?: string }
  | {
      type: "turn";
      n: number;
      toolCalls: string[];
      tokens: number;
      latencyMs: number;
      reasoningChars: number;
    }
  | { type: "tool"; id: string; name: string; args: unknown; result?: Record<string, unknown>; error?: string }
  | { type: "check"; ok: boolean; problems: string[] }
  | { type: "final"; table: AssessmentTable }
  | { type: "error"; message: string };

export type ChatFn = (request: {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  maxTokens?: number;
}) => Promise<SparkReply>;

export type AssessmentRun = {
  table: AssessmentTable;
  turns: number;
  totalTokens: number;
  mode: "tools" | "json";
  results: ToolResult[];
};

function hazardBrief(hazards: Hazard[]): string {
  return JSON.stringify(
    hazards.map((h) => ({
      hazard_id: h.id,
      kind: h.kind,
      object: h.object,
      support: h.support ?? null,
      below: h.below ?? null,
      material: h.material ?? null,
      mass_kg: h.massKg ? `${h.massKg.low} to ${h.massKg.high} (${h.massKg.source})` : null,
      sharp_edge_down: h.sharpEdgeDown ?? null,
      measured: h.measurement ? h.measurement.type : "not measured",
      measured_again_after_a_change: h.before !== undefined,
    })),
  );
}

function jsonModeTools(): string {
  return [...TOOL_SPECS, SUBMIT_SPEC]
    .map((t) => `- ${t.function.name}: ${t.function.description}\n  parameters: ${JSON.stringify(t.function.parameters)}`)
    .join("\n");
}

const JSON_MODE_RULES = `Tools are called with JSON. Reply with exactly one JSON object and nothing else:
{"calls": [{"tool": "<name>", "args": {...}}, ...]} to call one or more tools, or
{"submit": {"rows": [...], "summary": {...}}} to submit the final assessment (same fields as submit_assessment).
Tool results come back in the next message.`;

export async function runAssessment(
  input: {
    hazards: Hazard[];
    place?: string;
    imageDataUrl?: string;
    createdAt?: string;
    models?: string[];
  },
  deps: { chat: ChatFn; onEvent?: (event: TraceEvent) => void; maxTurns?: number; maxRejections?: number },
): Promise<AssessmentRun> {
  const emit = deps.onEvent ?? (() => {});
  const maxTurns = deps.maxTurns ?? 14;
  const maxRejections = deps.maxRejections ?? 3;
  const box = new ToolBox(input.hazards);
  const place = input.place ?? "";
  const createdAt = input.createdAt ?? new Date().toISOString().slice(0, 10);
  const models = input.models ?? ["sam-3.1", MUSE_SPARK_OPEN_MODEL];
  let mode: "tools" | "json" = "tools";
  emit({ type: "mode", mode });

  const userContent: ContentPart[] = [
    {
      type: "text",
      text: `Place: ${place || "not given"}.\nHazards found in the photo (measured by the phone where noted):\n${hazardBrief(input.hazards)}\nAssess every hazard, then submit.`,
    },
  ];
  if (input.imageDataUrl) userContent.push({ type: "image_url", image_url: { url: input.imageDataUrl } });

  let messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
  let rejections = 0;
  let reminders = 0;
  let totalTokens = 0;

  const execute = (name: string, args: unknown): Record<string, unknown> => {
    try {
      const result = box.run(name, args);
      emit({ type: "tool", id: result.id, name, args, result: result.result });
      return { result_id: result.id, ...result.result, assumptions: result.assumptions.map((a) => a.en) };
    } catch (error) {
      const message = error instanceof ToolError || error instanceof Error ? error.message : String(error);
      emit({ type: "tool", id: "", name, args, error: message });
      return { error: message };
    }
  };

  const trySubmit = (submission: unknown): { done: AssessmentRun | null; reply: Record<string, unknown> } => {
    const outcome = checkSubmission(submission, { results: box.results, hazards: input.hazards, place, createdAt, models });
    emit({ type: "check", ok: outcome.ok, problems: outcome.ok ? [] : outcome.problems });
    if (outcome.ok) {
      emit({ type: "final", table: outcome.table });
      return { done: { table: outcome.table, turns: 0, totalTokens, mode, results: box.results }, reply: { accepted: true } };
    }
    rejections += 1;
    if (rejections > maxRejections) {
      throw new Error(`the number checker rejected the table ${rejections} times: ${outcome.problems.join("; ")}`);
    }
    return { done: null, reply: { accepted: false, problems: outcome.problems } };
  };

  const switchToJson = (reason: string) => {
    mode = "json";
    emit({ type: "mode", mode, reason });
    messages = [
      { role: "system", content: `${SYSTEM_PROMPT}\n\n${JSON_MODE_RULES}\n\nTools:\n${jsonModeTools()}` },
      { role: "user", content: userContent },
    ];
  };

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    let reply: SparkReply;
    try {
      reply = await deps.chat({
        messages,
        ...(mode === "tools" ? { tools: [...TOOL_SPECS, SUBMIT_SPEC] } : {}),
        maxTokens: 3000,
      });
    } catch (error) {
      if (mode === "tools" && error instanceof SparkError && error.status === 400 && turn <= 2) {
        switchToJson(`the deployment refused native tools (${error.message.slice(0, 120)})`);
        continue;
      }
      throw error;
    }
    totalTokens += reply.usage.totalTokens;
    emit({
      type: "turn",
      n: turn,
      toolCalls: reply.toolCalls.map((c) => c.function.name),
      tokens: reply.usage.totalTokens,
      latencyMs: reply.latencyMs,
      reasoningChars: reply.reasoningChars,
    });

    if (mode === "tools") {
      if (reply.toolCalls.length === 0) {
        if (turn === 1 && /"calls"\s*:/.test(reply.content)) {
          switchToJson("the model wrote tool calls as text");
          continue;
        }
        reminders += 1;
        if (reminders > 2) throw new Error("the agent stopped without submitting an assessment");
        messages.push({ role: "assistant", content: reply.content || null });
        messages.push({ role: "user", content: "Continue: call the tools you still need, then call submit_assessment." });
        continue;
      }
      messages.push({ role: "assistant", content: reply.content || null, tool_calls: reply.toolCalls });
      let finished: AssessmentRun | null = null;
      for (const call of reply.toolCalls) {
        let args: unknown;
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "arguments are not valid JSON" }) });
          continue;
        }
        if (call.function.name === "submit_assessment") {
          const { done, reply: answer } = trySubmit(args);
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(answer) });
          if (done) finished = { ...done, turns: turn, totalTokens };
          continue;
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(execute(call.function.name, args)) });
      }
      if (finished) return finished;
      continue;
    }

    // JSON protocol.
    messages.push({ role: "assistant", content: reply.content });
    let parsed: Record<string, unknown> | null;
    try {
      const value = extractJsonObject(reply.content);
      parsed = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
    } catch (error) {
      messages.push({
        role: "user",
        content: `Your reply was not one JSON object (${error instanceof Error ? error.message : "parse error"}). Reply with {"calls": [...]} or {"submit": {...}}.`,
      });
      continue;
    }
    if (parsed && "submit" in parsed) {
      const { done, reply: answer } = trySubmit(parsed.submit);
      if (done) return { ...done, turns: turn, totalTokens };
      messages.push({ role: "user", content: `Submission result: ${JSON.stringify(answer)}` });
      continue;
    }
    const calls = Array.isArray(parsed?.calls) ? parsed.calls : [];
    if (calls.length === 0) {
      reminders += 1;
      if (reminders > 2) throw new Error("the agent stopped without submitting an assessment");
      messages.push({ role: "user", content: 'Call tools with {"calls": [...]} or submit with {"submit": {...}}.' });
      continue;
    }
    const results = calls.map((raw) => {
      const call = (typeof raw === "object" && raw !== null ? raw : {}) as { tool?: unknown; args?: unknown };
      return { tool: call.tool, ...execute(String(call.tool), call.args ?? {}) };
    });
    messages.push({ role: "user", content: `Tool results: ${JSON.stringify(results)}` });
  }
  throw new Error(`the agent did not finish within ${maxTurns} turns`);
}
