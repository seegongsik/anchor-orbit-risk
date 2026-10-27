/**
 * Best-effort spend guard for the public URL. Counters live in one serverless
 * instance's memory, so they cap bursts and runaway loops; they are not a
 * global quota. The provider dashboards remain the real limit.
 */
import type { EnvMap } from "./keys.js";

export type BudgetKind = "sam" | "spark";

const DEFAULT_DAILY_CAP: Record<BudgetKind, number> = { sam: 300, spark: 400 };
const PER_CLIENT_PER_MINUTE = 12;

type DayCount = { day: string; count: number };

const daily = new Map<BudgetKind, DayCount>();
const perClient = new Map<string, number[]>();

function today(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function dailyCap(kind: BudgetKind, env: EnvMap = process.env): number {
  const raw = env[kind === "sam" ? "DAILY_SAM_CALL_CAP" : "DAILY_SPARK_CALL_CAP"];
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_CAP[kind];
}

export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0]?.trim() || "local";
}

export type BudgetDecision = { ok: true } | { ok: false; status: 429; reason: string };

/** Reserves `calls` model calls for this client, or says why not. */
export function reserve(
  kind: BudgetKind,
  client: string,
  calls = 1,
  options: { env?: EnvMap; now?: number } = {},
): BudgetDecision {
  const now = options.now ?? Date.now();
  const cap = dailyCap(kind, options.env);
  const day = today(now);
  const current = daily.get(kind);
  const count = current && current.day === day ? current.count : 0;
  if (count + calls > cap) {
    return { ok: false, status: 429, reason: `The daily ${kind} budget of this demo is used up. It resets at 00:00 UTC.` };
  }
  const recent = (perClient.get(client) ?? []).filter((t) => now - t < 60_000);
  if (recent.length + 1 > PER_CLIENT_PER_MINUTE) {
    return { ok: false, status: 429, reason: "Too many requests from this device. Wait a minute." };
  }
  recent.push(now);
  perClient.set(client, recent);
  daily.set(kind, { day, count: count + calls });
  return { ok: true };
}

export function usage(kind: BudgetKind, env: EnvMap = process.env, now = Date.now()) {
  const current = daily.get(kind);
  const used = current && current.day === today(now) ? current.count : 0;
  return { used, cap: dailyCap(kind, env) };
}

/** Test helper. */
export function resetBudget(): void {
  daily.clear();
  perClient.clear();
}
