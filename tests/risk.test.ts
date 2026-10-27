import { describe, expect, it } from "vitest";
import {
  dropEnergy,
  fallProbability,
  fallProbabilityFromSamples,
  ladderCheck,
  likelihoodGrade,
  requiredMargin,
  riskRating,
  severityGrade,
} from "../src/risk/assess.js";
import { formatField, formatLength, formatPercent } from "../src/risk/format.js";
import { normalCdf, normalInv } from "../src/risk/stats.js";
import { toCsv, toPrintableHtml, type AssessmentTable } from "../src/risk/table.js";

describe("normal distribution", () => {
  it("matches tabulated values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6);
    expect(normalCdf(-3)).toBeCloseTo(0.0013499, 6);
    expect(normalInv(0.975)).toBeCloseTo(1.959964, 5);
    expect(normalInv(0.5)).toBeCloseTo(0, 7);
    expect(normalInv(0.001)).toBeCloseTo(-3.090232, 5);
    expect(normalInv(0.999999)).toBeCloseTo(4.753424, 4);
  });
});

describe("fall probability (reflected random walk)", () => {
  const nudges = { nudgesPerDay: 10, nudgeStdM: 0.005, horizonDays: 30 };

  it("is one at or past the edge and falls with the margin", () => {
    expect(fallProbability(0, nudges)).toBe(1);
    expect(fallProbability(-0.01, nudges)).toBe(1);
    const near = fallProbability(0.02, nudges);
    const far = fallProbability(0.2, nudges);
    expect(near).toBeGreaterThan(far);
    // spread = 0.005 * sqrt(300); d = 0.1 -> 2(1 - Phi(0.1/spread))
    const spread = 0.005 * Math.sqrt(300);
    expect(fallProbability(0.1, nudges)).toBeCloseTo(2 * (1 - normalCdf(0.1 / spread)), 12);
    expect(fallProbability(0.05, { ...nudges, nudgesPerDay: 0 })).toBe(0);
  });

  it("agrees with a direct simulation of the walk (synthetic)", () => {
    // Discrete Gaussian random walk, 300 steps, std 5 mm, start 6 cm from the edge.
    let state = 7;
    const rand = () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
    const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand());
    let fell = 0;
    const trials = 4000;
    for (let t = 0; t < trials; t += 1) {
      let x = 0;
      for (let s = 0; s < 300; s += 1) {
        x += gauss() * 0.005;
        if (x >= 0.06) {
          fell += 1;
          break;
        }
      }
    }
    const simulated = fell / trials;
    const model = fallProbability(0.06, nudges);
    // The continuous reflection formula slightly overstates a discrete walk.
    expect(model).toBeGreaterThan(simulated);
    expect(model - simulated).toBeLessThan(0.08);
  });

  it("averages over measurement samples and inverts to a required margin", () => {
    const samples = new Float64Array([0.05, 0.05, 0.05, 0.05]);
    expect(fallProbabilityFromSamples(samples, nudges)).toBeCloseTo(fallProbability(0.05, nudges), 12);
    const d = requiredMargin(0.01, nudges);
    expect(fallProbability(d, nudges)).toBeCloseTo(0.01, 5);
  });

  it("maps probabilities onto likelihood grades", () => {
    expect(likelihoodGrade(0.0001).grade).toBe(1);
    expect(likelihoodGrade(0.005).grade).toBe(2);
    expect(likelihoodGrade(0.05).grade).toBe(3);
    expect(likelihoodGrade(0.3).grade).toBe(4);
    expect(likelihoodGrade(0.9).grade).toBe(5);
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

  it("grades severity against the reference energies and steps up for sharp edges", () => {
    expect(severityGrade(2, false).band.grade).toBe(1);
    expect(severityGrade(20, false).band.grade).toBe(2);
    expect(severityGrade(60, false).band.grade).toBe(3);
    expect(severityGrade(250, false).band.grade).toBe(4);
    const sharp = severityGrade(2, true);
    expect(sharp.band.grade).toBe(2);
    expect(sharp.raisedForSharpness).toBe(true);
    expect(severityGrade(250, true).band.grade).toBe(4);
  });

  it("rates risk on the 5 x 4 matrix", () => {
    expect(riskRating(1, 1)).toMatchObject({ score: 1 });
    expect(riskRating(3, 2).score).toBe(6);
    expect(riskRating(3, 2).level.grade).toBe(2);
    expect(riskRating(5, 4).level.grade).toBe(3);
    expect(() => riskRating(6, 1)).toThrow();
    expect(() => riskRating(2.5, 1)).toThrow();
  });

  it("compares a ladder with the 4:1 rule", () => {
    expect(ladderCheck(75.5).verdict).toBe("ok");
    expect(ladderCheck(85).verdict).toBe("too_steep");
    expect(ladderCheck(62).verdict).toBe("too_shallow");
    expect(ladderCheck(75.5).referenceDeg).toBeCloseTo(75.96, 2);
  });
});

describe("formatting and export", () => {
  it("formats by field name", () => {
    expect(formatField("d_m", 0.0213)).toBe("2.1 cm");
    expect(formatField("move_by_m", 0.004)).toBe("4.0 mm");
    expect(formatField("p_fall", 0.383)).toBe("38%");
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
        likelihood: { grade: 4, label: { en: "Likely", ko: "높음" }, basis: { en: "P = 38%", ko: "P = 38%" } },
        severity: { grade: 1, label: { en: "Low", ko: "낮음" }, basis: { en: "E = 2.9 J", ko: "E = 2.9 J" } },
        risk: { score: 4, level: { en: "Low", ko: "낮음" } },
        controls: [{ en: "Move it inward", ko: "안쪽으로 옮긴다" }],
        residual: { likelihood: 1, severity: 1, score: 1, level: { en: "Low", ko: "낮음" } },
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

  it("writes a printable page with escaped text and the disclaimer", () => {
    const html = toPrintableHtml(table, "en");
    expect(html).toContain("&quot;tea&quot;");
    expect(html).toContain("The supervisor makes the final judgment.");
    expect(html).toContain("EN 397");
  });
});
