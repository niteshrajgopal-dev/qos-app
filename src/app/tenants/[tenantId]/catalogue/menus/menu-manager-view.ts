import type { MenuManagerWaitReason } from "@/lib/agents/menu-manager/menu-manager-service";
import type { AgentRunStatus } from "@/lib/agents/types";
import type { MenuManagerUnavailableReason } from "@/lib/agents/tenant-agent-settings";
import { MENU_HEALTH_ISSUE_COPY } from "@/app/tenants/[tenantId]/catalogue/menus/menu-health-view";
import type { MenuHealthIssueType, MenuHealthReport } from "@/lib/catalogue/menu-health";

const MIN_POLL_DELAY_MS = 2_000;
const MAX_POLL_DELAY_MS = 15_000;
const QUEUED_POLL_DELAY_MS = 3_000;

type AlertTone = "info" | "success" | "warning" | "error" | "neutral" | "intelligence";

export type MenuManagerRunLike = {
  publicId: string;
  status: AgentRunStatus;
  result: Record<string, unknown> | null;
  failureCode: string | null;
  /** The run ended before QOS learned whether the agent service finished it. */
  remoteOutcomeUnknown?: boolean;
  waitingOn?: MenuManagerWaitReason | null;
  nextPollAt: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export type MenuManagerFinding = {
  type: MenuHealthIssueType | "other";
  severity: "info" | "warning" | "blocking";
  title: string;
  detail: string;
  recommendation: string;
  productPublicIds: string[];
};

export type MenuManagerSuggestion = {
  productPublicId: string;
  field: "name_en" | "description_en" | "name_ar" | "description_ar";
  proposedText: string;
  rationale: string;
};

export type MenuManagerResultView = {
  summary: string;
  findings: MenuManagerFinding[];
  suggestions: MenuManagerSuggestion[];
  menuVersion: number | null;
};

export function isActiveRunStatus(status: AgentRunStatus) {
  return status === "queued" || status === "running";
}

/** How long to wait before asking QOS for the run again; null once it has settled. */
export function nextPollDelayMs(run: MenuManagerRunLike, now = Date.now()): number | null {
  if (!isActiveRunStatus(run.status)) {
    return null;
  }
  if (run.waitingOn) {
    return MAX_POLL_DELAY_MS;
  }
  if (!run.nextPollAt) {
    return QUEUED_POLL_DELAY_MS;
  }
  const due = new Date(run.nextPollAt).getTime() - now;
  return Math.min(Math.max(due, MIN_POLL_DELAY_MS), MAX_POLL_DELAY_MS);
}

export const RUN_STATUS_COPY: Record<
  AgentRunStatus,
  { tone: AlertTone; title: string; description: string }
> = {
  queued: {
    tone: "info",
    title: "Starting review",
    description: "QOS is handing the menu snapshot to the Menu Manager.",
  },
  running: {
    tone: "intelligence",
    title: "Menu Manager is reviewing",
    description: "This usually takes a minute or two. You can keep editing; the review uses the snapshot taken when you asked.",
  },
  awaiting_approval: {
    tone: "warning",
    title: "Review paused",
    description: "The agent stopped to ask for an approval. QOS never approves agent actions, so this review ends here. Ask again to start a fresh review.",
  },
  completed: {
    tone: "success",
    title: "Review ready",
    description: "Suggestions are drafts. Nothing has been changed; apply anything you agree with in the product editor.",
  },
  failed: {
    tone: "error",
    title: "Review failed",
    description: "Nothing on the menu was changed.",
  },
};

const STATUS_COPY_WHILE_WAITING: Record<
  MenuManagerWaitReason,
  { tone: AlertTone; title: string; description: string }
> = {
  agent_connection: {
    tone: "warning",
    title: "Review waiting for QOS's agent connection",
    description: "QOS needs to reconnect its agent service. The review continues if the connection returns before its time limit; nothing is sent again.",
  },
  service_unavailable: {
    tone: "warning",
    title: "Review on hold",
    description: "Menu Manager is unavailable right now. QOS stops waiting at the review's time limit; nothing is sent again.",
  },
};

const UNRESOLVED_STATUS_COPY = {
  tone: "warning" as const,
  title: "QOS stopped waiting",
  description: "The agent service may still finish this review, but QOS will not use its reply. Nothing on the menu was changed.",
};

export const UNRESOLVED_RESTART_COPY =
  "QOS stopped waiting for the previous review, but the agent service may still process it, and it may count toward usage. A new review is sent separately.";

/** Status copy that never presents QOS stopping as the agent service failing. */
export function runStatusCopy(run: MenuManagerRunLike) {
  if (run.status === "failed" && run.remoteOutcomeUnknown) {
    return UNRESOLVED_STATUS_COPY;
  }
  if (isActiveRunStatus(run.status) && run.waitingOn) {
    return STATUS_COPY_WHILE_WAITING[run.waitingOn];
  }
  return RUN_STATUS_COPY[run.status];
}

const FAILURE_COPY: Record<string, string> = {
  qos_wait_deadline: "The review did not finish within QOS's time limit.",
  timeout: "The review did not finish within QOS's time limit.",
  start_outcome_unknown: "QOS could not confirm whether the agent service received the review.",
  start_not_recorded: "QOS could not confirm that the review started.",
  provider_reauth_required: "QOS needs to reconnect its agent service. Try again later.",
  provider_not_connected: "QOS's agent service is not connected right now.",
  invalid_result_json: "The agent's reply could not be read, so QOS discarded it.",
  invalid_result_shape: "The agent's reply did not match what QOS accepts, so it was discarded.",
  result_menu_mismatch: "The agent answered about a different menu, so the reply was discarded.",
  unknown_product_reference: "The agent referred to items that are not on this menu, so the reply was discarded.",
  empty_final_message: "The agent finished without a reply.",
  final_message_too_large: "The agent's reply was too large to accept.",
};

export function failureCopy(code: string | null) {
  return (code && FAILURE_COPY[code]) || "The agent service could not complete this review.";
}

/** Unavailable-state hint, only for people who can do something about it. */
export function unavailableHint(reason: MenuManagerUnavailableReason | null, canManage: boolean) {
  if (!canManage) {
    return null;
  }
  if (reason === "disabled") {
    return "Menu Manager is turned off for this business. An administrator can turn it on in Settings › AI & Agents.";
  }
  return null;
}

export function askButtonLabel(selectedCount: number) {
  return selectedCount > 0
    ? `Ask QOS about ${selectedCount} selected ${selectedCount === 1 ? "item" : "items"}`
    : "Ask QOS to review this menu";
}

export const SUGGESTION_FIELD_LABEL: Record<MenuManagerSuggestion["field"], string> = {
  name_en: "English name",
  description_en: "English description",
  name_ar: "Arabic name",
  description_ar: "Arabic description",
};

const FINDING_TYPES = new Set<string>([...Object.keys(MENU_HEALTH_ISSUE_COPY), "other"]);
const SEVERITIES = new Set(["info", "warning", "blocking"]);
const FIELDS = new Set(Object.keys(SUGGESTION_FIELD_LABEL));

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Narrows a stored run result for display. The server already validated it;
 * this only protects the UI from rendering anything unexpected.
 */
export function readMenuManagerResult(result: unknown): MenuManagerResultView | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  const value = result as Record<string, unknown>;
  if (!isString(value.summary) || !Array.isArray(value.findings) || !Array.isArray(value.suggestions)) {
    return null;
  }

  const findings = value.findings.filter(
    (entry): entry is MenuManagerFinding =>
      !!entry &&
      typeof entry === "object" &&
      FINDING_TYPES.has((entry as MenuManagerFinding).type) &&
      SEVERITIES.has((entry as MenuManagerFinding).severity) &&
      isString((entry as MenuManagerFinding).title) &&
      isString((entry as MenuManagerFinding).detail) &&
      isString((entry as MenuManagerFinding).recommendation) &&
      Array.isArray((entry as MenuManagerFinding).productPublicIds) &&
      (entry as MenuManagerFinding).productPublicIds.every(isString),
  );
  const suggestions = value.suggestions.filter(
    (entry): entry is MenuManagerSuggestion =>
      !!entry &&
      typeof entry === "object" &&
      isString((entry as MenuManagerSuggestion).productPublicId) &&
      FIELDS.has((entry as MenuManagerSuggestion).field) &&
      isString((entry as MenuManagerSuggestion).proposedText) &&
      isString((entry as MenuManagerSuggestion).rationale),
  );
  const snapshot = value.snapshot as { menuVersion?: unknown } | undefined;

  return {
    summary: value.summary,
    findings,
    suggestions,
    menuVersion: typeof snapshot?.menuVersion === "number" ? snapshot.menuVersion : null,
  };
}

/**
 * Claims for one finding, keeping QOS's own checks visibly separate from the
 * agent's interpretation and recommendation.
 */
export function findingClaims(finding: MenuManagerFinding, report: MenuHealthReport | null) {
  const claims: Array<{ kind: string; text: string }> = [];
  if (report && finding.type !== "other") {
    const group = report.issueGroups.find((entry) => entry.type === finding.type);
    if (group) {
      claims.push({
        kind: "System fact",
        text: `QOS checks: ${group.productCount} ${group.productCount === 1 ? "item" : "items"} in "${MENU_HEALTH_ISSUE_COPY[finding.type].title}".`,
      });
    }
  }
  if (finding.detail) {
    claims.push({ kind: "AI interpretation", text: finding.detail });
  }
  if (finding.recommendation) {
    claims.push({ kind: "AI recommendation", text: finding.recommendation });
  }
  return claims;
}

export function productNameLookup(report: MenuHealthReport | null) {
  const names = new Map(
    (report?.products ?? []).map((product) => [product.productPublicId, product.displayName]),
  );
  return (productPublicId: string) => names.get(productPublicId) ?? productPublicId;
}

/** True when the draft was saved again after the snapshot the review used. */
export function isReviewOutdated(result: MenuManagerResultView, currentMenuVersion: number) {
  return result.menuVersion !== null && result.menuVersion !== currentMenuVersion;
}

export function newIdempotencyKey() {
  return `menu-review-${crypto.randomUUID()}`;
}
