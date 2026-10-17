import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  catalogueMenuExtractionPages,
  catalogueMenuExtractionSources,
} from "@/db/schema";
import { getMediaStorage } from "@/lib/media/storage";
import { withTenantContext } from "@/lib/tenant/context";

export async function loadMenuExtractionSource(
  db: DbClient,
  tenantId: string,
  sourcePublicId: string,
) {
  return withTenantContext(db, tenantId, async (tx) => {
    const [source] = await tx
      .select()
      .from(catalogueMenuExtractionSources)
      .where(
        and(
          eq(catalogueMenuExtractionSources.tenantId, tenantId),
          eq(catalogueMenuExtractionSources.publicId, sourcePublicId),
        ),
      )
      .limit(1);
    if (!source) {
      return null;
    }
    const pages = await tx
      .select()
      .from(catalogueMenuExtractionPages)
      .where(
        and(
          eq(catalogueMenuExtractionPages.tenantId, tenantId),
          eq(catalogueMenuExtractionPages.sourceId, source.id),
        ),
      );
    return { source, pages };
  });
}

export async function readMenuExtractionPageBytes(
  tenantId: string,
  storagePath: string,
) {
  const storage = getMediaStorage();
  return storage.readPrivate(storagePath);
}
