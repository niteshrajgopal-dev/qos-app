import { afterEach, describe, expect, it, vi } from "vitest";

describe("integration database gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("runs integration suites in CI and prefers TEST_DATABASE_URL", async () => {
    vi.stubEnv("CI", "true");
    vi.stubEnv("TEST_DATABASE_URL", "postgresql://qos:qos@postgres:5432/qos");
    vi.stubEnv("DATABASE_URL", "postgresql://qos:qos@localhost:5432/qos");

    const { getIntegrationDatabaseUrl, hasIntegrationDatabase } = await import(
      "@/db/test-utils"
    );

    expect(getIntegrationDatabaseUrl()).toBe("postgresql://qos:qos@postgres:5432/qos");
    expect(hasIntegrationDatabase()).toBe(true);
  });
});
