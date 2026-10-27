import { riskRating } from "./assess.js";
import {
  DISCLAIMER,
  LEGAL_CONTEXT,
  LIKELIHOOD_LABELS,
  MARGIN_LIKELIHOOD_EDGES_M,
  MARGIN_LIKELIHOOD_REST_GRADE,
  MATRIX,
  RISK_LEVELS,
  SEVERITY_BANDS,
  type Lang,
  type Text,
} from "./config.js";

/** Who set a grade: the tool's suggestion, or the supervisor. */
export type SetBy = "tool" | "supervisor";

export type Graded = {
  grade: number;
  label: Text;
  basis: Text;
  /** The grade the tools suggested; equal to grade until the supervisor changes it. */
  suggested: number;
  by: SetBy;
};

export type Residual = {
  likelihood: number;
  likelihoodSuggested: number;
  likelihoodBy: SetBy;
  severity: number;
  score: number;
  level: Text;
};

export type ResolvedRow = {
  id: string;
  hazard: Text;
  currentState: Text;
  measurements: { label: Text; value: string }[];
  likelihood: Graded | null;
  severity: Graded | null;
  risk: { score: number; level: Text } | null;
  controls: Text[];
  residual: Residual | null;
  evidence: string[];
  assumptions: Text[];
};

export type AssessmentTable = {
  title: Text;
  place: string;
  createdAt: string;
  rows: ResolvedRow[];
  summary: Text;
  models: string[];
};

const HEADERS: Record<Lang, string[]> = {
  ko: [
    "번호",
    "유해·위험요인",
    "현재 상태",
    "측정값",
    "가능성",
    "중대성",
    "위험성",
    "감소대책",
    "개선 후 위험성",
    "근거",
    "관리감독자 확인",
  ],
  en: [
    "No.",
    "Hazard",
    "Current state",
    "Measurements",
    "Likelihood",
    "Severity",
    "Risk",
    "Controls",
    "Residual risk",
    "Evidence",
    "Supervisor check",
  ],
};

function setByText(by: SetBy, suggested: number, lang: Lang): string {
  if (by === "supervisor") return lang === "ko" ? `관리감독자가 정함, 제안 ${suggested}` : `set by supervisor, suggested ${suggested}`;
  return lang === "ko" ? "제안값, 확인 전" : "suggested, not yet confirmed";
}

function graded(g: Graded | null, lang: Lang): string {
  if (!g) return lang === "ko" ? "측정 안 함" : "Not measured";
  return `${g.grade} (${g.label[lang]}) · ${setByText(g.by, g.suggested, lang)} · ${g.basis[lang]}`;
}

function likelihoodLabel(grade: number): Text {
  return LIKELIHOOD_LABELS[grade] ?? LIKELIHOOD_LABELS[1];
}

function severityLabel(grade: number): Text {
  return (SEVERITY_BANDS.find((b) => b.grade === grade) ?? SEVERITY_BANDS[0]).label;
}

export type GradeSlot = "likelihood" | "severity" | "residual";

function checkGrade(grade: number, max: number): void {
  if (!Number.isInteger(grade) || grade < 1 || grade > max) throw new Error(`grade must be an integer 1..${max}`);
}

/**
 * The supervisor sets one grade of one row. Risk scores are recomputed from the
 * grades on the same matrix; the tools' suggestion is kept next to the new grade.
 */
export function setGrade(table: AssessmentTable, rowId: string, slot: GradeSlot, grade: number): AssessmentTable {
  const rows = table.rows.map((row) => {
    if (row.id !== rowId) return row;
    const next: ResolvedRow = { ...row };
    if (slot === "likelihood" && row.likelihood) {
      checkGrade(grade, MATRIX.likelihoodLevels);
      next.likelihood = { ...row.likelihood, grade, label: likelihoodLabel(grade), by: grade === row.likelihood.suggested ? "tool" : "supervisor" };
    } else if (slot === "severity" && row.severity) {
      checkGrade(grade, MATRIX.severityLevels);
      next.severity = { ...row.severity, grade, label: severityLabel(grade), by: grade === row.severity.suggested ? "tool" : "supervisor" };
    } else if (slot === "residual" && row.residual) {
      checkGrade(grade, MATRIX.likelihoodLevels);
      next.residual = { ...row.residual, likelihood: grade, likelihoodBy: grade === row.residual.likelihoodSuggested ? "tool" : "supervisor" };
    } else {
      throw new Error(`row ${rowId} has no ${slot} grade`);
    }
    if (next.likelihood && next.severity) {
      const r = riskRating(next.likelihood.grade, next.severity.grade);
      next.risk = { score: r.score, level: r.level.label };
    }
    if (next.residual && next.severity) {
      const r = riskRating(next.residual.likelihood, next.severity.grade);
      next.residual = { ...next.residual, severity: next.severity.grade, score: r.score, level: r.level.label };
    }
    return next;
  });
  return { ...table, rows };
}

export function rowCells(row: ResolvedRow, index: number, lang: Lang): string[] {
  return [
    String(index + 1),
    row.hazard[lang],
    row.currentState[lang],
    row.measurements.map((m) => `${m.label[lang]} ${m.value}`).join("\n"),
    graded(row.likelihood, lang),
    graded(row.severity, lang),
    row.risk ? `${row.risk.score} · ${row.risk.level[lang]}` : "",
    row.controls.map((c) => `- ${c[lang]}`).join("\n"),
    row.residual
      ? `${row.residual.likelihood} × ${row.residual.severity} = ${row.residual.score} · ${row.residual.level[lang]} (${lang === "ko" ? "가능성" : "likelihood"}: ${setByText(row.residual.likelihoodBy, row.residual.likelihoodSuggested, lang)})`
      : "",
    row.evidence.join("\n"),
    "",
  ];
}

function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV with a byte-order mark so spreadsheet apps read Korean correctly. */
export function toCsv(table: AssessmentTable, lang: Lang): string {
  const lines = [HEADERS[lang].map(csvField).join(",")];
  table.rows.forEach((row, i) => lines.push(rowCells(row, i, lang).map(csvField).join(",")));
  lines.push("");
  lines.push(csvField(DISCLAIMER[lang]));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function multiline(value: string): string {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

function legend(lang: Lang): string {
  const edges = MARGIN_LIKELIHOOD_EDGES_M.map(
    (e) => `${e.grade} ${escapeHtml(likelihoodLabel(e.grade)[lang])} (${e.inclusive ? "≤" : "<"} ${Math.round(e.upTo * 100)} cm)`,
  );
  edges.push(
    `${MARGIN_LIKELIHOOD_REST_GRADE} ${escapeHtml(likelihoodLabel(MARGIN_LIKELIHOOD_REST_GRADE)[lang])} (${lang === "ko" ? "그 밖" : "otherwise"})`,
  );
  const s = SEVERITY_BANDS.map((b) => `${b.grade} ${escapeHtml(b.label[lang])} (E ≥ ${b.from} J)`).join(" · ");
  const r = RISK_LEVELS.map((b) => `${escapeHtml(b.label[lang])} (≥ ${b.from})`).join(" · ");
  const text =
    lang === "ko"
      ? {
          l: "가능성 제안(여유의 하위 5% 값)",
          s: "중대성 제안(충돌 에너지 자릿수)",
          r: "위험성",
          note: "등급 경계는 가정입니다. 제안값은 측정한 기하와 에너지에서 나오며, 사고나 부상의 확률이 아닙니다. 등급은 관리감독자가 정합니다.",
        }
      : {
          l: "Likelihood suggestion (lower 5% of the margin)",
          s: "Severity suggestion (impact energy, by decade)",
          r: "Risk",
          note: "Band edges are assumptions. Suggestions come from measured geometry and energy; they are not probabilities of an accident or an injury. The supervisor sets the grades.",
        };
  return `<p><b>${text.l}</b>: ${edges.join(" · ")}<br><b>${text.s}</b>: ${s}<br><b>${text.r}</b>: ${r}<br>${text.note}</p>`;
}

/** A printable page (A4 landscape) for the assessment record. */
export function toPrintableHtml(table: AssessmentTable, lang: Lang): string {
  const head = HEADERS[lang].map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const body = table.rows
    .map((row, i) => `<tr>${rowCells(row, i, lang).map((c) => `<td>${multiline(c)}</td>`).join("")}</tr>`)
    .join("");
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(table.title[lang])}</title>
<style>
@page { size: A4 landscape; margin: 12mm; }
body { font-family: system-ui, sans-serif; color: #2b2b2b; font-size: 10pt; }
h1 { font-size: 15pt; margin: 0 0 4px; color: #3f3f3f; }
.meta { color: #555; margin-bottom: 8px; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #9a9a9a; padding: 4px 6px; vertical-align: top; }
th { background: #f2f2f2; color: #3f3f3f; }
.note { color: #444; font-size: 9pt; margin-top: 10px; }
.sign { margin-top: 16px; }
</style>
</head>
<body>
<h1>${escapeHtml(table.title[lang])}</h1>
<div class="meta">${[table.place, table.createdAt, table.models.join(", ")].filter((x) => x).map(escapeHtml).join(" · ")}</div>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
<p>${multiline(table.summary[lang])}</p>
<div class="note">${legend(lang)}<p>${escapeHtml(LEGAL_CONTEXT[lang])}</p><p>${escapeHtml(DISCLAIMER[lang])}</p></div>
<div class="sign">${lang === "ko" ? "관리감독자" : "Supervisor"}: ____________________ ${lang === "ko" ? "서명" : "Signature"}: ____________________ ${lang === "ko" ? "날짜" : "Date"}: ____________</div>
</body>
</html>`;
}
