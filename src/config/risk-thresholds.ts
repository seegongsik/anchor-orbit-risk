/**
 * Likelihood × severity thresholds for later (10/31–11/1).
 * Values without a found source are marked assumption. Do not invent citations.
 */
export const RISK_MATRIX = {
  likelihoodLevels: 5,
  severityLevels: 4,
  note: "Matrix size is configurable. Numeric cutovers: 확인 필요.",
} as const;

export const SEVERITY_NOTES = {
  energy: "E = m·g·h. Band edges: 확인 필요.",
  speed: "v = √(2gh). Band edges: 확인 필요.",
  sharpness: "Sharp-edge-down is a qualitative flag until a source exists.",
  landing: "Foot vs head height bands: 확인 필요.",
} as const;
