/**
 * Risk assessment settings. Every number here is either sourced (with the
 * source written next to it) or marked as an assumption that the supervisor can
 * change. Nothing here is a legal limit.
 */

export type Lang = "en" | "ko";
export type Text = Record<Lang, string>;

export type Band = {
  grade: number;
  /** Lower bound, inclusive. */
  from: number;
  label: Text;
};

export type Reference = {
  label: Text;
  value: number;
  unit: string;
  source: string;
};

/** Likelihood grades from the probability of falling within the horizon. Assumption. */
export const LIKELIHOOD_BANDS: Band[] = [
  { grade: 1, from: 0, label: { en: "Rare", ko: "거의 없음" } },
  { grade: 2, from: 0.001, label: { en: "Unlikely", ko: "낮음" } },
  { grade: 3, from: 0.01, label: { en: "Possible", ko: "보통" } },
  { grade: 4, from: 0.1, label: { en: "Likely", ko: "높음" } },
  { grade: 5, from: 0.5, label: { en: "Almost certain", ko: "매우 높음" } },
];

/**
 * Severity grades from the impact energy E = m·g·h. The band edges are
 * assumptions, placed at the energies that two protective-equipment standards
 * test with, so the grade reads against something real. They are not injury
 * thresholds and say nothing medical.
 */
export const SEVERITY_BANDS: Band[] = [
  { grade: 1, from: 0, label: { en: "Low", ko: "낮음" } },
  { grade: 2, from: 5, label: { en: "Medium", ko: "보통" } },
  { grade: 3, from: 49, label: { en: "High", ko: "높음" } },
  { grade: 4, from: 200, label: { en: "Very high", ko: "매우 높음" } },
];

export const ENERGY_REFERENCES: Reference[] = [
  {
    label: {
      en: "Industrial helmet crown impact test (5 kg striker)",
      ko: "산업용 안전모 정수리 충격 시험(5 kg 추)",
    },
    value: 49,
    unit: "J",
    source: "EN 397 shock absorption test, 5 kg striker at 49 J (DGUV IFA project BIA 1045)",
  },
  {
    label: {
      en: "Safety footwear toe-cap impact test",
      ko: "안전화 앞코 충격 시험",
    },
    value: 200,
    unit: "J",
    source: "EN ISO 20345 toe-cap impact, 200 J",
  },
];

/** Sharp edge or point facing down raises severity by one grade. Assumption. */
export const SHARP_DOWN_SEVERITY_STEP = 1;

/** Risk level from the score L × S on the 5 × 4 matrix. Assumption. */
export const RISK_LEVELS: Band[] = [
  { grade: 1, from: 1, label: { en: "Low (acceptable, keep current controls)", ko: "낮음(허용 가능, 현 관리 유지)" } },
  { grade: 2, from: 5, label: { en: "Medium (improve)", ko: "보통(개선 필요)" } },
  { grade: 3, from: 10, label: { en: "High (improve now)", ko: "높음(즉시 개선)" } },
];

export const MATRIX = { likelihoodLevels: 5, severityLevels: 4 } as const;

/**
 * How often an object gets nudged, chosen by the supervisor for the place.
 * All three presets are assumptions, not measurements.
 */
export const NUDGE_PRESETS = [
  {
    id: "rare",
    label: { en: "Rarely touched (shelf, storage)", ko: "거의 안 건드림(선반, 보관)" },
    nudgesPerDay: 0.5,
    nudgeStdM: 0.003,
  },
  {
    id: "desk",
    label: { en: "Everyday desk", ko: "평소 쓰는 책상" },
    nudgesPerDay: 2,
    nudgeStdM: 0.003,
  },
  {
    id: "busy",
    label: { en: "Busy shared bench", ko: "여럿이 쓰는 작업대" },
    nudgesPerDay: 10,
    nudgeStdM: 0.005,
  },
] as const;

export type NudgePresetId = (typeof NUDGE_PRESETS)[number]["id"];

/** Default nudging assumptions for the fall model: the everyday desk preset over thirty days. */
export const DEFAULT_NUDGES = {
  nudgesPerDay: 2,
  nudgeStdM: 0.003,
  horizonDays: 30,
} as const;

/** Default drop height when none is measured. Assumption (a common desk height). */
export const DEFAULT_DROP_HEIGHT = { valueM: 0.75, rangeM: 0.05 } as const;

/**
 * Portable ladder set-up: base about one quarter of the working length away
 * from the support (4:1), about 75.5 degrees from the ground.
 */
export const LADDER_REFERENCE = {
  rise: 4,
  run: 1,
  toleranceDeg: 5,
  source: "OSHA 29 CFR 1926.1053(b)(5)(i): base about one-fourth of the working length from the support",
  toleranceNote: {
    en: "The ±5° tolerance is an assumption.",
    ko: "±5° 허용 폭은 가정입니다.",
  },
} as const;

export const LEGAL_CONTEXT = {
  en: "South Korea requires every employer to carry out a risk assessment and to keep its results (Occupational Safety and Health Act, Article 36; Enforcement Rule Article 37; Ministry of Employment and Labor Notice 2023-19).",
  ko: "산업안전보건법 제36조는 사업주에게 위험성평가와 그 결과의 기록·보존을 의무로 정한다(시행규칙 제37조, 고용노동부고시 제2023-19호 「사업장 위험성평가에 관한 지침」).",
} as const;

export const DISCLAIMER: Text = {
  en: "This tool helps a supervisor assess risk. The supervisor makes the final judgment. It gives no medical advice and does not identify people.",
  ko: "이 도구는 관리감독자의 위험성평가를 돕습니다. 최종 판단은 관리감독자가 합니다. 의료 조언을 하지 않으며 사람을 식별하지 않습니다.",
};

export function bandFor(bands: Band[], value: number): Band {
  let chosen = bands[0];
  for (const band of bands) if (value >= band.from) chosen = band;
  return chosen;
}
