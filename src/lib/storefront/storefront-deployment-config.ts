import type { EnvSource } from "@/lib/env";

export type StorefrontDeploymentRuntimeConfig = {
  boundStorefrontPublicId: string | null;
};

export function readStorefrontDeploymentRuntimeConfig(
  source: EnvSource = process.env,
): StorefrontDeploymentRuntimeConfig {
  const boundStorefrontPublicId =
    source.QOS_STOREFRONT_PUBLIC_ID?.trim() || null;

  return { boundStorefrontPublicId };
}

export function isStorefrontDeploymentBound(
  config: StorefrontDeploymentRuntimeConfig = readStorefrontDeploymentRuntimeConfig(),
) {
  return config.boundStorefrontPublicId !== null;
}
