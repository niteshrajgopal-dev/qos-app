import type { EnvSource } from "@/lib/env";

export type CustomerAuthConfig = {
  secret: string;
  baseUrl: string;
  trustedOrigins: string[];
  googleClientId: string | null;
  googleClientSecret: string | null;
  microsoftClientId: string | null;
  microsoftClientSecret: string | null;
  sessionMaxAgeSeconds: number;
};

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value?.trim()) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parseTrustedOrigins(source: EnvSource) {
  const raw =
    source.CUSTOMER_AUTH_TRUSTED_RETURN_ORIGINS?.trim() ||
    source.BETTER_AUTH_TRUSTED_ORIGINS?.trim() ||
    "";

  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function readCustomerAuthConfig(
  source: EnvSource = process.env,
): CustomerAuthConfig {
  const secret = source.BETTER_AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required for customer authentication.");
  }

  const baseUrl =
    source.BETTER_AUTH_URL?.trim() ||
    source.NEXT_PUBLIC_APP_URL?.trim() ||
    "http://localhost:3000";

  return {
    secret,
    baseUrl,
    trustedOrigins: parseTrustedOrigins(source),
    googleClientId: source.GOOGLE_CLIENT_ID?.trim() || null,
    googleClientSecret: source.GOOGLE_CLIENT_SECRET?.trim() || null,
    microsoftClientId: source.MICROSOFT_CLIENT_ID?.trim() || null,
    microsoftClientSecret: source.MICROSOFT_CLIENT_SECRET?.trim() || null,
    sessionMaxAgeSeconds: parsePositiveInt(
      source.CUSTOMER_SESSION_MAX_AGE_SECONDS,
      604_800,
    ),
  };
}
