import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/* QOS-192: Phase 2 entry pages and the branch context UI render only server
   data or honest empty states. None of them may read the Phase 1 mock data or
   the prototype's sample stores. */
const SURFACES = [
  "../app/tenants/[tenantId]/inventory/page.tsx",
  "../app/tenants/[tenantId]/inventory/inventory-screen.tsx",
  "../app/tenants/[tenantId]/inventory/inventory-client.ts",
  "../app/tenants/[tenantId]/inventory/unit-editor.tsx",
  "../app/tenants/[tenantId]/inventory/item-editor.tsx",
  "../app/tenants/[tenantId]/inventory/item-conversions-panel.tsx",
  "../app/tenants/[tenantId]/inventory/conversion-preview-panel.tsx",
  "../lib/inventory/conversion-preview.ts",
  "../app/tenants/[tenantId]/kitchen/page.tsx",
  "../app/tenants/[tenantId]/sales/page.tsx",
  "../app/tenants/[tenantId]/reports/page.tsx",
  "../app/tenants/[tenantId]/catalogue/recipes/page.tsx",
  "../app/tenants/[tenantId]/settings/branches/page.tsx",
  "../app/tenants/[tenantId]/settings/branches/branches-settings-screen.tsx",
  "../components/staff/phase2-entry-screen.tsx",
  "../components/staff/branch-change-guard.tsx",
  "../components/staff/StaffAppShell.tsx",
  "../components/portal/PortalTopBar.tsx",
  "../lib/staff/branch-selection.ts",
  "../lib/staff/branch-context.ts",
  "../lib/staff/branch-context-client.ts",
  "../lib/staff/branch-change-guard-state.ts",
];

describe("Phase 2 entry surfaces use real data only", () => {
  for (const relative of SURFACES) {
    it(`${relative} does not import mocks, fixtures or prototype stores`, () => {
      const content = readFileSync(resolve(__dirname, relative), "utf-8");
      expect(content).not.toMatch(/from\s+["']@\/mocks/);
      expect(content).not.toMatch(/import.*@\/mocks/);
      expect(content).not.toMatch(/fixtures/);
      expect(content).not.toMatch(/qos-phase2-v1|useP2\(|sampleP2/);
      expect(content).not.toMatch(/SampleDataNotice/);
    });
  }
});
