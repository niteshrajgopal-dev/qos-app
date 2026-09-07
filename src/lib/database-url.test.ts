import { describe, expect, it } from "vitest";

import { buildDatabaseUrl } from "./database-url";

describe("buildDatabaseUrl", () => {
  it("prefers DATABASE_URL when present", () => {
    expect(
      buildDatabaseUrl({
        DATABASE_URL: "postgresql://qos:qos@localhost:5432/qos",
        DB_HOST: "ignored",
      }),
    ).toBe("postgresql://qos:qos@localhost:5432/qos");
  });

  it("builds an SSL URL from discrete Azure variables", () => {
    expect(
      buildDatabaseUrl({
        DB_HOST: "psql.example",
        DB_NAME: "qos",
        DB_USER: "qos admin",
        DB_PASSWORD: "p@ss/word",
      }),
    ).toBe(
      "postgresql://qos%20admin:p%40ss%2Fword@psql.example:5432/qos?sslmode=require",
    );
  });

  it("throws when neither DATABASE_URL nor discrete fields are set", () => {
    expect(() => buildDatabaseUrl({})).toThrow(
      "Database configuration missing. Set DATABASE_URL or DB_HOST, DB_NAME, DB_USER, and DB_PASSWORD.",
    );
  });
});
