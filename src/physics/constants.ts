/** Standard acceleration of gravity (ISO 80000-3 / CGPM standard gravity), m/s². */
export const STANDARD_G = 9.80665;

/** ISO 216 A4 long side, metres. */
export const A4_LONG_SIDE_M = 0.297;

/** ISO/IEC 7810 ID-1 identification card width (long side), metres. */
export const CREDIT_CARD_LONG_SIDE_M = 0.0856;

/**
 * Default drop height from the product brief.
 * Assumption — not a measured desk height.
 */
export const DEFAULT_DROP_HEIGHT_M = 0.75;

export const MONTE_CARLO_ITERATIONS = 1000;
export const MONTE_CARLO_SEED = 20261027;

/**
 * Portable-ladder 4:1 comparison used in the brief (≈75° from horizontal).
 * Workplace-rule source: 확인 필요.
 */
export const LADDER_RISE_RUN = { rise: 4, run: 1 } as const;

/** Residual / radius above which an arc fit is labeled "not rotation". Assumption. */
export const ROTATION_RESIDUAL_FRACTION_ASSUMPTION = 0.05;
