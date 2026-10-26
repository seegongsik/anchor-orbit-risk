export type MaskSource = "sam-3.1" | "manual" | "synthetic";

export type Evidence = {
  quantity: string;
  value: number;
  unit: string;
  tool: string;
  inputs: Record<string, unknown>;
  assumptions: string[];
  maskSource: MaskSource;
};
