import { eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { staffIdentities } from "@/db/schema";

export async function ensureStaffIdentityRecord(
  db: DbClient,
  providerSubject: string,
  email: string,
) {
  const normalizedEmail = email.trim().toLowerCase();

  const [existingBySubject] = await db
    .select()
    .from(staffIdentities)
    .where(eq(staffIdentities.providerSubject, providerSubject))
    .limit(1);

  if (existingBySubject) {
    if (existingBySubject.email.toLowerCase() !== normalizedEmail) {
      const [updated] = await db
        .update(staffIdentities)
        .set({ email: normalizedEmail })
        .where(eq(staffIdentities.id, existingBySubject.id))
        .returning();

      return updated;
    }

    return existingBySubject;
  }

  const [created] = await db
    .insert(staffIdentities)
    .values({
      providerSubject,
      email: normalizedEmail,
    })
    .returning();

  return created;
}
