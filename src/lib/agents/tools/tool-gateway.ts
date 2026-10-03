import type { z } from "zod";

import type { DbClient } from "@/db/client";
import { getAgentRun } from "@/lib/agents/agent-runs";
import type { AgentConfig } from "@/lib/agents/config";
import {
  buildAgentExecutionContext,
  type AgentExecutionContext,
  type ExecutionContextDenial,
} from "@/lib/agents/execution-context";
import { recordTenantAuditEventInTx } from "@/lib/audit/tenant-audit";
import { MenuError } from "@/lib/catalogue/menus";
import { StaffAuthorizationError } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

/** Where a tool's answer comes from: the input pinned at acceptance, or live QOS data. */
export type AgentToolDataSource = "accepted_snapshot" | "current";

export type AgentToolEvidence = {
  dataSource: AgentToolDataSource;
  /** Menu version the answer describes. */
  menuVersion: number | null;
  /** Menu version the run was accepted against. */
  acceptedMenuVersion: number | null;
  asOf: string;
  snapshotSha256: string | null;
};

/**
 * One versioned tool. Only read-only tools exist; chargeable or mutating tools
 * need a QOS operation identity first (ADR-AI-02 decision 12).
 */
export type AgentTool<I = unknown, O = unknown> = {
  readonly name: string;
  readonly version: string;
  readonly risk: "read_only";
  readonly dataSource: AgentToolDataSource;
  readonly timeoutMs: number;
  readonly input: z.ZodType<I>;
  readonly output: z.ZodType<O>;
  execute(
    db: DbClient,
    context: AgentExecutionContext,
    input: I,
  ): Promise<{ output: O; evidence: Omit<AgentToolEvidence, "dataSource"> }>;
};

export function defineAgentTool<I, O>(tool: AgentTool<I, O>): AgentTool {
  return Object.freeze(tool) as unknown as AgentTool;
}

/** Raised by a tool for an expected refusal; the code is model-visible. */
export class AgentToolError extends Error {
  constructor(
    readonly code: "out_of_scope" | "input_unavailable" | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "AgentToolError";
  }
}

export type AgentToolFailureCode =
  | ExecutionContextDenial
  | "run_not_active"
  | "unknown_tool"
  | "tool_not_allowed"
  | "tool_version_unavailable"
  | "invalid_input"
  | "access_denied"
  | "out_of_scope"
  | "input_unavailable"
  | "not_found"
  | "tool_timeout"
  | "invalid_output"
  | "tool_failed";

export type AgentToolResult =
  | { ok: true; tool: string; version: string; output: unknown; evidence: AgentToolEvidence }
  | { ok: false; tool: string; code: AgentToolFailureCode; message: string };

const MAX_TOOL_INPUT_CHARS = 16_384;
const TOOL_ACTOR = { subject: "qos.agent-runtime", actorClass: "system" as const };

const FAILURE_MESSAGES: Record<AgentToolFailureCode, string> = {
  capability_unavailable: "This agent capability is turned off.",
  tenant_inactive: "This business is not active.",
  binding_changed: "This agent is no longer approved for this business.",
  requester_access_revoked: "The person who requested this run no longer has access.",
  subject_unavailable: "The menu for this run is no longer available.",
  run_not_active: "This run is not running.",
  unknown_tool: "No such tool.",
  tool_not_allowed: "This run may not use this tool.",
  tool_version_unavailable: "This run was accepted with a tool version that is not available.",
  invalid_input: "The tool input is invalid.",
  access_denied: "Access to this data is not allowed.",
  out_of_scope: "Only products accepted for this run may be requested.",
  input_unavailable: "The accepted input for this run is unavailable.",
  not_found: "Not found.",
  tool_timeout: "The tool did not finish in time.",
  invalid_output: "The tool produced an invalid result.",
  tool_failed: "The tool failed.",
};

class ToolTimeout extends Error {}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ToolTimeout()), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function failureCodeFor(error: unknown): AgentToolFailureCode | null {
  if (error instanceof ToolTimeout) return "tool_timeout";
  if (error instanceof AgentToolError) return error.code;
  if (error instanceof StaffAuthorizationError) return "access_denied";
  if (error instanceof MenuError) return error.statusCode === 404 ? "not_found" : "access_denied";
  return null;
}

/**
 * The single entry point for agent tool calls. Rebuilds the trusted execution
 * context from the persisted run and live state on every call, allows only
 * tools pinned on the run at their pinned version, validates input and output,
 * bounds execution time and audits the call without its payloads. Product IDs
 * in the input are selectors within the accepted scope, never grants.
 */
export async function invokeAgentTool(
  db: DbClient,
  request: { tenantId: string; runPublicId: string; tool: string; input: unknown },
  options: { config: AgentConfig; registry: ReadonlyMap<string, AgentTool>; now?: () => number },
): Promise<AgentToolResult> {
  const clock = options.now ?? Date.now;
  const started = clock();
  const run = await getAgentRun(db, request.tenantId, request.runPublicId);
  const tool = options.registry.get(request.tool);

  const finish = async (
    result: AgentToolResult,
    detail: { menuVersion?: number | null } = {},
  ): Promise<AgentToolResult> => {
    await withTenantContext(db, request.tenantId, (tx) =>
      recordTenantAuditEventInTx(tx, {
        tenantId: request.tenantId,
        actorSubject: TOOL_ACTOR.subject,
        actorClass: TOOL_ACTOR.actorClass,
        action: "agent_tool.invoked",
        entityType: "agent_run",
        entityPublicId: run.publicId,
        correlationId: run.correlationId,
        changeSummary: {
          tool: request.tool.slice(0, 100),
          version: tool?.version ?? null,
          dataSource: tool?.dataSource ?? null,
          outcome: result.ok ? "ok" : result.code,
          durationMs: clock() - started,
          ...(detail.menuVersion !== undefined ? { menuVersion: detail.menuVersion } : {}),
        },
      }),
    );
    return result;
  };
  const fail = (code: AgentToolFailureCode) =>
    finish({ ok: false, tool: request.tool, code, message: FAILURE_MESSAGES[code] });

  if (run.status !== "running") {
    return fail("run_not_active");
  }
  const built = await buildAgentExecutionContext(db, request.tenantId, run, { config: options.config });
  if (!built.ok) {
    return fail(built.reason);
  }
  if (!tool) {
    return fail("unknown_tool");
  }
  const pinnedVersion = built.context.tools[tool.name];
  if (pinnedVersion === undefined) {
    return fail("tool_not_allowed");
  }
  if (pinnedVersion !== tool.version) {
    return fail("tool_version_unavailable");
  }

  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(request.input ?? {});
  } catch {
    serialized = undefined;
  }
  if (serialized === undefined || serialized.length > MAX_TOOL_INPUT_CHARS) {
    return fail("invalid_input");
  }
  const input = tool.input.safeParse(request.input ?? {});
  if (!input.success) {
    return fail("invalid_input");
  }

  let executed: Awaited<ReturnType<AgentTool["execute"]>>;
  try {
    executed = await withTimeout(tool.execute(db, built.context, input.data), tool.timeoutMs);
  } catch (error) {
    const code = failureCodeFor(error);
    if (code) {
      return fail(code);
    }
    await fail("tool_failed");
    throw error;
  }

  const output = tool.output.safeParse(executed.output);
  if (!output.success) {
    return fail("invalid_output");
  }
  return finish(
    {
      ok: true,
      tool: tool.name,
      version: tool.version,
      output: output.data,
      evidence: { dataSource: tool.dataSource, ...executed.evidence },
    },
    { menuVersion: executed.evidence.menuVersion },
  );
}
