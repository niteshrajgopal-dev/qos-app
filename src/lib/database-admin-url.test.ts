import { describe, expect, it } from "vitest";

import { createAdminDbClient } from "@/db/client";
import { buildDatabaseUrl } from "@/lib/database-url";
import { readAdminDatabaseUrl } from "@/lib/database-admin-url";

describe("administrative database configuration", () => {
  it("reads DATABASE_ADMIN_URL without changing the application DATABASE_URL", () => {
    const source = {
      DATABASE_URL: "postgresql://qos_app:app-secret@localhost:5432/qos",
      DATABASE_ADMIN_URL:
        "postgresql://qosadmin:admin-secret@localhost:5432/qos",
    };

    expect(readAdminDatabaseUrl(source)).toBe(
      "postgresql://qosadmin:admin-secret@localhost:5432/qos",
    );
    expect(buildDatabaseUrl(source)).toBe(
      "postgresql://qos_app:app-secret@localhost:5432/qos",
    );
  });

  it("fails clearly when the privileged import URL is missing", () => {
    expect(() =>
      readAdminDatabaseUrl({
        DATABASE_URL: "postgresql://qos_app:app-secret@localhost:5432/qos",
      }),
    ).toThrow(/DATABASE_ADMIN_URL/);
    expect(() =>
      createAdminDbClient({
        DATABASE_URL: "postgresql://qos_app:app-secret@localhost:5432/qos",
      }),
    ).toThrow(/DATABASE_ADMIN_URL/);
    expect(() =>
      readAdminDatabaseUrl({
        DATABASE_URL: "postgresql://qos_app:app-secret@localhost:5432/qos",
      }),
    ).not.toThrow(/RLS|row-level|permission denied/i);
  });
});
