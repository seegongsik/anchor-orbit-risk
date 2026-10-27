/**
 * Scene survey: Muse Spark Open looks at the photo and lists hazard candidates
 * with noun phrases that SAM 3.1 can segment. Masses are the model's estimates
 * and stay labeled that way all the way into the table.
 */
import type { Hazard, HazardKind } from "../src/assessment/types.js";
import { extractJsonObject, type ChatMessage, type SparkReply } from "./spark.js";

export const SURVEY_PROMPT = `You look at a phone photo for a workplace safety supervisor.
List up to five things that could fall off an edge or tip over, and any leaning ladder.
The object is the thing that could fall, never the furniture it rests on: on a desk with a mug near its edge, the object is the mug and the support is the desk.
For each item give:
- kind: "edge" (an object resting on a table, desk, shelf or bench, near its edge), "ladder" (a leaning ladder) or "other"
- object: a short English noun phrase that names it for an image segmentation model, two or three words, with its colour or another visible feature so that it picks out this one item among similar ones, such as "white mug", "red scissors" or "small cardboard box"
- support: a short English noun phrase for what it rests on, such as "desk" or "shelf" (empty for a ladder)
- below: what is directly below the edge or the ladder
- material: its main material
- mass_kg_low and mass_kg_high: your estimate of its mass in kilograms
- sharp_edge_down: true if a blade, point or sharp corner would lead if it fell
- note: one short sentence in English (en) and Korean (ko)
Do not list people and do not describe anyone. Name objects without brands.
Reply with one JSON object only: {"hazards": [ ... ]}`;

export type SurveyItem = Hazard;

type JsonRecord = Record<string, unknown>;

function phrase(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[^\p{L}\p{N} '-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

function mass(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 2000 ? value : null;
}

/** Keeps only well-formed items and gives them ids h1, h2, … */
export function sanitizeSurvey(value: unknown): Hazard[] {
  const root = (typeof value === "object" && value !== null ? value : {}) as JsonRecord;
  const items = Array.isArray(root.hazards) ? root.hazards.slice(0, 5) : [];
  const out: Hazard[] = [];
  for (const raw of items) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as JsonRecord;
    const kind: HazardKind = item.kind === "edge" || item.kind === "ladder" ? item.kind : "other";
    const object = phrase(item.object);
    if (!object) continue;
    const support = phrase(item.support);
    const low = mass(item.mass_kg_low);
    const high = mass(item.mass_kg_high);
    const note = (typeof item.note === "object" && item.note !== null ? item.note : {}) as JsonRecord;
    const hazard: Hazard = {
      id: `h${out.length + 1}`,
      kind,
      object,
      ...(support ? { support } : {}),
      ...(phrase(item.below) ? { below: phrase(item.below) } : {}),
      ...(phrase(item.material) ? { material: phrase(item.material) } : {}),
      ...(typeof item.sharp_edge_down === "boolean" ? { sharpEdgeDown: item.sharp_edge_down } : {}),
      ...(typeof note.en === "string" && typeof note.ko === "string"
        ? { note: { en: note.en.slice(0, 200), ko: note.ko.slice(0, 200) } }
        : {}),
    };
    if (kind === "ladder") {
      hazard.massKg = { low: 60, high: 100, source: "assumption" };
    } else if (low !== null || high !== null) {
      const a = low ?? high ?? 0;
      const b = high ?? low ?? 0;
      hazard.massKg = { low: Math.min(a, b), high: Math.max(a, b), source: "model estimate" };
    }
    out.push(hazard);
  }
  return out;
}

export async function surveyScene(
  imageDataUrl: string,
  chat: (request: { messages: ChatMessage[]; maxTokens?: number }) => Promise<SparkReply>,
): Promise<{ hazards: Hazard[]; tokens: number; latencyMs: number; retried: boolean }> {
  const messages: ChatMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: SURVEY_PROMPT },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ],
    },
  ];
  let tokens = 0;
  let latencyMs = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const reply = await chat({ messages, maxTokens: 1500 });
    tokens += reply.usage.totalTokens;
    latencyMs += reply.latencyMs;
    try {
      return { hazards: sanitizeSurvey(extractJsonObject(reply.content)), tokens, latencyMs, retried: attempt > 0 };
    } catch (error) {
      messages.push({ role: "assistant", content: reply.content });
      messages.push({
        role: "user",
        content: `That was not one JSON object (${error instanceof Error ? error.message : "parse error"}). Reply with {"hazards": [...]} only.`,
      });
    }
  }
  throw new Error("the survey reply was not valid JSON twice");
}
