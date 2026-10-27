/** Phone-friendly view of the assessment table, plus exports. */
import { LIKELIHOOD_LABELS, MATRIX, SEVERITY_BANDS, type Lang, type Text } from "../risk/config.js";
import { escapeHtml, toCsv, toPrintableHtml, type AssessmentTable, type GradeSlot, type SetBy } from "../risk/table.js";

function levelClass(score: number | undefined): string {
  if (score === undefined) return "";
  if (score >= 10) return "lvl-high";
  if (score >= 5) return "lvl-mid";
  return "lvl-low";
}

/** Photos of a hazard before and after a change, as data URLs. */
export type BeforeAfter = { before: string; after: string };

function options(levels: number, label: (grade: number) => Text, chosen: number, lang: Lang): string {
  return Array.from({ length: levels }, (_, i) => i + 1)
    .map((g) => `<option value="${g}"${g === chosen ? " selected" : ""}>${g} · ${escapeHtml(label(g)[lang])}</option>`)
    .join("");
}

function setByNote(by: SetBy, suggested: number, lang: Lang): string {
  return by === "supervisor"
    ? `<em class="by-sup">${lang === "ko" ? `관리감독자가 정함 · 제안 ${suggested}` : `Set by supervisor · suggested ${suggested}`}</em>`
    : `<em>${lang === "ko" ? "제안값 · 확인하거나 바꾸세요" : "Suggested · confirm or change"}</em>`;
}

const likelihoodLabel = (g: number): Text => LIKELIHOOD_LABELS[g] ?? LIKELIHOOD_LABELS[1];
const severityLabel = (g: number): Text => (SEVERITY_BANDS.find((b) => b.grade === g) ?? SEVERITY_BANDS[0]).label;

export function renderTable(
  host: HTMLElement,
  table: AssessmentTable,
  lang: Lang,
  previous: AssessmentTable | null,
  photos: Map<string, BeforeAfter> = new Map(),
): void {
  const before = new Map((previous?.rows ?? []).map((r) => [r.id, r]));
  const cards = table.rows
    .map((row, i) => {
      const prior = before.get(row.id);
      const compare =
        prior?.risk && row.risk
          ? `<div class="compare">${lang === "ko" ? "이전 평가" : "Previous assessment"} ${prior.risk.score} → ${lang === "ko" ? "지금" : "now"} ${row.risk.score}</div>`
          : "";
      const pair = photos.get(row.id);
      const shots = pair
        ? `<div class="shots"><figure><img src="${pair.before}" alt=""><figcaption>${lang === "ko" ? "바꾸기 전" : "Before"}</figcaption></figure><figure><img src="${pair.after}" alt=""><figcaption>${lang === "ko" ? "바꾼 뒤" : "After"}</figcaption></figure></div>`
        : "";
      const measurements = row.measurements
        .map((m) => `<li><span>${escapeHtml(m.label[lang])}</span><b>${escapeHtml(m.value)}</b></li>`)
        .join("");
      const select = (slot: GradeSlot, levels: number, label: (g: number) => Text, chosen: number) =>
        `<select data-row="${escapeHtml(row.id)}" data-slot="${slot}" aria-label="${slot}">${options(levels, label, chosen, lang)}</select>`;
      const likelihood = row.likelihood
        ? `<div class="grade"><span>${lang === "ko" ? "가능성" : "Likelihood"}</span>${select(
            "likelihood",
            MATRIX.likelihoodLevels,
            likelihoodLabel,
            row.likelihood.grade,
          )}${setByNote(row.likelihood.by, row.likelihood.suggested, lang)}<small>${escapeHtml(row.likelihood.basis[lang])}</small></div>`
        : `<div class="grade"><span>${lang === "ko" ? "가능성" : "Likelihood"}</span><b>–</b>${lang === "ko" ? "측정 안 함" : "not measured"}</div>`;
      const severity = row.severity
        ? `<div class="grade"><span>${lang === "ko" ? "중대성" : "Severity"}</span>${select(
            "severity",
            MATRIX.severityLevels,
            severityLabel,
            row.severity.grade,
          )}${setByNote(row.severity.by, row.severity.suggested, lang)}<small>${escapeHtml(row.severity.basis[lang])}</small></div>`
        : `<div class="grade"><span>${lang === "ko" ? "중대성" : "Severity"}</span><b>–</b>${lang === "ko" ? "측정 안 함" : "not measured"}</div>`;
      const controls = row.controls.map((c) => `<li>${escapeHtml(c[lang])}</li>`).join("");
      const residual = row.residual
        ? `<div class="residual ${levelClass(row.residual.score)}"><span>${lang === "ko" ? "개선 후 가능성" : "Likelihood after the control"}</span>${select(
            "residual",
            MATRIX.likelihoodLevels,
            likelihoodLabel,
            row.residual.likelihood,
          )}${setByNote(row.residual.likelihoodBy, row.residual.likelihoodSuggested, lang)}<div>${lang === "ko" ? "개선 후 위험성" : "Residual risk"}: ${row.residual.likelihood} × ${row.residual.severity} = ${row.residual.score} · ${escapeHtml(row.residual.level[lang])}</div></div>`
        : "";
      const assumptions = row.assumptions.length
        ? `<details><summary>${lang === "ko" ? "가정과 근거" : "Assumptions and evidence"}</summary><ul>${row.assumptions
            .map((a) => `<li>${escapeHtml(a[lang])}</li>`)
            .join("")}</ul><p class="tiny">${escapeHtml(row.evidence.join(" · "))}</p></details>`
        : "";
      return `<article class="risk-card ${levelClass(row.risk?.score)}">
        <header><span class="no">${i + 1}</span><h3>${escapeHtml(row.hazard[lang])}</h3>${
          row.risk ? `<span class="score">${row.risk.score}</span>` : ""
        }</header>
        ${shots}
        <p>${escapeHtml(row.currentState[lang])}</p>
        <ul class="facts">${measurements}</ul>
        <div class="grades">${likelihood}${severity}</div>
        ${row.risk ? `<div class="risk-line">${lang === "ko" ? "위험성" : "Risk"}: ${row.risk.score} · ${escapeHtml(row.risk.level[lang])}</div>` : ""}
        ${compare}
        <h4>${lang === "ko" ? "감소대책" : "Controls"}</h4><ol>${controls}</ol>
        ${residual}
        ${assumptions}
      </article>`;
    })
    .join("");
  host.innerHTML = `<p class="summary">${escapeHtml(table.summary[lang])}</p>${cards}<p class="tiny">${escapeHtml(
    table.models.join(", "),
  )}</p>`;
}

function download(name: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadCsv(table: AssessmentTable, lang: Lang): void {
  download(`risk-assessment-${table.createdAt}-${lang}.csv`, "text/csv;charset=utf-8", toCsv(table, lang));
}

export function openPrintable(table: AssessmentTable, lang: Lang): void {
  const html = toPrintableHtml(table, lang);
  const win = window.open("", "_blank");
  if (win) {
    win.document.open();
    win.document.write(html);
    win.document.close();
  } else {
    download(`risk-assessment-${table.createdAt}-${lang}.html`, "text/html;charset=utf-8", html);
  }
}

export function downloadText(name: string, mime: string, content: string): void {
  download(name, mime, content);
}
