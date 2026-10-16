import { describe, expect, it } from "vitest";

import { describePostgresError, postgresErrorLogFields } from "@/lib/db/postgres-error";

describe("describePostgresError", () => {
  it("marks permission and schema errors as terminal", () => {
    expect(
      describePostgresError({
        code: "42501",
        message: "permission denied for table catalogue_menu_translations",
        table_name: "catalogue_menu_translations",
        schema_name: "qos",
      }),
    ).toMatchObject({
      sqlState: "42501",
      terminal: true,
      table: "catalogue_menu_translations",
      schema: "qos",
    });
    expect(describePostgresError({ code: "42703", column_name: "approval_status" })?.terminal).toBe(true);
    expect(describePostgresError({ code: "42P01", table_name: "missing" })?.terminal).toBe(true);
  });

  it("does not treat transient errors as terminal", () => {
    expect(describePostgresError({ code: "40001", message: "serialization failure" })?.terminal).toBe(false);
  });

  it("maps log fields without query text", () => {
    expect(
      postgresErrorLogFields({
        code: "42501",
        message: "permission denied",
        schema_name: "qos",
        table_name: "catalogue_menu_translations",
      }),
    ).toEqual({
      dbSqlState: "42501",
      dbMessage: "permission denied",
      dbSchema: "qos",
      dbTable: "catalogue_menu_translations",
    });
  });
});
