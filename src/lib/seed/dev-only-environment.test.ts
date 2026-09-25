import { describe, expect, it } from "vitest";

import {
  assertDevOnlySeedTarget,
  DevOnlySeedError,
} from "@/lib/seed/dev-only-environment";

describe("DEV-only seed target", () => {
  it("allows an explicit development environment and the dev database", () => {
    expect(
      assertDevOnlySeedTarget({
        QOS_ENVIRONMENT: "dev",
        DATABASE_URL:
          "postgresql://qos_app:secret@psql-qos-dev.postgres.database.azure.com:5432/qos_db",
        NODE_ENV: "production",
      }),
    ).toBe("dev");

    expect(
      assertDevOnlySeedTarget({
        DATABASE_URL: "postgresql://qos:qos@localhost:5432/qos",
      }),
    ).toBe("dev");

    expect(
      assertDevOnlySeedTarget({
        QOS_ENVIRONMENT: "test",
        DATABASE_URL: "postgresql://qos:qos@localhost:5432/qos",
      }),
    ).toBe("test");
  });

  it("refuses staging and production even when another variable looks like dev", () => {
    expect(() =>
      assertDevOnlySeedTarget({
        QOS_ENVIRONMENT: "staging",
        DATABASE_URL: "postgresql://qos:qos@localhost:5432/qos",
      }),
    ).toThrow(DevOnlySeedError);

    expect(() =>
      assertDevOnlySeedTarget({
        QOS_ENVIRONMENT: "production",
      }),
    ).toThrow(DevOnlySeedError);

    expect(() =>
      assertDevOnlySeedTarget({
        QOS_ENVIRONMENT: "dev",
        DATABASE_URL:
          "postgresql://qos_app:secret@psql-qos-prod.postgres.database.azure.com:5432/qos_db",
        BETTER_AUTH_URL: "https://quotes.dev.qosapp.com",
      }),
    ).toThrow(/staging or production/);

    expect(() =>
      assertDevOnlySeedTarget({
        CONTAINER_APP_NAME: "ca-qos-stg-api",
        DATABASE_URL: "postgresql://qos:qos@localhost:5432/qos",
      }),
    ).toThrow(DevOnlySeedError);
  });

  it("refuses an unknown remote database", () => {
    expect(() =>
      assertDevOnlySeedTarget({
        DATABASE_URL: "postgresql://qos:qos@psql-qos-shared.example.com:5432/qos_db",
      }),
    ).toThrow(/not DEV/);
  });
});
