import type { EnvSource } from "@/lib/env";

export function readAdminDatabaseUrl(source: EnvSource = process.env): string {
  const adminUrl = source.DATABASE_ADMIN_URL?.trim();
  if (adminUrl) {
    return adminUrl;
  }

  throw new Error(
    "DATABASE_ADMIN_URL is required for administrative catalogue imports. Set it to a privileged Postgres URL such as qosadmin. Leave DATABASE_URL pointing at qos_app for the normal application.",
  );
}
