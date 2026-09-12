import type { EnvSource } from "@/lib/env";

export type StorefrontEdgeConfig = {
  azureFrontDoorId: string | null;
  trustForwardedHost: boolean;
  allowDevHostPort: boolean;
};

function parseBoolean(value: string | undefined, defaultValue: boolean) {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  return value.trim().toLowerCase() === "true";
}

export function readStorefrontEdgeConfig(
  source: EnvSource = process.env,
): StorefrontEdgeConfig {
  const nodeEnv = source.NODE_ENV ?? "development";

  return {
    azureFrontDoorId: source.QOS_AZURE_FRONT_DOOR_ID?.trim() || null,
    trustForwardedHost: parseBoolean(source.QOS_TRUST_FORWARDED_HOST, false),
    allowDevHostPort: parseBoolean(
      source.QOS_ALLOW_DEV_HOST_PORT,
      nodeEnv !== "production",
    ),
  };
}
