import { z } from "zod";

import type { DbClient } from "@/db/client";
import { AgentRunError, getAgentRun, type AgentRunRecord } from "@/lib/agents/agent-runs";
import {
  MENU_MANAGER_LIMITS,
  MENU_MANAGER_SUGGESTION_FIELDS,
} from "@/lib/agents/menu-manager/menu-manager-result";
import type { AgentRunStatus } from "@/lib/agents/types";
import {
  auditActorClassFromStaffRole,
  recordTenantAuditEventInTx,
} from "@/lib/audit/tenant-audit";
import { getDraftMenu, assertMenuLocationAccess } from "@/lib/catalogue/menus";
import {
  getDraftProduct,
  updateDraftProduct,
  type DraftProductEditorView,
} from "@/lib/catalogue/products";
import type { UpdateDraftProductInput } from "@/lib/catalogue/validation";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";
import { assertTenantActive } from "@/lib/tenant/tenant-status";

const CAPABILITY = "menu_manager" as const;
const SUBJECT_TYPE = "menu";

export const acceptMenuManagerSuggestionBodySchema = z.strictObject({
  productPublicId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  field: z.enum(MENU_MANAGER_SUGGESTION_FIELDS),
  proposedText: z.string().trim().min(1).max(MENU_MANAGER_LIMITS.proposedTextChars),
});

export type AcceptMenuManagerSuggestionBody = z.infer<
  typeof acceptMenuManagerSuggestionBodySchema
>;

export type SuggestionIdentity = {
  productPublicId: string;
  field: (typeof MENU_MANAGER_SUGGESTION_FIELDS)[number];
  proposedText: string;
};

export type MatchedMenuManagerSuggestion = SuggestionIdentity & {
  rationale: string;
};

type Caller = {
  tenantId: string;
  subject: string;
  membership: ActiveStaffMembership;
};

const FIELD_PATCH = {
  name_en: { locale: "en", key: "displayName" },
  description_en: { locale: "en", key: "description" },
  name_ar: { locale: "ar", key: "displayName" },
  description_ar: { locale: "ar", key: "description" },
} as const;

export function matchStoredSuggestion(
  result: unknown,
  identity: SuggestionIdentity,
): MatchedMenuManagerSuggestion | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  const suggestions = (result as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(suggestions)) {
    return null;
  }

  const proposedText = identity.proposedText.trim();
  const found = suggestions.find((entry) => {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    const suggestion = entry as Record<string, unknown>;
    return (
      suggestion.productPublicId === identity.productPublicId &&
      suggestion.field === identity.field &&
      typeof suggestion.proposedText === "string" &&
      suggestion.proposedText.trim() === proposedText
    );
  });

  if (!found || typeof found !== "object") {
    return null;
  }

  const suggestion = found as Record<string, unknown>;
  return {
    productPublicId: identity.productPublicId,
    field: identity.field,
    proposedText,
    rationale: typeof suggestion.rationale === "string" ? suggestion.rationale : "",
  };
}

export function assertSuggestionAcceptable(input: {
  runStatus: AgentRunStatus;
  storedResult: unknown;
  currentMenuVersion: number;
  identity: SuggestionIdentity;
}): MatchedMenuManagerSuggestion {
  if (input.runStatus !== "completed") {
    throw new AgentRunError("run_not_completed", "This review is not ready to apply.", 409);
  }

  const matched = matchStoredSuggestion(input.storedResult, input.identity);
  if (!matched) {
    throw new AgentRunError(
      "suggestion_not_found",
      "That suggestion is not part of this review.",
      404,
    );
  }

  const snapshot =
    input.storedResult && typeof input.storedResult === "object"
      ? (input.storedResult as { snapshot?: { menuVersion?: unknown } }).snapshot
      : undefined;
  const reviewedVersion =
    typeof snapshot?.menuVersion === "number" ? snapshot.menuVersion : null;
  if (reviewedVersion === null || reviewedVersion !== input.currentMenuVersion) {
    throw new AgentRunError(
      "review_outdated",
      "The draft changed since this review. Ask again to review the latest save.",
      409,
    );
  }

  return matched;
}

export function draftPatchForSuggestion(
  field: SuggestionIdentity["field"],
  proposedText: string,
  product: Pick<DraftProductEditorView, "version" | "translations">,
): UpdateDraftProductInput {
  const mapping = FIELD_PATCH[field];
  return {
    expectedVersion: product.version,
    translations: {
      [mapping.locale]: {
        [mapping.key]: proposedText,
        expectedTranslationVersion: product.translations[mapping.locale].translationVersion,
      },
    },
  };
}

function assertMenuManagerRun(run: AgentRunRecord, menuPublicId: string) {
  if (
    run.capability !== CAPABILITY ||
    run.subjectType !== SUBJECT_TYPE ||
    run.subjectPublicId !== menuPublicId
  ) {
    throw new AgentRunError("run_not_found", "Agent run not found.", 404);
  }
}

/**
 * Writes one stored suggestion onto the product draft. Never publishes.
 */
export async function acceptMenuManagerSuggestion(
  db: DbClient,
  caller: Caller,
  input: {
    menuPublicId: string;
    runPublicId: string;
    productPublicId: string;
    field: SuggestionIdentity["field"];
    proposedText: string;
  },
): Promise<{ product: DraftProductEditorView; applied: SuggestionIdentity }> {
  await withTenantContext(db, caller.tenantId, async (tx) => {
    await assertTenantActive(tx, caller.tenantId);
    await assertMenuLocationAccess(tx, caller.tenantId, caller.membership, input.menuPublicId);
  });

  const run = await getAgentRun(db, caller.tenantId, input.runPublicId);
  assertMenuManagerRun(run, input.menuPublicId);

  const menu = await getDraftMenu(db, caller.tenantId, input.menuPublicId);
  const identity: SuggestionIdentity = {
    productPublicId: input.productPublicId,
    field: input.field,
    proposedText: input.proposedText,
  };
  const matched = assertSuggestionAcceptable({
    runStatus: run.status,
    storedResult: run.result,
    currentMenuVersion: menu.version,
    identity,
  });

  const product = await getDraftProduct(
    db,
    caller.tenantId,
    caller.membership,
    input.productPublicId,
  );
  const updated = await updateDraftProduct(
    db,
    caller.tenantId,
    caller.membership,
    input.productPublicId,
    draftPatchForSuggestion(matched.field, matched.proposedText, product),
    caller.subject,
  );

  const mapping = FIELD_PATCH[matched.field];
  await withTenantContext(db, caller.tenantId, async (tx) => {
    await recordTenantAuditEventInTx(tx, {
      tenantId: caller.tenantId,
      actorSubject: caller.subject,
      actorClass: auditActorClassFromStaffRole(caller.membership.role),
      action: "catalogue.menu_manager.suggestion_accepted",
      entityType: "catalogue_product",
      entityPublicId: input.productPublicId,
      entityVersion: updated.version,
      changeSummary: {
        menuPublicId: input.menuPublicId,
        runPublicId: input.runPublicId,
        field: matched.field,
        locale: mapping.locale,
      },
    });
  });

  return {
    product: updated,
    applied: {
      productPublicId: matched.productPublicId,
      field: matched.field,
      proposedText: matched.proposedText,
    },
  };
}
