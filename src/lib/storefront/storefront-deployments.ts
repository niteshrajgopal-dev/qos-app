import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { storefrontDeployments, storefronts } from "@/db/schema";
import { buildPublicId } from "@/lib/onboarding/validation";
import { withTenantContext } from "@/lib/tenant/context";

import { StorefrontError } from "./storefronts";

export type UpsertStorefrontDeploymentInput = {
  storefrontPublicId: string;
  environment: string;
  region: string;
  containerAppName: string;
  lifecycleStatus?: "provisioning" | "active" | "inactive";
  applicationVersion: string;
  imageRepository?: string;
  publicId?: string;
};

export async function upsertStorefrontDeployment(
  db: DbClient,
  tenantId: string,
  input: UpsertStorefrontDeploymentInput,
) {
  return withTenantContext(db, tenantId, async (tx) => {
    const [storefront] = await tx
      .select({ id: storefronts.id, publicId: storefronts.publicId })
      .from(storefronts)
      .where(
        and(
          eq(storefronts.tenantId, tenantId),
          eq(storefronts.publicId, input.storefrontPublicId),
        ),
      )
      .limit(1);

    if (!storefront) {
      throw new StorefrontError("Storefront not found.", 404, "storefrontPublicId");
    }

    const [existing] = await tx
      .select()
      .from(storefrontDeployments)
      .where(
        and(
          eq(storefrontDeployments.tenantId, tenantId),
          eq(storefrontDeployments.storefrontId, storefront.id),
          eq(storefrontDeployments.environment, input.environment),
        ),
      )
      .limit(1);

    const values = {
      tenantId,
      storefrontId: storefront.id,
      publicId:
        input.publicId ??
        existing?.publicId ??
        buildPublicId("sfd", `${input.environment}-${input.containerAppName}`),
      environment: input.environment,
      region: input.region,
      containerAppName: input.containerAppName,
      lifecycleStatus: input.lifecycleStatus ?? "active",
      applicationVersion: input.applicationVersion,
      imageRepository: input.imageRepository ?? "qos-storefront",
      updatedAt: new Date(),
    };

    if (existing) {
      const [updated] = await tx
        .update(storefrontDeployments)
        .set(values)
        .where(eq(storefrontDeployments.id, existing.id))
        .returning();

      return updated;
    }

    const [created] = await tx
      .insert(storefrontDeployments)
      .values(values)
      .returning();

    return created;
  });
}

export async function updateStorefrontDeploymentApplicationVersion(
  db: DbClient,
  tenantId: string,
  deploymentPublicId: string,
  applicationVersion: string,
) {
  return withTenantContext(db, tenantId, async (tx) => {
    const [updated] = await tx
      .update(storefrontDeployments)
      .set({
        applicationVersion,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(storefrontDeployments.tenantId, tenantId),
          eq(storefrontDeployments.publicId, deploymentPublicId),
        ),
      )
      .returning();

    if (!updated) {
      throw new StorefrontError("Storefront deployment not found.", 404);
    }

    return updated;
  });
}
