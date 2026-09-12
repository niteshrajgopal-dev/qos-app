import type { StorefrontReleasePayload } from "@/db/schema";

export const STOREFRONT_MANIFEST_CONTRACT_VERSION = 1;

export const SUPPORTED_STOREFRONT_MANIFEST_CONTRACT_VERSIONS = [
  STOREFRONT_MANIFEST_CONTRACT_VERSION,
] as const;

export type StorefrontManifestLocation = {
  locationPublicId: string;
  slug: string;
  name: string;
};

export type StorefrontManifestPublishedCollection = {
  locationPublicId: string;
  menuPublicId: string;
  publicMenuKey: string | null;
};

export type StorefrontManifestFeatures = {
  localeSelector: boolean;
};

export type StorefrontManifestResponse = {
  contractVersion: typeof STOREFRONT_MANIFEST_CONTRACT_VERSION;
  storefrontPublicId: string;
  releasePublicId: string;
  releaseVersion: number;
  tenantPublicId: string;
  brand: {
    publicId: string;
    name: string;
  };
  primaryHostname: string;
  defaultLocale: string;
  supportedLocales: string[];
  theme: Record<string, unknown>;
  navigation: NonNullable<StorefrontReleasePayload["navigation"]>;
  contentBlocks: NonNullable<StorefrontReleasePayload["contentBlocks"]>;
  locations: StorefrontManifestLocation[];
  publishedCollections: StorefrontManifestPublishedCollection[];
  features: StorefrontManifestFeatures;
};

export class StorefrontManifestContractError extends Error {
  readonly statusCode: number;
  readonly field?: string;
  readonly supportedContractVersions: readonly number[];

  constructor(
    message: string,
    statusCode = 400,
    field?: string,
    supportedContractVersions: readonly number[] = SUPPORTED_STOREFRONT_MANIFEST_CONTRACT_VERSIONS,
  ) {
    super(message);
    this.name = "StorefrontManifestContractError";
    this.statusCode = statusCode;
    this.field = field;
    this.supportedContractVersions = supportedContractVersions;
  }
}

export function parseStorefrontManifestContractVersion(
  value: string | null,
): typeof STOREFRONT_MANIFEST_CONTRACT_VERSION {
  if (value === null || value.trim() === "") {
    throw new StorefrontManifestContractError(
      "contractVersion query parameter is required.",
      400,
      "contractVersion",
    );
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new StorefrontManifestContractError(
      "contractVersion must be an integer.",
      400,
      "contractVersion",
    );
  }

  if (
    !SUPPORTED_STOREFRONT_MANIFEST_CONTRACT_VERSIONS.includes(
      parsed as (typeof SUPPORTED_STOREFRONT_MANIFEST_CONTRACT_VERSIONS)[number],
    )
  ) {
    throw new StorefrontManifestContractError(
      `Unsupported storefront manifest contract version ${parsed}.`,
      406,
      "contractVersion",
    );
  }

  return parsed as typeof STOREFRONT_MANIFEST_CONTRACT_VERSION;
}

export function toStorefrontManifestResponse(input: {
  releasePublicId: string;
  tenantPublicId: string;
  brand: {
    publicId: string;
    name: string;
  };
  primaryHostname: string;
  payload: StorefrontReleasePayload;
  locations: StorefrontManifestLocation[];
}): StorefrontManifestResponse {
  return {
    contractVersion: STOREFRONT_MANIFEST_CONTRACT_VERSION,
    storefrontPublicId: input.payload.storefrontPublicId,
    releasePublicId: input.releasePublicId,
    releaseVersion: input.payload.releaseVersion,
    tenantPublicId: input.tenantPublicId,
    brand: input.brand,
    primaryHostname: input.primaryHostname,
    defaultLocale: input.payload.defaultLocale,
    supportedLocales: input.payload.supportedLocales,
    theme: input.payload.theme,
    navigation: input.payload.navigation ?? [],
    contentBlocks: input.payload.contentBlocks ?? [],
    locations: input.locations,
    publishedCollections: (input.payload.publishedCollections ?? []).map(
      (collection) => ({
        locationPublicId: collection.locationPublicId,
        menuPublicId: collection.menuPublicId,
        publicMenuKey: collection.publicMenuKey ?? null,
      }),
    ),
    features: {
      localeSelector: input.payload.featureFlags?.localeSelector ?? true,
    },
  };
}

export function assertStorefrontManifestIsAllowlisted(
  manifest: StorefrontManifestResponse,
) {
  const serialized = JSON.stringify(manifest);
  const forbiddenPatterns = [
    /\binternalname\b/i,
    /\bstaff\b/i,
    /\brecipe\b/i,
    /\bsupplier\b/i,
    /\bcost\b/i,
    /\bdraft\b/i,
    /\bblob\b/i,
    /\bcredential\b/i,
    /\btenantid\b/i,
    /\bpublishedbysubject\b/i,
    /\bbrandid\b/i,
    /\borganizationid\b/i,
    /\bamountminor\b/i,
    /\b"price"\s*:/i,
  ];

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(serialized)) {
      throw new Error(
        `Storefront manifest leaked forbidden field: ${pattern.source}`,
      );
    }
  }
}
