const SECRET_PATTERN = /\bsk-[A-Za-z0-9_-]{8,}\b/g;

/** Removes OpenAI-style key material from strings destined for logs or errors. */
export function redactOpenAiSecrets(value: string) {
  return value.replace(SECRET_PATTERN, "[redacted]");
}

export function redactOpenAiSecretsDeep<T>(value: T): T {
  if (typeof value === "string") {
    return redactOpenAiSecrets(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactOpenAiSecretsDeep(entry)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = redactOpenAiSecretsDeep(entry);
    }
    return out as T;
  }
  return value;
}
