import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { DbClient } from "@/db/client";
import type { TenantDbExecutor } from "@/lib/tenant/context";
import { agentRunMenuManagerSuggestionAcceptances, catalogueMenus } from "@/db/schema";
import { AgentRunError, getAgentRun, type AgentRunRecord } from "@/lib/agents/agent-runs";
import {
  MENU_MANAGER_LIMITS,
  MENU_MANAGER_SUGGESTION_FIELDS,
  reviewedMenuVersionFromStoredResult,
} from "@/lib/agents/menu-manager/menu-manager-result";
import type { AgentRunStatus } from "@/lib/agents/types";
import {
  auditActorClassFromStaffRole,
  recordTenantAuditEventInTx,
} from "@/lib/audit/tenant-audit";
import { assertMenuLocationAccess } from "@/lib/catalogue/menus";
import {
  getDraftProductInTx,
  updateDraftProductInTx,
  type DraftProductEditorView,
} from "@/lib/catalogue/products";
import type { UpdateDraftProductInput } from "@/lib/catalogue/validation";
import {
  requireAdministratorMembership,
  type ActiveStaffMembership,
} from "@/lib/staff/auth";
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

export function suggestionIdentityKey(identity: SuggestionIdentity) {
  return `${identity.productPublicId}:${identity.field}:${identity.proposedText}`;
}

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

  const reviewedVersion = reviewedMenuVersionFromStoredResult(input.storedResult);
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

async function listAcceptedSuggestionKeysInTx(
  tx: TenantDbExecutor,
  tenantId: string,
  agentRunId: string,
): Promise<string[]> {
  const rows = await tx
    .select({
      productPublicId: agentRunMenuManagerSuggestionAcceptances.productPublicId,
      field: agentRunMenuManagerSuggestionAcceptances.field,
      proposedText: agentRunMenuManagerSuggestionAcceptances.proposedText,
    })
    .from(agentRunMenuManagerSuggestionAcceptances)
    .where(
      and(
        eq(agentRunMenuManagerSuggestionAcceptances.tenantId, tenantId),
        eq(agentRunMenuManagerSuggestionAcceptances.agentRunId, agentRunId),
      ),
    );
  return rows.map((row) =>
    suggestionIdentityKey({
      productPublicId: row.productPublicId,
      field: row.field as SuggestionIdentity["field"],
      proposedText: row.proposedText,
    }),
  );
}

export async function listAcceptedSuggestionKeysForRun(
  db: DbClient,
  tenantId: string,
  agentRunId: string,
): Promise<string[]> {
  return withTenantContext(db, tenantId, async (tx) =>
    listAcceptedSuggestionKeysInTx(tx, tenantId, agentRunId),
  );
}

export type AcceptMenuManagerSuggestionResult = {
  product: DraftProductEditorView;
  applied: SuggestionIdentity;
  acceptedSuggestionKeys: string[];
  idempotentReplay: boolean;
};

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
): Promise<AcceptMenuManagerSuggestionResult> {
  await requireAdministratorMembership(db, caller.tenantId, caller.subject);

  const identity: SuggestionIdentity = {
    productPublicId: input.productPublicId,
    field: input.field,
    proposedText: input.proposedText,
  };

  const run = await getAgentRun(db, caller.tenantId, input.runPublicId);
  assertMenuManagerRun(run, input.menuPublicId);

  return withTenantContext(db, caller.tenantId, async (tx) => {
    await assertTenantActive(tx, caller.tenantId);
    await assertMenuLocationAccess(tx, caller.tenantId, caller.membership, input.menuPublicId);

    const [lockedMenu] = await tx
      .select({ version: catalogueMenus.version })
      .from(catalogueMenus)
      .where(
        and(
          eq(catalogueMenus.tenantId, caller.tenantId),
          eq(catalogueMenus.publicId, input.menuPublicId),
        ),
      )
      .for("update")
      .limit(1);

    if (!lockedMenu) {
      throw new AgentRunError("run_not_found", "Menu not found.", 404);
    }

    const matched = assertSuggestionAcceptable({
      runStatus: run.status,
      storedResult: run.result,
      currentMenuVersion: lockedMenu.version,
      identity,
    });

    const [reserved] = await tx
      .insert(agentRunMenuManagerSuggestionAcceptances)
      .values({
        tenantId: caller.tenantId,
        agentRunId: run.id,
        productPublicId: matched.productPublicId,
        field: matched.field,
        proposedText: matched.proposedText,
        acceptedBySubject: caller.subject,
      })
      .onConflictDoNothing({
        target: [
          agentRunMenuManagerSuggestionAcceptances.tenantId,
          agentRunMenuManagerSuggestionAcceptances.agentRunId,
          agentRunMenuManagerSuggestionAcceptances.productPublicId,
          agentRunMenuManagerSuggestionAcceptances.field,
          agentRunMenuManagerSuggestionAcceptances.proposedText,
        ],
      })
      .returning({ id: agentRunMenuManagerSuggestionAcceptances.id });

    const acceptedKeys = await listAcceptedSuggestionKeysInTx(tx, caller.tenantId, run.id);

    if (!reserved) {
      const product = await getDraftProductInTx(
        tx,
        caller.tenantId,
        caller.membership,
        input.productPublicId,
      );
      return {
        product,
        applied: {
          productPublicId: matched.productPublicId,
          field: matched.field,
          proposedText: matched.proposedText,
        },
        acceptedSuggestionKeys: acceptedKeys,
        idempotentReplay: true,
      };
    }

    const product = await getDraftProductInTx(
      tx,
      caller.tenantId,
      caller.membership,
      input.productPublicId,
    );
    const updated = await updateDraftProductInTx(
      tx,
      caller.tenantId,
      caller.membership,
      input.productPublicId,
      draftPatchForSuggestion(matched.field, matched.proposedText, product),
      caller.subject,
    );

    const mapping = FIELD_PATCH[matched.field];
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

    return {
      product: updated,
      applied: {
        productPublicId: matched.productPublicId,
        field: matched.field,
        proposedText: matched.proposedText,
      },
      acceptedSuggestionKeys: acceptedKeys,
      idempotentReplay: false,
    };
  });
}
