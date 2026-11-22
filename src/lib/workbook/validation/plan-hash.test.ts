import { describe, expect, it } from "vitest";

import { planHash, rowsDigest, stableStringify, type PlanHashInput } from "@/lib/workbook/validation/plan-hash";

const ROW_A = { sheet: "Products", row: 7, key: "p1", classification: "create" as const, operation: "create" as const, targetPublicId: null, targetRevision: null, after: { display_name_en: "A", internal_name: "a" }, deferredFields: [] };
const ROW_B = { sheet: "Variants", row: 7, key: "v1", classification: "update" as const, operation: "update" as const, targetPublicId: "var_x", targetRevision: "rv1.AAAAAAAAAAAAAAAAAAAAAA", after: { amount_minor: "1250" }, deferredFields: [] };

function base(overrides: Partial<PlanHashInput> = {}): PlanHashInput {
  return {
    engineVersion: "qos194.1",
    tenantPublicId: "ten",
    brandPublicId: "brd",
    sourceNamespace: "qos:ten",
    sourceProfile: "qos_extended_v1",
    fileFingerprint: "f".repeat(64),
    sourceFileSha256: null,
    createdBySubject: "alice",
    createdByRole: "administrator",
    reviewedBySubject: "alice",
    branchScope: "all",
    snapshotHash: "s".repeat(64),
    rows: [ROW_A, ROW_B],
    decisions: [{ kind: "acknowledge_warnings" }, { kind: "exclude", sheet: "Products", row: 9 }],
    ...overrides,
  };
}

describe("plan hash", () => {
  it("is deterministic across row, decision and key order", () => {
    const hash = planHash(base());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(planHash(base({ rows: [ROW_B, { ...ROW_A, after: { internal_name: "a", display_name_en: "A" } }] }))).toBe(hash);
    expect(planHash(base({ decisions: [{ kind: "exclude", sheet: "Products", row: 9 }, { kind: "acknowledge_warnings" }] }))).toBe(hash);
    expect(planHash(base({ branchScope: ["b", "a"] }))).toBe(planHash(base({ branchScope: ["a", "b"] })));
    expect(rowsDigest([ROW_A, ROW_B])).toBe(rowsDigest([ROW_B, ROW_A]));
    expect(stableStringify({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
  });

  it("changes with any decision, snapshot, file, actor, scope or row outcome", () => {
    const hash = planHash(base());
    const variants: Array<Partial<PlanHashInput>> = [
      { decisions: [{ kind: "acknowledge_warnings" }] },
      { decisions: [...base().decisions, { kind: "match_existing", sheet: "Products", row: 7, targetPublicId: "prd_x" }] },
      { snapshotHash: "t".repeat(64) },
      { fileFingerprint: "e".repeat(64) },
      { createdBySubject: "bob" },
      { createdByRole: "user" },
      { reviewedBySubject: "carol" },
      { branchScope: ["loc_a"] },
      { rows: [ROW_A, { ...ROW_B, targetRevision: "rv1.BBBBBBBBBBBBBBBBBBBBBB" }] },
      { rows: [ROW_A, { ...ROW_B, after: { amount_minor: "1251" } }] },
      { rows: [{ ...ROW_A, classification: "conflicting", operation: null }, ROW_B] },
    ];
    for (const change of variants) {
      expect(planHash(base(change)), JSON.stringify(change)).not.toBe(hash);
    }
  });
});
