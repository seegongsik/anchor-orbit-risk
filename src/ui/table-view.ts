/** Phone-friendly view of the assessment table, plus exports. */
import type { Lang } from "../risk/config.js";
import { escapeHtml, toCsv, toPrintableHtml, type AssessmentTable } from "../risk/table.js";

function levelClass(score: number | undefined): string {
  if (score === undefined) return "";
  if (score >= 10) return "lvl-high";
  if (score >= 5) return "lvl-mid";
  return "lvl-low";
}

export function renderTable(
  host: HTMLElement,
  table: AssessmentTable,
  lang: Lang,
  previous: AssessmentTable | null,
): void {
  const before = new Map((previous?.rows ?? []).map((r) => [r.id, r]));
  const cards = table.rows
    .map((row, i) => {
      const prior = before.get(row.id);
      const compare =
        prior?.risk && row.risk
          ? `<div class="compare">${lang === "ko" ? "이전" : "Before"} ${prior.risk.score} → ${lang === "ko" ? "지금" : "now"} ${row.risk.score}</div>`
          : "";
      const measurements = row.measurements
        .map((m) => `<li><span>${escapeHtml(m.label[lang])}</span><b>${escapeHtml(m.value)}</b></li>`)
        .join("");
      const graded = (title: string, g: AssessmentTable["rows"][number]["likelihood"]) =>
        g
          ? `<div class="grade"><span>${title}</span><b>${g.grade}</b> ${escapeHtml(g.label[lang])}<small>${escapeHtml(g.basis[lang])}</small></div>`
          : `<div class="grade"><span>${title}</span><b>–</b>${lang === "ko" ? "측정 안 함" : "not measured"}</div>`;
      const controls = row.controls.map((c) => `<li>${escapeHtml(c[lang])}</li>`).join("");
      const residual = row.residual
        ? `<div class="residual ${levelClass(row.residual.score)}">${lang === "ko" ? "개선 후" : "After control"}: ${row.residual.likelihood} × ${row.residual.severity} = ${row.residual.score} · ${escapeHtml(row.residual.level[lang])}</div>`
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
        <p>${escapeHtml(row.currentState[lang])}</p>
        <ul class="facts">${measurements}</ul>
        <div class="grades">${graded(lang === "ko" ? "가능성" : "Likelihood", row.likelihood)}${graded(
          lang === "ko" ? "중대성" : "Severity",
          row.severity,
        )}</div>
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
