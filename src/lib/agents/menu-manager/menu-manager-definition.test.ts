import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  CURRENT_MENU_MANAGER_DEFINITION,
  getMenuManagerDefinition,
  MENU_MANAGER_DEFINITION_KEY,
} from "@/lib/agents/menu-manager/menu-manager-definition";
import { menuManagerResultSchema } from "@/lib/agents/menu-manager/menu-manager-result";
import type { MenuFacts, MenuProductFacts } from "@/lib/catalogue/menu-facts";
import { computeMenuHealth } from "@/lib/catalogue/menu-health";
import { buildMenuSnapshot } from "@/lib/catalogue/menu-snapshot";

const LOCATION_UUID = "3a8f1c2e-5b6d-4e7f-8a9b-0c1d2e3f4a5b";

function product(publicId: string): MenuProductFacts {
  return {
    productPublicId: publicId,
    internalName: publicId,
    status: "active",
    sectionPublicIds: ["sec_coffee"],
    translations: [
      {
        locale: "en",
        displayName: `Name ${publicId}`,
        description: `Description ${publicId}`,
        approvalStatus: "approved",
        translationVersion: 1,
        approvedSourceTranslationVersion: null,
      },
    ],
    thumbnailPublicId: null,
    categoryCount: 1,
    activeVariants: [
      { publicId: `var_${publicId}`, isDefault: true, prices: [{ currency: "AED", amountMinor: 1800 }] },
    ],
    modifierGroups: [],
    eligibilityByLocation: {
      loc_marina: {
        available: true,
        reason: null,
        source: null,
        stopSaleReason: null,
        stopSaleExpiresAt: null,
      },
    },
  } as MenuProductFacts;
}

function fixtureSnapshot() {
  const facts: MenuFacts = {
    menuPublicId: "men_breakfast",
    menuVersion: 4,
    displayName: "Breakfast",
    sectionCount: 1,
    locationIds: [LOCATION_UUID],
    locations: [{ id: LOCATION_UUID, publicId: "loc_marina", name: "Marina" }],
    products: [product("prd_latte"), product("prd_flat")],
    evaluatedAt: new Date("2026-09-30T10:00:00Z"),
  };
  return buildMenuSnapshot(facts, computeMenuHealth(facts), {}).snapshot;
}

const CONTEXT = {
  menuPublicId: "men_breakfast",
  productPublicIds: ["prd_latte", "prd_flat"],
  menuVersion: 4,
  snapshotSha256: "a".repeat(64),
};

const REPLIES = [
  JSON.stringify({
    schema: "qos.menu_manager_result.v1",
    menuPublicId: "men_breakfast",
    summary: "Two products need photos.",
    findings: [
      {
        type: "missing_photo",
        severity: "warning",
        title: "Missing photos",
        detail: "No approved photo.",
        recommendation: "Upload photos.",
        productPublicIds: ["prd_latte", "prd_unknown"],
      },
    ],
    suggestions: [],
  }),
  "not json",
  JSON.stringify({ schema: "qos.menu_manager_result.v1", menuPublicId: "men_other", summary: "", findings: [], suggestions: [] }),
];

function fingerprint() {
  const definition = CURRENT_MENU_MANAGER_DEFINITION;
  const contract = {
    key: definition.key,
    version: definition.version,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    allowedTools: definition.allowedTools,
    limits: definition.limits,
    resultJsonSchema: z.toJSONSchema(menuManagerResultSchema),
    request: definition.buildRequest(fixtureSnapshot()),
    replies: REPLIES.map((reply) => definition.interpretReply(reply, CONTEXT)),
  };
  return createHash("sha256").update(JSON.stringify(contract)).digest("hex");
}

describe("Menu Manager definition", () => {
  // If this fails, the instructions, contract, tools or limits changed. Register
  // the change as a new version and keep the old one while runs pinned to it
  // can still be active; do not just update the expected hash.
  it("menu_manager.v1 behaves exactly as when it was pinned", () => {
    expect(CURRENT_MENU_MANAGER_DEFINITION.version).toBe("menu_manager.v1");
    expect(fingerprint()).toBe("8e14a474c6e3acd06f6e0387e20d39c093dc66c17b528ad0f5ff08633a0b80ca");
  });

  it("resolves pinned versions and never substitutes an unknown one", () => {
    expect(getMenuManagerDefinition("menu_manager.v1")).toBe(CURRENT_MENU_MANAGER_DEFINITION);
    expect(getMenuManagerDefinition(null)).toBe(CURRENT_MENU_MANAGER_DEFINITION);
    expect(getMenuManagerDefinition("menu_manager.v2")?.allowedTools).toEqual([
      "menu.get_health",
      "menu.get_items",
    ]);
    expect(getMenuManagerDefinition("menu_manager.v999")).toBeNull();
  });

  it("is frozen and grants no tools", () => {
    const definition = CURRENT_MENU_MANAGER_DEFINITION;
    expect(definition.key).toBe(MENU_MANAGER_DEFINITION_KEY);
    expect(definition.allowedTools).toEqual([]);
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.allowedTools)).toBe(true);
    expect(Object.isFrozen(definition.limits)).toBe(true);
  });
});
