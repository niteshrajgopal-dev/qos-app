import { z } from "zod";

import { loadPinnedRunInput } from "@/lib/agents/agent-runs";
import { AgentToolError, defineAgentTool } from "@/lib/agents/tools/tool-gateway";
import { loadMenuFacts } from "@/lib/catalogue/menu-facts";
import { computeMenuHealth, MENU_HEALTH_ISSUE_TYPES } from "@/lib/catalogue/menu-health";
import {
  MENU_SNAPSHOT_MAX_PRODUCTS,
  MENU_SNAPSHOT_SCHEMA,
  type MenuSnapshot,
} from "@/lib/catalogue/menu-snapshot";
import { assertMenuLocationAccess, MenuError } from "@/lib/catalogue/menus";
import { withTenantContext } from "@/lib/tenant/context";

const publicId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const issueType = z.enum(MENU_HEALTH_ISSUE_TYPES);
const MAX_ITEMS_PER_CALL = 25;

const healthOutput = z.strictObject({
  menuPublicId: publicId,
  menuVersion: z.number().int(),
  evaluatedAt: z.string(),
  issueCounts: z.partialRecord(issueType, z.number().int().nonnegative()),
  products: z
    .array(z.strictObject({ productPublicId: publicId, issues: z.array(issueType) }))
    .max(MENU_SNAPSHOT_MAX_PRODUCTS),
  /** Accepted products that are no longer on the menu. */
  productsNoLongerOnMenu: z.array(publicId).max(MENU_SNAPSHOT_MAX_PRODUCTS),
});

/**
 * Current health of the accepted products, evaluated now with the requester's
 * live access. Issue types only: no staff-written free text.
 */
export const menuGetHealthTool = defineAgentTool({
  name: "menu.get_health",
  version: "menu.get_health.v1",
  risk: "read_only",
  dataSource: "current",
  timeoutMs: 10_000,
  input: z.strictObject({}),
  output: healthOutput,
  async execute(db, context) {
    const facts = await withTenantContext(db, context.tenantId, async (tx) => {
      await assertMenuLocationAccess(tx, context.tenantId, context.requester.membership, context.scope.menuPublicId);
      return loadMenuFacts(tx, context.tenantId, context.scope.menuPublicId);
    });
    if (!facts) {
      throw new MenuError("Menu not found.", 404);
    }
    const health = computeMenuHealth(facts);
    const accepted = new Set(context.scope.productPublicIds);
    const products = health.products
      .filter((product) => accepted.has(product.productPublicId))
      .map((product) => ({
        productPublicId: product.productPublicId,
        issues: [...new Set(product.issues.map((issue) => issue.type))],
      }));
    const onMenu = new Set(products.map((product) => product.productPublicId));
    const issueCounts: Partial<Record<(typeof MENU_HEALTH_ISSUE_TYPES)[number], number>> = {};
    for (const product of products) {
      for (const issue of product.issues) {
        issueCounts[issue] = (issueCounts[issue] ?? 0) + 1;
      }
    }
    return {
      output: {
        menuPublicId: facts.menuPublicId,
        menuVersion: facts.menuVersion,
        evaluatedAt: health.evaluatedAt,
        issueCounts,
        products,
        productsNoLongerOnMenu: context.scope.productPublicIds.filter((id) => !onMenu.has(id)),
      },
      evidence: {
        menuVersion: facts.menuVersion,
        acceptedMenuVersion: context.scope.acceptedMenuVersion,
        asOf: health.evaluatedAt,
        snapshotSha256: null,
      },
    };
  },
});

const snapshotText = z.strictObject({ name: z.string().max(200), description: z.string().max(600).nullable() });
const snapshotProduct = z.strictObject({
  productPublicId: publicId,
  internalName: z.string().max(200),
  status: z.string(),
  sectionPublicIds: z.array(publicId),
  en: snapshotText.nullable(),
  ar: snapshotText.extend({ approvalStatus: z.string() }).nullable(),
  hasApprovedPhoto: z.boolean(),
  categoryCount: z.number().int().nonnegative(),
  variants: z.array(
    z.strictObject({
      variantPublicId: publicId,
      isDefault: z.boolean(),
      prices: z.array(z.strictObject({ currency: z.string(), amountMinor: z.number().int() })),
    }),
  ),
  modifierGroups: z.array(
    z.strictObject({
      modifierGroupPublicId: publicId,
      name: z.string().max(200),
      minSelections: z.number().int(),
      maxSelections: z.number().int().nullable(),
      activeOptionCount: z.number().int(),
    }),
  ),
  availability: z.array(
    z.strictObject({ locationPublicId: publicId, available: z.boolean(), reason: z.string().nullable() }),
  ),
  healthIssues: z.array(issueType),
});

/**
 * Accepted-snapshot detail for selected products. Reads only the run's pinned,
 * checksum-verified input; never live data and never products outside it.
 */
export const menuGetItemsTool = defineAgentTool({
  name: "menu.get_items",
  version: "menu.get_items.v1",
  risk: "read_only",
  dataSource: "accepted_snapshot",
  timeoutMs: 5_000,
  input: z.strictObject({
    productPublicIds: z.array(publicId).min(1).max(MAX_ITEMS_PER_CALL),
  }),
  output: z.strictObject({
    menuPublicId: publicId,
    products: z.array(snapshotProduct).max(MAX_ITEMS_PER_CALL),
  }),
  async execute(db, context, input) {
    const accepted = new Set(context.scope.productPublicIds);
    const requested = [...new Set(input.productPublicIds)];
    if (requested.some((id) => !accepted.has(id))) {
      throw new AgentToolError("out_of_scope", "Only products accepted for this run may be requested.");
    }
    const pinned = await loadPinnedRunInput(db, context.tenantId, context.run.id);
    if (!pinned.ok || pinned.schema !== MENU_SNAPSHOT_SCHEMA) {
      throw new AgentToolError("input_unavailable", "The accepted input for this run is unavailable.");
    }
    const snapshot = JSON.parse(pinned.payload) as MenuSnapshot;
    const byId = new Map(snapshot.products.map((product) => [product.productPublicId, product]));
    return {
      output: {
        menuPublicId: snapshot.menu.menuPublicId,
        products: requested.flatMap((id) => {
          const product = byId.get(id);
          return product ? [product] : [];
        }),
      },
      evidence: {
        menuVersion: snapshot.menu.version,
        acceptedMenuVersion: context.scope.acceptedMenuVersion,
        asOf: snapshot.generatedAt,
        snapshotSha256: pinned.sha256,
      },
    };
  },
});

/** Every tool QOS can execute. A run may call only those pinned in its config. */
export const AGENT_TOOLS: ReadonlyMap<string, ReturnType<typeof defineAgentTool>> = new Map(
  [menuGetHealthTool, menuGetItemsTool].map((tool) => [tool.name, tool]),
);
