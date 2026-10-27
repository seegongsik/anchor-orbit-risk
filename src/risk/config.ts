/**
 * Risk assessment settings. Every number here is either sourced (with the
 * source written next to it) or marked as an assumption that the supervisor can
 * change. Nothing here is a legal limit, and no grade here is a prediction of an
 * accident or an injury: the tools suggest grades from measured geometry and
 * energy, and the supervisor sets them.
 */

export type Lang = "en" | "ko";
export type Text = Record<Lang, string>;

export type Band = {
  grade: number;
  /** Lower bound, inclusive. */
  from: number;
  label: Text;
};

export const LIKELIHOOD_LABELS: Record<number, Text> = {
  1: { en: "Rare", ko: "거의 없음" },
  2: { en: "Unlikely", ko: "낮음" },
  3: { en: "Possible", ko: "보통" },
  4: { en: "Likely", ko: "높음" },
  5: { en: "Almost certain", ko: "매우 높음" },
};

/**
 * Suggested likelihood from the measured margin. The rule reads the lower 5%
 * of the margin, so measurement error counts against the object: the less it
 * has to slide before its centre of mass passes the edge line, the smaller the
 * bump that puts it over. Grade 5 means it may already be past the line within
 * measurement error. The edges (metres) are assumptions; how often the spot is
 * touched is for the supervisor to judge.
 */
export const MARGIN_LIKELIHOOD_EDGES_M = [
  { grade: 5, upTo: 0, inclusive: true },
  { grade: 4, upTo: 0.01, inclusive: false },
  { grade: 3, upTo: 0.03, inclusive: false },
  { grade: 2, upTo: 0.1, inclusive: false },
] as const;
export const MARGIN_LIKELIHOOD_REST_GRADE = 1;

/** Default control target: move the object until the lower 5% of its margin is 10 cm. Assumption. */
export const CONTROL_TARGET_MARGIN_M = 0.1;
export const CONTROL_TARGET_RANGE_M = { min: 0.03, max: 0.3 } as const;

/**
 * Suggested severity from the impact energy E = m·g·h, one grade per tenfold
 * step in energy. The decade edges are assumptions. They describe how much
 * energy a fall releases, not what it would do to a person: the supervisor
 * judges that, knowing who and what is below.
 */
export const SEVERITY_BANDS: Band[] = [
  { grade: 1, from: 0, label: { en: "Low", ko: "낮음" } },
  { grade: 2, from: 1, label: { en: "Medium", ko: "보통" } },
  { grade: 3, from: 10, label: { en: "High", ko: "높음" } },
  { grade: 4, from: 100, label: { en: "Very high", ko: "매우 높음" } },
];

/** Sharp edge or point facing down raises the suggested severity by one grade. Assumption. */
export const SHARP_DOWN_SEVERITY_STEP = 1;

/** Risk level from the score L × S on the 5 × 4 matrix. Assumption. */
export const RISK_LEVELS: Band[] = [
  { grade: 1, from: 1, label: { en: "Low (acceptable, keep current controls)", ko: "낮음(허용 가능, 현 관리 유지)" } },
  { grade: 2, from: 5, label: { en: "Medium (improve)", ko: "보통(개선 필요)" } },
  { grade: 3, from: 10, label: { en: "High (improve now)", ko: "높음(즉시 개선)" } },
];

export const MATRIX = { likelihoodLevels: 5, severityLevels: 4 } as const;

/** Default drop height when none is measured. Assumption (a common desk height). */
export const DEFAULT_DROP_HEIGHT = { valueM: 0.75, rangeM: 0.05 } as const;

/**
 * Leaning (non-self-supporting) ladders: the foot sits about one quarter of the
 * working length (the length along the ladder from the foot to the top support)
 * out from the support, so cos(angle from the ground) = 1/4, about 75.5°.
 */
export const LADDER_REFERENCE = {
  baseToWorkingLength: 0.25,
  toleranceDeg: 5,
  source:
    "OSHA 29 CFR 1926.1053(b)(5)(i): horizontal distance from the top support to the foot about one-quarter of the working length",
  appliesTo: {
    en: "Leaning (non-self-supporting) ladders only, photographed from the side.",
    ko: "기대어 세우는 사다리(자립형 아님)에만, 옆에서 찍은 사진으로.",
  },
  toleranceNote: {
    en: "The ±5° tolerance is an assumption.",
    ko: "±5° 허용 폭은 가정입니다.",
  },
} as const;

/** Phone pitch beyond which the photo is not a side view. Assumption. */
export const SIDE_VIEW_MAX_PITCH_DEG = 15;

export const LEGAL_CONTEXT = {
  en: "South Korea requires every employer to carry out risk assessments: find hazards, judge whether the risk is acceptable, take and carry out measures, involve workers and keep records (Occupational Safety and Health Act, Article 36; Enforcement Rule Article 37; Ministry of Employment and Labor Notice 2023-19). This tool supports that work; it does not complete it.",
  ko: "산업안전보건법 제36조는 사업주에게 위험성평가를 의무로 정한다. 유해·위험요인을 찾고, 위험성이 허용 가능한지 판단하고, 감소대책을 세워 실행하고, 근로자를 참여시키고, 결과를 기록·보존해야 한다(시행규칙 제37조, 고용노동부고시 제2023-19호 「사업장 위험성평가에 관한 지침」). 이 도구는 그 일을 돕는다. 대신하지는 않는다.",
} as const;

export const DISCLAIMER: Text = {
  en: "This tool helps a supervisor assess risk. Grades are suggestions from measured geometry and energy; the supervisor sets them and makes the final judgment. It gives no medical advice and does not identify people.",
  ko: "이 도구는 관리감독자의 위험성평가를 돕습니다. 등급은 측정한 기하와 에너지에서 나온 제안이며, 등급을 정하고 최종 판단을 하는 사람은 관리감독자입니다. 의료 조언을 하지 않으며 사람을 식별하지 않습니다.",
};

export function bandFor(bands: Band[], value: number): Band {
  let chosen = bands[0];
  for (const band of bands) if (value >= band.from) chosen = band;
  return chosen;
}
