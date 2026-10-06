const OPENAI_FUNCTION_NAME = /^[a-zA-Z0-9_-]+$/;

/** OpenAI function names cannot contain dots. QOS tool names stay dotted. */
export function openaiFunctionName(qosName: string) {
  return OPENAI_FUNCTION_NAME.test(qosName) ? qosName : qosName.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function aliasOpenAiToolNames(qosNames: readonly string[]) {
  const toProvider = new Map<string, string>();
  const fromProvider = new Map<string, string>();
  for (const name of qosNames) {
    const alias = openaiFunctionName(name);
    const existing = fromProvider.get(alias);
    if (existing && existing !== name) {
      throw new Error(`OpenAI tool aliases collided for ${existing} and ${name}.`);
    }
    toProvider.set(name, alias);
    fromProvider.set(alias, name);
  }
  return { toProvider, fromProvider };
}

export function qosToolNameFromOpenAi(providerName: string, aliases: ReturnType<typeof aliasOpenAiToolNames>) {
  return aliases.fromProvider.get(providerName) ?? providerName;
}
