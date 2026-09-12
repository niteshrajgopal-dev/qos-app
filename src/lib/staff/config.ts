import type { EnvSource } from "@/lib/env";

export type StaffAuthConfig = {
  secret: string;
  baseUrl: string;
  trustedOrigins: string[];
  googleClientId: string | null;
  googleClientSecret: string | null;
  microsoftClientId: string | null;
  microsoftClientSecret: string | null;
  sessionMaxAgeSeconds: number;
  invitationTtlSeconds: number;
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
    source.STAFF_AUTH_TRUSTED_RETURN_ORIGINS?.trim() ||
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

export function readStaffInvitationTtlSeconds(
  source: EnvSource = process.env,
): number {
  return parsePositiveInt(source.STAFF_INVITATION_TTL_SECONDS, 604_800);
}

export function readStaffAuthConfig(
  source: EnvSource = process.env,
): StaffAuthConfig {
  const secret =
    source.STAFF_BETTER_AUTH_SECRET?.trim() ||
    source.BETTER_AUTH_SECRET?.trim();

  if (!secret) {
    throw new Error(
      "STAFF_BETTER_AUTH_SECRET or BETTER_AUTH_SECRET is required for staff authentication.",
    );
  }

  const baseUrl =
    source.STAFF_BETTER_AUTH_URL?.trim() ||
    source.BETTER_AUTH_URL?.trim() ||
    source.NEXT_PUBLIC_APP_URL?.trim() ||
    "http://localhost:3000";

  return {
    secret,
    baseUrl,
    trustedOrigins: parseTrustedOrigins(source),
    googleClientId: source.STAFF_GOOGLE_CLIENT_ID?.trim() || source.GOOGLE_CLIENT_ID?.trim() || null,
    googleClientSecret:
      source.STAFF_GOOGLE_CLIENT_SECRET?.trim() ||
      source.GOOGLE_CLIENT_SECRET?.trim() ||
      null,
    microsoftClientId:
      source.STAFF_MICROSOFT_CLIENT_ID?.trim() ||
      source.MICROSOFT_CLIENT_ID?.trim() ||
      null,
    microsoftClientSecret:
      source.STAFF_MICROSOFT_CLIENT_SECRET?.trim() ||
      source.MICROSOFT_CLIENT_SECRET?.trim() ||
      null,
    sessionMaxAgeSeconds: parsePositiveInt(
      source.STAFF_SESSION_MAX_AGE_SECONDS,
      604_800,
    ),
    invitationTtlSeconds: readStaffInvitationTtlSeconds(source),
  };
}
