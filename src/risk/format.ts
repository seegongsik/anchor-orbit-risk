/** Formats a tool result field for people, choosing the unit from the field name. */
export function formatField(field: string, value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (field.startsWith("p_") || field.startsWith("share_") || field.endsWith("_probability")) return formatPercent(value);
  if (field.endsWith("_mps")) return `${value.toFixed(2)} m/s`;
  if (field.endsWith("_deg")) return `${value.toFixed(1)}°`;
  if (field.endsWith("_kg")) return `${value.toFixed(2)} kg`;
  if (field.endsWith("_days")) return `${Math.round(value)} days`;
  if (field.endsWith("_J")) return `${value < 10 ? value.toFixed(2) : value.toFixed(1)} J`;
  if (field.endsWith("_m")) return formatLength(value);
  if (field === "grade" || field.endsWith("_grade") || field === "score") return String(Math.round(value));
  return Number(value.toPrecision(3)).toString();
}

export function formatLength(metres: number): string {
  const abs = Math.abs(metres);
  if (abs < 0.01) return `${(metres * 1000).toFixed(1)} mm`;
  if (abs < 1) return `${(metres * 100).toFixed(1)} cm`;
  return `${metres.toFixed(2)} m`;
}

export function formatPercent(p: number): string {
  if (p <= 0) return "0%";
  if (p >= 1) return "100%";
  if (p < 0.001) return "<0.1%";
  if (p > 0.999) return ">99.9%";
  const pct = p * 100;
  return `${pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}%`;
}
