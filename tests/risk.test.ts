import { describe, expect, it } from "vitest";
import {
  dropEnergy,
  ladderCheck,
  ladderReferenceDeg,
  marginLikelihood,
  moveTarget,
  riskRating,
  severityGrade,
} from "../src/risk/assess.js";
import { formatField, formatLength, formatPercent } from "../src/risk/format.js";
import { setGrade, toCsv, toPrintableHtml, type AssessmentTable } from "../src/risk/table.js";

describe("likelihood suggested by the measured margin", () => {
  it("reads the lower 5% of the margin against the band edges", () => {
    expect(marginLikelihood(-0.002).grade).toBe(5);
    expect(marginLikelihood(0).grade).toBe(5);
    expect(marginLikelihood(0.005).grade).toBe(4);
    expect(marginLikelihood(0.0099).grade).toBe(4);
    expect(marginLikelihood(0.01).grade).toBe(3);
    expect(marginLikelihood(0.029).grade).toBe(3);
    expect(marginLikelihood(0.03).grade).toBe(2);
    expect(marginLikelihood(0.099).grade).toBe(2);
    expect(marginLikelihood(0.1).grade).toBe(1);
    expect(marginLikelihood(0.4).label.en).toBe("Rare");
    expect(() => marginLikelihood(Number.NaN)).toThrow();
  });

  it("plans the move from the lower 5% so the target holds despite measurement error", () => {
    const plan = moveTarget(0.024, 0.1);
    expect(plan.moveByM).toBeCloseTo(0.076, 12);
    expect(plan.residual.grade).toBe(1);
    const already = moveTarget(0.15, 0.1);
    expect(already.moveByM).toBe(0);
    expect(already.residual.grade).toBe(1);
    const small = moveTarget(-0.01, 0.03);
    expect(small.moveByM).toBeCloseTo(0.04, 12);
    expect(small.residual.grade).toBe(2);
    expect(() => moveTarget(0.02, 0.01)).toThrow();
    expect(() => moveTarget(0.02, 1)).toThrow();
  });
});

describe("drop, severity and risk", () => {
  it("computes v = sqrt(2gh) and E = mgh", () => {
    const drop = dropEnergy({ massLowKg: 0.3, massHighKg: 0.4, heightM: 0.75 });
    expect(drop.impactSpeedMps).toBeCloseTo(Math.sqrt(2 * 9.80665 * 0.75), 12);
    expect(drop.energyLowJ).toBeCloseTo(0.3 * 9.80665 * 0.75, 12);
    expect(drop.energyHighJ).toBeCloseTo(0.4 * 9.80665 * 0.75, 12);
    expect(() => dropEnergy({ massLowKg: 0.5, massHighKg: 0.4, heightM: 1 })).toThrow();
  });

  it("suggests severity by energy decade and steps up for sharp edges", () => {
    expect(severityGrade(0.4, false).band.grade).toBe(1);
    expect(severityGrade(1, false).band.grade).toBe(2);
    expect(severityGrade(9.9, false).band.grade).toBe(2);
    expect(severityGrade(10, false).band.grade).toBe(3);
    expect(severityGrade(99, false).band.grade).toBe(3);
    expect(severityGrade(100, false).band.grade).toBe(4);
    const sharp = severityGrade(2, true);
    expect(sharp.band.grade).toBe(3);
    expect(sharp.raisedForSharpness).toBe(true);
    expect(severityGrade(250, true).band.grade).toBe(4);
    expect(severityGrade(250, true).raisedForSharpness).toBe(false);
  });

  it("rates risk on the 5 x 4 matrix", () => {
    expect(riskRating(1, 1)).toMatchObject({ score: 1 });
    expect(riskRating(3, 2).score).toBe(6);
    expect(riskRating(3, 2).level.grade).toBe(2);
    expect(riskRating(5, 4).level.grade).toBe(3);
    expect(() => riskRating(6, 1)).toThrow();
    expect(() => riskRating(2.5, 1)).toThrow();
  });

  it("compares a leaning ladder with the quarter-length (4:1) rule", () => {
    // OSHA 1926.1053(b)(5)(i): base = working length / 4, so cos(angle) = 1/4.
    expect(ladderReferenceDeg()).toBeCloseTo((Math.acos(0.25) * 180) / Math.PI, 12);
    expect(ladderReferenceDeg()).toBeCloseTo(75.52, 2);
    expect(ladderCheck(75.5).verdict).toBe("ok");
    expect(ladderCheck(85).verdict).toBe("too_steep");
    expect(ladderCheck(62).verdict).toBe("too_shallow");
  });
});

describe("formatting and export", () => {
  it("formats by field name", () => {
    expect(formatField("d_m", 0.0213)).toBe("2.1 cm");
    expect(formatField("move_by_m", 0.004)).toBe("4.0 mm");
    expect(formatField("share_past_line", 0.383)).toBe("38%");
    expect(formatField("energy_high_J", 2.94)).toBe("2.94 J");
    expect(formatField("impact_speed_mps", 3.836)).toBe("3.84 m/s");
    expect(formatLength(1.5)).toBe("1.50 m");
    expect(formatPercent(0.0004)).toBe("<0.1%");
  });

  const table: AssessmentTable = {
    title: { en: "Risk assessment", ko: "위험성평가표" },
    place: "Test desk",
    createdAt: "2026-10-27",
    models: ["sam-3.1", "meta-models/muse-spark-open-1026"],
    summary: { en: "One hazard.", ko: "위험 하나." },
    rows: [
      {
        id: "h1",
        hazard: { en: "Mug near the edge, \"tea\"", ko: "가장자리 근처 머그컵" },
        currentState: { en: "On the desk", ko: "책상 위" },
        measurements: [{ label: { en: "Margin d", ko: "여유 d" }, value: "2.1 cm" }],
        likelihood: {
          grade: 4,
          label: { en: "Likely", ko: "높음" },
          basis: { en: "margin lower 5% 6.0 mm", ko: "여유 하위 5% 6.0 mm" },
          suggested: 4,
          by: "tool",
        },
        severity: {
          grade: 2,
          label: { en: "Medium", ko: "보통" },
          basis: { en: "E up to 2.94 J", ko: "에너지 최대 2.94 J" },
          suggested: 2,
          by: "tool",
        },
        risk: { score: 8, level: { en: "Medium (improve)", ko: "보통(개선 필요)" } },
        controls: [{ en: "Move it inward", ko: "안쪽으로 옮긴다" }],
        residual: {
          likelihood: 1,
          likelihoodSuggested: 1,
          likelihoodBy: "tool",
          severity: 2,
          score: 2,
          level: { en: "Low (acceptable, keep current controls)", ko: "낮음(허용 가능, 현 관리 유지)" },
        },
        evidence: ["call_1 tipover_margin"],
        assumptions: [],
      },
    ],
  };

  it("writes CSV with a BOM and quoted fields", () => {
    const csv = toCsv(table, "ko");
    expect(csv.startsWith("﻿번호,")).toBe(true);
    const en = toCsv(table, "en");
    expect(en).toContain('"Mug near the edge, ""tea"""');
  });

  it("writes a printable page with escaped text, the disclaimer and the suggestion rules", () => {
    const html = toPrintableHtml(table, "en");
    expect(html).toContain("&quot;tea&quot;");
    expect(html).toContain("makes the final judgment.");
    expect(html).toContain("lower 5% of the margin");
    expect(html).toContain("suggested, not yet confirmed");
    expect(html).not.toContain("EN 397");
  });

  it("lets the supervisor set grades and recomputes the risk", () => {
    const raised = setGrade(table, "h1", "likelihood", 5);
    expect(raised.rows[0].likelihood).toMatchObject({ grade: 5, suggested: 4, by: "supervisor" });
    expect(raised.rows[0].risk?.score).toBe(10);
    expect(raised.rows[0].risk?.level.en).toBe("High (improve now)");
    const severe = setGrade(raised, "h1", "severity", 3);
    expect(severe.rows[0].risk?.score).toBe(15);
    expect(severe.rows[0].residual).toMatchObject({ likelihood: 1, severity: 3, score: 3 });
    const residual = setGrade(severe, "h1", "residual", 2);
    expect(residual.rows[0].residual).toMatchObject({ likelihood: 2, likelihoodBy: "supervisor", score: 6 });
    const back = setGrade(residual, "h1", "likelihood", 4);
    expect(back.rows[0].likelihood?.by).toBe("tool");
    expect(table.rows[0].risk?.score).toBe(8);
    expect(toCsv(severe, "en")).toContain("set by supervisor, suggested 4");
    expect(toCsv(severe, "ko")).toContain("관리감독자가 정함, 제안 4");
    expect(() => setGrade(table, "h1", "severity", 5)).toThrow();
    expect(() => setGrade(table, "h1", "likelihood", 0)).toThrow();
  });
});
