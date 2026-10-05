import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  addAiSpendReservationToBuckets,
  emptyAiSpendUsageBuckets,
  mergeReportedUsage,
  parseAiSpendOperatorArgs,
  usageSnapshotEvent,
  type AiSpendUsageSummary,
} from "@/lib/ai/spend/spend-reconciliation";

describe("AI spend reconciliation helpers", () => {
  it("starts buckets at zero", () => {
    expect(emptyAiSpendUsageBuckets()).toEqual({ reserved: 0, consumed: 0, released: 0, uncertain: 0 });
  });

  it("counts reservations and units separately", () => {
    const buckets = {
      reservations: emptyAiSpendUsageBuckets(),
      units: emptyAiSpendUsageBuckets(),
    };
    addAiSpendReservationToBuckets(buckets, "reserved", 2);
    addAiSpendReservationToBuckets(buckets, "consumed", 1);
    addAiSpendReservationToBuckets(buckets, "uncertain", 3);
    expect(buckets.reservations).toEqual({ reserved: 1, consumed: 1, released: 0, uncertain: 1 });
    expect(buckets.units).toEqual({ reserved: 2, consumed: 1, released: 0, uncertain: 3 });
  });

  it("sums integer usage fields and ignores disallowed keys", () => {
    const into: Record<string, number> = {};
    mergeReportedUsage(into, { total_tokens: 10, Prompt: 1, secret: "x", nested: { n: 1 } });
    mergeReportedUsage(into, { total_tokens: 20, images: 1 });
    expect(into).toEqual({ total_tokens: 30, images: 1 });
  });

  it("builds a sanitized usage snapshot that requires a tenant", () => {
    const summary: AiSpendUsageSummary = {
      path: "ai_photo.async",
      asOf: "2026-10-05T00:00:00.000Z",
      tenantId: "tenant-1",
      quotaKind: "application_quota",
      reservations: { reserved: 0, consumed: 1, released: 0, uncertain: 1 },
      units: { reserved: 0, consumed: 1, released: 0, uncertain: 1 },
      reportedUsage: { total_tokens: 30 },
      estimatedCostMicros: null,
      uncertain: 1,
      counters: {
        platformDaily: 2,
        platformMonthly: 2,
        platformConcurrency: 1,
        providerConcurrency: 1,
        tenantDaily: 2,
        tenantMonthly: 2,
        tenantConcurrency: 1,
      },
    };
    const event = usageSnapshotEvent(summary);
    expect(event).toEqual({
      event: "ai_spend.usage_snapshot",
      tenantId: "tenant-1",
      path: "ai_photo.async",
      reservations: summary.reservations,
      units: summary.units,
      uncertain: 1,
      quotaKind: "application_quota",
    });
    const json = JSON.stringify(event);
    expect(json).not.toMatch(/prompt/i);
    expect(json).not.toMatch(/secret/i);
    expect(json).not.toMatch(/password/i);
    expect(() => usageSnapshotEvent({ ...summary, tenantId: null })).toThrow(/tenant/i);
  });
});

describe("AI spend operator args", () => {
  it("defaults usage to ai_photo.async", () => {
    expect(parseAiSpendOperatorArgs(["usage", "--database-host", "db.example"])).toEqual({
      command: "usage",
      databaseHost: "db.example",
      path: "ai_photo.async",
    });
  });

  it("rejects an unknown path, resolution, blank reason, and unknown flag", () => {
    expect(() => parseAiSpendOperatorArgs(["usage", "--database-host", "h", "--path", "nope"])).toThrow(
      /Unknown AI spend path/,
    );
    expect(() =>
      parseAiSpendOperatorArgs([
        "resolve",
        "--database-host",
        "h",
        "--tenant",
        "t",
        "--reservation",
        "spr_x",
        "--resolution",
        "maybe",
        "--reason",
        "ok",
        "--operator",
        "op",
      ]),
    ).toThrow(/billed or not_billed/);
    expect(() =>
      parseAiSpendOperatorArgs([
        "resolve",
        "--database-host",
        "h",
        "--tenant",
        "t",
        "--reservation",
        "spr_x",
        "--resolution",
        "billed",
        "--reason",
        " ",
        "--operator",
        "op",
      ]),
    ).toThrow(/1 to 500/);
    expect(() => parseAiSpendOperatorArgs(["usage", "--database-host", "h", "--extra", "1"])).toThrow();
  });
});


describe("AI spend operator packaging", () => {
  it("exposes a host-confirmed CLI that does not read .env", () => {
    const root = process.cwd();
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["ai:spend"]).toBe("tsx scripts/ai-spend-operator-cli.ts");
    const script = readFileSync(path.join(root, "scripts/ai-spend-operator-cli.ts"), "utf8");
    expect(script).toContain("assertConfirmedDatabaseHost");
    expect(script).not.toMatch(/\.env/);
    expect(script).toContain("AI_SPEND_QUOTA_KIND");
  });
});
