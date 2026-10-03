import { describe, expect, it } from "vitest";

import {
  AI_SPEND_PATHS,
  aiSpendReadiness,
  describeAiSpendPolicy,
  readAiSpendPolicy,
} from "@/lib/ai/spend/spend-policy";

const FULL_PHOTO_POLICY = {
  AI_SPEND_PLATFORM_CONCURRENCY: "4",
  AI_SPEND_PROVIDER_OPENAI_CONCURRENCY: "3",
  AI_SPEND_AI_PHOTO_ASYNC_ENABLED: "true",
  AI_SPEND_AI_PHOTO_ASYNC_MAX_UNITS_PER_RUN: "5",
  AI_SPEND_AI_PHOTO_ASYNC_TENANT_DAILY_UNITS: "10",
  AI_SPEND_AI_PHOTO_ASYNC_TENANT_MONTHLY_UNITS: "100",
  AI_SPEND_AI_PHOTO_ASYNC_TENANT_CONCURRENCY: "2",
  AI_SPEND_AI_PHOTO_ASYNC_PLATFORM_DAILY_UNITS: "50",
  AI_SPEND_AI_PHOTO_ASYNC_PLATFORM_MONTHLY_UNITS: "500",
  AI_SPEND_AI_PHOTO_ASYNC_UNSTARTED_EXPIRY_MS: "600000",
};

describe("AI spend policy", () => {
  it("has no defaults: with nothing configured every new paid path is disabled", () => {
    const policy = readAiSpendPolicy({});
    for (const path of AI_SPEND_PATHS) {
      const readiness = aiSpendReadiness(policy, path, "openai");
      expect(readiness.admissible).toBe(false);
      expect(readiness).toMatchObject({
        missing: expect.arrayContaining([
          expect.stringMatching(/_ENABLED$/),
          "AI_SPEND_PLATFORM_CONCURRENCY",
          "AI_SPEND_PROVIDER_OPENAI_CONCURRENCY",
        ]),
      });
    }
    expect(policy.platformConcurrency).toEqual({ status: "unset" });
  });

  it("admits a path only when it is enabled and every limit is set", () => {
    const ready = aiSpendReadiness(readAiSpendPolicy(FULL_PHOTO_POLICY), "ai_photo.async", "openai");
    expect(ready).toEqual({
      admissible: true,
      limits: {
        maxUnitsPerRun: 5,
        tenantDailyUnits: 10,
        tenantMonthlyUnits: 100,
        tenantConcurrency: 2,
        platformDailyUnits: 50,
        platformMonthlyUnits: 500,
        unstartedExpiryMs: 600_000,
        platformConcurrency: 4,
        providerConcurrency: 3,
      },
    });
    // Configuring one path never enables another.
    expect(aiSpendReadiness(readAiSpendPolicy(FULL_PHOTO_POLICY), "menu_manager.native", "openai").admissible).toBe(false);

    for (const key of Object.keys(FULL_PHOTO_POLICY)) {
      const partial: Record<string, string> = { ...FULL_PHOTO_POLICY };
      delete partial[key];
      const readiness = aiSpendReadiness(readAiSpendPolicy(partial), "ai_photo.async", "openai");
      expect(readiness).toEqual({ admissible: false, missing: [key] });
    }
  });

  it("treats malformed or out-of-range values as invalid instead of clamping or defaulting", () => {
    for (const bad of ["0", "-1", "1.5", "10abc", "1e3", "2000000000", "unlimited"]) {
      const policy = readAiSpendPolicy({ ...FULL_PHOTO_POLICY, AI_SPEND_AI_PHOTO_ASYNC_TENANT_DAILY_UNITS: bad });
      expect(policy.paths["ai_photo.async"].limits.tenantDailyUnits).toEqual({ status: "invalid" });
      expect(aiSpendReadiness(policy, "ai_photo.async", "openai")).toEqual({
        admissible: false,
        missing: ["AI_SPEND_AI_PHOTO_ASYNC_TENANT_DAILY_UNITS"],
      });
    }
    const shortExpiry = readAiSpendPolicy({ ...FULL_PHOTO_POLICY, AI_SPEND_AI_PHOTO_ASYNC_UNSTARTED_EXPIRY_MS: "1000" });
    expect(shortExpiry.paths["ai_photo.async"].limits.unstartedExpiryMs).toEqual({ status: "invalid" });
    expect(readAiSpendPolicy({ ...FULL_PHOTO_POLICY, AI_SPEND_AI_PHOTO_ASYNC_ENABLED: "yes" }).paths["ai_photo.async"].enabled).toBe(false);
  });

  it("describes the effective configuration and the existing AI photo limit without adopting its default", () => {
    const unset = describeAiSpendPolicy({});
    expect(unset.quotaKind).toBe("application_quota");
    expect(unset.paths["ai_photo.async"]).toMatchObject({ enabled: false, admissibleProviders: [] });
    expect(unset.paths["menu_manager.native"]).toMatchObject({ enabled: false, admissibleProviders: [] });
    expect(unset.existing.interactiveAiPhotos).toEqual({
      dailyLimitPerTenant: 20,
      source: "built_in_default",
      governance: "existing_setting_pending_review",
    });

    const explicit = describeAiSpendPolicy({ ...FULL_PHOTO_POLICY, AI_PHOTO_DAILY_LIMIT_PER_TENANT: "7" });
    expect(explicit.paths["ai_photo.async"].admissibleProviders).toEqual(["openai"]);
    expect(explicit.existing.interactiveAiPhotos).toMatchObject({ dailyLimitPerTenant: 7, source: "explicit" });
    expect(JSON.stringify(explicit)).not.toMatch(/sk-|api_?key/i);
  });
});
