import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Catalogue products imports", () => {
  it("catalogue-products-list.tsx does not import from @/mocks", () => {
    const filePath = resolve(
      __dirname,
      "../components/platform/catalogue-products-list.tsx",
    );
    const content = readFileSync(filePath, "utf-8");
    expect(content).not.toMatch(/from\s+["']@\/mocks/);
    expect(content).not.toMatch(/import.*@\/mocks/);
  });

  it("catalogue page does not import from @/mocks", () => {
    const filePath = resolve(
      __dirname,
      "../app/tenants/[tenantId]/catalogue/page.tsx",
    );
    const content = readFileSync(filePath, "utf-8");
    expect(content).not.toMatch(/from\s+["']@\/mocks/);
    expect(content).not.toMatch(/import.*@\/mocks/);
  });
});
