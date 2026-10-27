import {
  DISCLAIMER,
  ENERGY_REFERENCES,
  LEGAL_CONTEXT,
  LIKELIHOOD_BANDS,
  RISK_LEVELS,
  SEVERITY_BANDS,
  type Lang,
  type Text,
} from "./config.js";

export type Graded = { grade: number; label: Text; basis: Text };

export type ResolvedRow = {
  id: string;
  hazard: Text;
  currentState: Text;
  measurements: { label: Text; value: string }[];
  likelihood: Graded | null;
  severity: Graded | null;
  risk: { score: number; level: Text } | null;
  controls: Text[];
  residual: { likelihood: number; severity: number; score: number; level: Text } | null;
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

function graded(g: Graded | null, lang: Lang): string {
  if (!g) return lang === "ko" ? "측정 안 함" : "Not measured";
  return `${g.grade} (${g.label[lang]}) · ${g.basis[lang]}`;
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
      ? `${row.residual.likelihood} × ${row.residual.severity} = ${row.residual.score} · ${row.residual.level[lang]}`
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
  const l = LIKELIHOOD_BANDS.map((b) => `${b.grade} ${escapeHtml(b.label[lang])} (P ≥ ${b.from * 100}%)`).join(" · ");
  const s = SEVERITY_BANDS.map((b) => `${b.grade} ${escapeHtml(b.label[lang])} (E ≥ ${b.from} J)`).join(" · ");
  const r = RISK_LEVELS.map((b) => `${escapeHtml(b.label[lang])} (≥ ${b.from})`).join(" · ");
  const refs = ENERGY_REFERENCES.map((ref) => `${escapeHtml(ref.label[lang])} ${ref.value} ${ref.unit}: ${escapeHtml(ref.source)}`).join("<br>");
  const assumption = lang === "ko" ? "등급 경계는 가정이며 바꿀 수 있습니다." : "Band edges are assumptions and can be changed.";
  return `<p><b>${lang === "ko" ? "가능성" : "Likelihood"}</b>: ${l}<br><b>${lang === "ko" ? "중대성" : "Severity"}</b>: ${s}<br><b>${lang === "ko" ? "위험성" : "Risk"}</b>: ${r}<br>${assumption}<br>${refs}</p>`;
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
<div class="meta">${escapeHtml(table.place)} · ${escapeHtml(table.createdAt)} · ${escapeHtml(table.models.join(", "))}</div>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
<p>${multiline(table.summary[lang])}</p>
<div class="note">${legend(lang)}<p>${escapeHtml(LEGAL_CONTEXT[lang])}</p><p>${escapeHtml(DISCLAIMER[lang])}</p></div>
<div class="sign">${lang === "ko" ? "관리감독자" : "Supervisor"}: ____________________ ${lang === "ko" ? "서명" : "Signature"}: ____________________ ${lang === "ko" ? "날짜" : "Date"}: ____________</div>
</body>
</html>`;
}
