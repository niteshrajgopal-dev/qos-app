import { describe, expect, it } from "vitest";

import { readStaffAuthConfig } from "@/lib/staff/config";

const secret = "test-better-auth-secret-with-enough-length";

describe("readStaffAuthConfig", () => {
  it("trusts the staff base URL even when customer Better Auth URL is set", () => {
    const config = readStaffAuthConfig({
      BETTER_AUTH_SECRET: secret,
      BETTER_AUTH_URL: "https://quotes.dev.qosapp.com",
      STAFF_BETTER_AUTH_URL:
        "https://ca-qos-dev-api.gentleplant-cc8574e8.uaenorth.azurecontainerapps.io",
    });

    expect(config.baseUrl).toBe(
      "https://ca-qos-dev-api.gentleplant-cc8574e8.uaenorth.azurecontainerapps.io",
    );
    expect(config.trustedOrigins).toEqual([
      "https://ca-qos-dev-api.gentleplant-cc8574e8.uaenorth.azurecontainerapps.io",
    ]);
  });

  it("falls back to the shared Better Auth URL when no staff URL is set", () => {
    const config = readStaffAuthConfig({
      BETTER_AUTH_SECRET: secret,
      BETTER_AUTH_URL: "https://quotes.dev.qosapp.com",
    });

    expect(config.baseUrl).toBe("https://quotes.dev.qosapp.com");
    expect(config.trustedOrigins).toContain("https://quotes.dev.qosapp.com");
  });
});
