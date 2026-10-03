import { describe, expect, it } from "vitest";

import {
  askButtonLabel,
  failureCopy,
  findingClaims,
  isReviewOutdated,
  newIdempotencyKey,
  nextPollDelayMs,
  productNameLookup,
  readMenuManagerResult,
  RUN_STATUS_COPY,
  runStatusCopy,
  unavailableHint,
  type MenuManagerRunLike,
} from "@/app/tenants/[tenantId]/catalogue/menus/menu-manager-view";
import {
  CONNECTION_STATUS_COPY,
  menuManagerStatusCopy,
} from "@/app/tenants/[tenantId]/settings/ai-agents/ai-agents-view";
import type { TenantAgentSettingsView } from "@/lib/agents/tenant-agent-settings";
import type { MenuHealthReport } from "@/lib/catalogue/menu-health";

const NOW = Date.parse("2026-09-30T10:00:00Z");

function run(overrides: Partial<MenuManagerRunLike> = {}): MenuManagerRunLike {
  return {
    publicId: "run_1",
    status: "running",
    result: null,
    failureCode: null,
    nextPollAt: new Date(NOW + 5_000).toISOString(),
    createdAt: new Date(NOW).toISOString(),
    finishedAt: null,
    ...overrides,
  };
}

const report = {
  products: [{ productPublicId: "prd_latte", displayName: "Latte", internalName: "latte", thumbnailPublicId: null, issues: [] }],
  issueGroups: [{ type: "missing_photo", severity: "warning", productCount: 3, productPublicIds: [] }],
} as unknown as MenuHealthReport;

describe("nextPollDelayMs", () => {
  it("follows the server's next poll time within bounds and stops once settled", () => {
    expect(nextPollDelayMs(run(), NOW)).toBe(5_000);
    expect(nextPollDelayMs(run({ nextPollAt: new Date(NOW - 60_000).toISOString() }), NOW)).toBe(2_000);
    expect(nextPollDelayMs(run({ nextPollAt: new Date(NOW + 600_000).toISOString() }), NOW)).toBe(15_000);
    expect(nextPollDelayMs(run({ status: "queued", nextPollAt: null }), NOW)).toBe(3_000);
    for (const status of ["completed", "failed", "awaiting_approval"] as const) {
      expect(nextPollDelayMs(run({ status }), NOW)).toBeNull();
    }
  });

  it("backs off to the slowest interval while the run is waiting on QOS", () => {
    const overdue = new Date(NOW - 60_000).toISOString();
    expect(nextPollDelayMs(run({ nextPollAt: overdue, waitingOn: "agent_connection" }), NOW)).toBe(15_000);
    expect(nextPollDelayMs(run({ nextPollAt: overdue, waitingOn: "service_unavailable" }), NOW)).toBe(15_000);
  });
});

describe("runStatusCopy", () => {
  it("presents a local stop as QOS stopping, never as the agent service failing", () => {
    const stopped = runStatusCopy(run({ status: "failed", failureCode: "qos_wait_deadline", remoteOutcomeUnknown: true }));
    expect(stopped.title).toBe("QOS stopped waiting");
    expect(stopped.description).toContain("may still finish");
    expect(`${stopped.title} ${stopped.description}`).not.toMatch(/failed|cancel/i);
    expect(failureCopy("qos_wait_deadline")).toContain("time limit");
    expect(failureCopy("start_outcome_unknown")).toContain("could not confirm");
  });

  it("explains why an active run is on hold", () => {
    expect(runStatusCopy(run({ waitingOn: "agent_connection" })).title).toContain("agent connection");
    expect(runStatusCopy(run({ waitingOn: "service_unavailable" })).title).toBe("Review on hold");
    expect(runStatusCopy(run({ waitingOn: "access_changed" })).title).toContain("access changed");
    expect(failureCopy("requester_access_revoked")).toContain("not sent");
    expect(runStatusCopy(run())).toBe(RUN_STATUS_COPY.running);
    expect(runStatusCopy(run({ status: "failed", failureCode: "invalid_result_json" }))).toBe(RUN_STATUS_COPY.failed);
  });
});

describe("readMenuManagerResult", () => {
  it("keeps well-formed entries and drops anything unexpected", () => {
    const view = readMenuManagerResult({
      summary: "Two gaps.",
      findings: [
        { type: "missing_photo", severity: "warning", title: "Photos", detail: "d", recommendation: "r", productPublicIds: ["prd_latte"] },
        { type: "publish", severity: "warning", title: "x", detail: "d", recommendation: "r", productPublicIds: [] },
        { type: "other", severity: "urgent", title: "x", detail: "d", recommendation: "r", productPublicIds: [] },
      ],
      suggestions: [
        { productPublicId: "prd_latte", field: "description_en", proposedText: "Smooth.", rationale: "" },
        { productPublicId: "prd_latte", field: "price", proposedText: "0", rationale: "" },
      ],
      snapshot: { menuVersion: 4, sha256: "abc" },
    });

    expect(view?.findings.map((finding) => finding.title)).toEqual(["Photos"]);
    expect(view?.suggestions).toHaveLength(1);
    expect(view?.menuVersion).toBe(4);
    expect(readMenuManagerResult(null)).toBeNull();
    expect(readMenuManagerResult({ summary: 1 })).toBeNull();
  });
});

describe("findingClaims", () => {
  it("labels QOS counts as system facts and the agent's words as AI claims", () => {
    const claims = findingClaims(
      { type: "missing_photo", severity: "warning", title: "Photos", detail: "Latte has none.", recommendation: "Add one.", productPublicIds: [] },
      report,
    );
    expect(claims).toEqual([
      { kind: "System fact", text: 'QOS checks: 3 items in "Missing photos".' },
      { kind: "AI interpretation", text: "Latte has none." },
      { kind: "AI recommendation", text: "Add one." },
    ]);

    const other = findingClaims(
      { type: "other", severity: "info", title: "Naming", detail: "", recommendation: "Shorter names.", productPublicIds: [] },
      report,
    );
    expect(other).toEqual([{ kind: "AI recommendation", text: "Shorter names." }]);
  });
});

describe("menu manager copy", () => {
  it("explains failures without exposing codes", () => {
    expect(failureCopy("unknown_product_reference")).toContain("not on this menu");
    expect(failureCopy("something_new")).toBe("The agent service could not complete this review.");
    expect(failureCopy(null)).toBe("The agent service could not complete this review.");
  });

  it("labels the ask button by selection and flags outdated reviews", () => {
    expect(askButtonLabel(0)).toBe("Ask QOS to review this menu");
    expect(askButtonLabel(1)).toBe("Ask QOS about 1 selected item");
    expect(askButtonLabel(3)).toBe("Ask QOS about 3 selected items");
    const result = { summary: "", findings: [], suggestions: [], menuVersion: 4 };
    expect(isReviewOutdated(result, 4)).toBe(false);
    expect(isReviewOutdated(result, 5)).toBe(true);
    expect(productNameLookup(report)("prd_latte")).toBe("Latte");
    expect(productNameLookup(report)("prd_gone")).toBe("prd_gone");
    expect(newIdempotencyKey()).toMatch(/^menu-review-[0-9a-f-]{36}$/);
  });

  it("only hints at turning Menu Manager on for administrators", () => {
    expect(unavailableHint("disabled", true)).toContain("Settings › AI & Agents");
    expect(unavailableHint("disabled", false)).toBeNull();
    expect(unavailableHint("feature_off", true)).toBeNull();
  });
});

describe("AI & Agents settings copy", () => {
  function view(reason: TenantAgentSettingsView["menuManager"]["unavailableReason"]): TenantAgentSettingsView {
    return {
      canManage: true,
      connection: { status: "connected", lastCheckedAt: null },
      menuManager: { featureEnabled: true, binding: null, available: reason === null, unavailableReason: reason },
    };
  }

  it("describes every Menu Manager state and connection status", () => {
    expect(menuManagerStatusCopy(view(null)).label).toBe("On");
    expect(menuManagerStatusCopy(view("disabled")).label).toBe("Off");
    expect(menuManagerStatusCopy(view("not_configured")).label).toBe("Not set up");
    expect(menuManagerStatusCopy(view("feature_off")).label).toBe("Not available");
    expect(menuManagerStatusCopy(view("not_connected")).label).toBe("Paused");
    expect(Object.keys(CONNECTION_STATUS_COPY).sort()).toEqual(
      ["connected", "disconnected", "error", "needs_reauth"],
    );
  });
});
