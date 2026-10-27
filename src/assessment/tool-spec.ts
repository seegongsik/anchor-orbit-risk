/** OpenAI-style function tool description, shared by the browser and the server. */
export type ToolSpec = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};
