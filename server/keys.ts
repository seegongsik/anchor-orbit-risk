export type EnvMap = Record<string, string | undefined>;

/** Official name first, then the repo alias. */
export function resolveModelApiKey(env: EnvMap = process.env): string | undefined {
  return env.MODEL_API_KEY ?? env.META_API_KEY;
}

export function resolveBasetenApiKey(env: EnvMap = process.env): string | undefined {
  return env.BASETEN_API_KEY;
}

export function keyPresence(env: EnvMap = process.env): {
  modelApiKeyConfigured: boolean;
  basetenApiKeyConfigured: boolean;
} {
  const model = resolveModelApiKey(env);
  const baseten = resolveBasetenApiKey(env);
  return {
    modelApiKeyConfigured: typeof model === "string" && model.length > 0,
    basetenApiKeyConfigured: typeof baseten === "string" && baseten.length > 0,
  };
}
