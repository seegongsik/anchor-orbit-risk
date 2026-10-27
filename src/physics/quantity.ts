export type QuantitySource =
  | "computed"
  | "assumption"
  | "measured"
  | "synthetic";

export type UncertaintyKind = "std" | "half_range" | "none";

export type Quantity = {
  value: number;
  uncertainty: number;
  uncertaintyKind: UncertaintyKind;
  unit: string;
  source: QuantitySource;
};

export function quantity(
  value: number,
  unit: string,
  extras?: Partial<Omit<Quantity, "value" | "unit">>,
): Quantity {
  return {
    value,
    uncertainty: extras?.uncertainty ?? 0,
    uncertaintyKind: extras?.uncertaintyKind ?? "none",
    unit,
    source: extras?.source ?? "computed",
  };
}
