import { sql } from "drizzle-orm";

import type { DbClient } from "@/db/client";

export async function ensureStaffIdentityRecord(
  db: DbClient,
  providerSubject: string,
  email: string,
) {
  const normalizedEmail = email.trim().toLowerCase();

  const rows = await db.execute<{
    id: string;
    providerSubject: string;
    email: string;
    createdAt: Date;
  }>(sql`
    SELECT
      identity_id AS "id",
      identity_subject AS "providerSubject",
      identity_email AS "email",
      identity_created_at AS "createdAt"
    FROM qos.ensure_staff_identity(${providerSubject}, ${normalizedEmail})
  `);

  const [identity] = Array.isArray(rows) ? rows : [];
  if (!identity) {
    throw new Error("Unable to resolve staff identity.");
  }

  return identity;
}
