import type { CompletionInterpretation } from "@/lib/agents/agent-runs";
import { buildMenuManagerRequest } from "@/lib/agents/menu-manager/menu-manager-request";
import {
  interpretMenuManagerReply,
  MENU_MANAGER_LIMITS,
  MENU_MANAGER_RESULT_SCHEMA,
  type MenuManagerReplyContext,
} from "@/lib/agents/menu-manager/menu-manager-result";
import {
  MENU_SNAPSHOT_MAX_PRODUCTS,
  MENU_SNAPSHOT_SCHEMA,
  type MenuSnapshot,
} from "@/lib/catalogue/menu-snapshot";

export const MENU_MANAGER_DEFINITION_KEY = "menu_manager";

/**
 * One immutable version of the Menu Manager. Any change to its instructions,
 * input or output contract, tools or limits is a new version; earlier versions
 * stay registered while runs pinned to them may still be active.
 */
export type MenuManagerDefinition = {
  readonly key: typeof MENU_MANAGER_DEFINITION_KEY;
  readonly version: string;
  readonly inputSchema: string;
  readonly outputSchema: string;
  /** Tool names the agent may call through the QOS tool gateway. */
  readonly allowedTools: readonly string[];
  readonly limits: {
    readonly maxProducts: number;
    readonly reply: typeof MENU_MANAGER_LIMITS;
  };
  buildRequest(snapshot: MenuSnapshot): string;
  interpretReply(finalMessage: string, context: MenuManagerReplyContext): CompletionInterpretation;
};

const MENU_MANAGER_V1: MenuManagerDefinition = Object.freeze({
  key: MENU_MANAGER_DEFINITION_KEY,
  version: "menu_manager.v1",
  inputSchema: MENU_SNAPSHOT_SCHEMA,
  outputSchema: MENU_MANAGER_RESULT_SCHEMA,
  allowedTools: Object.freeze([]),
  limits: Object.freeze({ maxProducts: MENU_SNAPSHOT_MAX_PRODUCTS, reply: MENU_MANAGER_LIMITS }),
  buildRequest: buildMenuManagerRequest,
  interpretReply: interpretMenuManagerReply,
});

const MENU_MANAGER_V2: MenuManagerDefinition = Object.freeze({
  key: MENU_MANAGER_DEFINITION_KEY,
  version: "menu_manager.v2",
  inputSchema: MENU_SNAPSHOT_SCHEMA,
  outputSchema: MENU_MANAGER_RESULT_SCHEMA,
  allowedTools: Object.freeze(["menu.get_health", "menu.get_items"]),
  limits: Object.freeze({ maxProducts: MENU_SNAPSHOT_MAX_PRODUCTS, reply: MENU_MANAGER_LIMITS }),
  buildRequest: buildMenuManagerRequest,
  interpretReply: interpretMenuManagerReply,
});

const DEFINITIONS: ReadonlyMap<string, MenuManagerDefinition> = new Map([
  [MENU_MANAGER_V1.version, MENU_MANAGER_V1],
  [MENU_MANAGER_V2.version, MENU_MANAGER_V2],
]);

/** Pinned on every new Hyperagent run. Native admissions pin v2. */
export const CURRENT_MENU_MANAGER_DEFINITION = MENU_MANAGER_V1;
export const NATIVE_MENU_MANAGER_DEFINITION = MENU_MANAGER_V2;
export const NATIVE_MENU_MANAGER_DEFINITION_VERSION = MENU_MANAGER_V2.version;

/**
 * Resolves a run's pinned definition. Runs created before pinning (version
 * `null`) were built and validated by what is now v1. Returns null for a
 * version this build does not have; callers must stop rather than substitute.
 */
export function getMenuManagerDefinition(version: string | null): MenuManagerDefinition | null {
  if (version === null) {
    return MENU_MANAGER_V1;
  }
  return DEFINITIONS.get(version) ?? null;
}
