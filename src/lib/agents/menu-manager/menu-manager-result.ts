import { z } from "zod";

import type { CompletionInterpretation } from "@/lib/agents/agent-runs";
import { boundRawResultExcerpt } from "@/lib/agents/agent-runs";
import { MENU_HEALTH_ISSUE_TYPES } from "@/lib/catalogue/menu-health";

export const MENU_MANAGER_RESULT_SCHEMA = "qos.menu_manager_result.v1";

export const MENU_MANAGER_FINDING_TYPES = [...MENU_HEALTH_ISSUE_TYPES, "other"] as const;
export const MENU_MANAGER_SEVERITIES = ["info", "warning", "blocking"] as const;
/** Fields a suggestion may target. Suggestions are text for review only; QOS never applies them. */
export const MENU_MANAGER_SUGGESTION_FIELDS = [
  "name_en",
  "description_en",
  "name_ar",
  "description_ar",
] as const;

export const MENU_MANAGER_LIMITS = {
  summaryChars: 1_000,
  findings: 50,
  titleChars: 200,
  detailChars: 2_000,
  productIdsPerFinding: 150,
  suggestions: 100,
  proposedTextChars: 2_000,
  rationaleChars: 500,
} as const;

const productPublicId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

const finding = z.strictObject({
  type: z.enum(MENU_MANAGER_FINDING_TYPES),
  severity: z.enum(MENU_MANAGER_SEVERITIES),
  title: z.string().trim().min(1).max(MENU_MANAGER_LIMITS.titleChars),
  detail: z.string().trim().max(MENU_MANAGER_LIMITS.detailChars),
  recommendation: z.string().trim().max(MENU_MANAGER_LIMITS.detailChars),
  productPublicIds: z.array(productPublicId).max(MENU_MANAGER_LIMITS.productIdsPerFinding),
});

const suggestion = z.strictObject({
  productPublicId,
  field: z.enum(MENU_MANAGER_SUGGESTION_FIELDS),
  proposedText: z.string().trim().min(1).max(MENU_MANAGER_LIMITS.proposedTextChars),
  rationale: z.string().trim().max(MENU_MANAGER_LIMITS.rationaleChars),
});

/** Strict: any extra key (for example an "actions" payload) rejects the whole reply. */
export const menuManagerResultSchema = z.strictObject({
  schema: z.literal(MENU_MANAGER_RESULT_SCHEMA),
  menuPublicId: productPublicId,
  summary: z.string().trim().max(MENU_MANAGER_LIMITS.summaryChars),
  findings: z.array(finding).max(MENU_MANAGER_LIMITS.findings),
  suggestions: z.array(suggestion).max(MENU_MANAGER_LIMITS.suggestions),
});

export type MenuManagerResult = z.infer<typeof menuManagerResultSchema>;

/** Stored on the run: the validated reply plus which snapshot it answered. */
export type StoredMenuManagerResult = MenuManagerResult & {
  snapshot: { menuVersion: number | null; sha256: string | null };
};

const FENCED_JSON = /```(?:json)?\s*\n([\s\S]*?)\n?```/g;

/** Takes the last fenced JSON block, or the whole message when it is bare JSON. */
export function extractMenuManagerJson(finalMessage: string): unknown {
  const blocks = [...finalMessage.matchAll(FENCED_JSON)].map((match) => match[1]!);
  const candidate = blocks.length > 0 ? blocks.at(-1)! : finalMessage.trim();
  return JSON.parse(candidate);
}

type ValidationContext = {
  menuPublicId: string;
  productPublicIds: readonly string[];
  menuVersion: number | null;
  snapshotSha256: string | null;
};

function invalid(code: string, message: string, finalMessage: string): CompletionInterpretation {
  return {
    ok: false,
    code,
    message,
    rawResultExcerpt: boundRawResultExcerpt(finalMessage) ?? "",
  };
}

/**
 * Validates the untrusted final message. Anything malformed fails the run and
 * keeps only a bounded raw excerpt for diagnostics; nothing in it is executed.
 */
export function interpretMenuManagerReply(
  finalMessage: string,
  context: ValidationContext,
): CompletionInterpretation {
  let payload: unknown;
  try {
    payload = extractMenuManagerJson(finalMessage);
  } catch {
    return invalid("invalid_result_json", "The agent reply did not contain valid JSON.", finalMessage);
  }

  const parsed = menuManagerResultSchema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") || "reply";
    return invalid(
      "invalid_result_shape",
      `The agent reply did not match the QOS contract at ${path}.`,
      finalMessage,
    );
  }

  const result = parsed.data;
  if (result.menuPublicId !== context.menuPublicId) {
    return invalid("result_menu_mismatch", "The agent reply is for a different menu.", finalMessage);
  }

  const known = new Set(context.productPublicIds);
  const referenced = [
    ...result.findings.flatMap((entry) => entry.productPublicIds),
    ...result.suggestions.map((entry) => entry.productPublicId),
  ];
  if (referenced.some((id) => !known.has(id))) {
    return invalid(
      "unknown_product_reference",
      "The agent reply referenced products that were not in the snapshot.",
      finalMessage,
    );
  }

  const stored: StoredMenuManagerResult = {
    ...result,
    snapshot: { menuVersion: context.menuVersion, sha256: context.snapshotSha256 },
  };

  return {
    ok: true,
    result: stored,
    auditSummary: {
      findingCount: result.findings.length,
      suggestionCount: result.suggestions.length,
    },
  };
}
