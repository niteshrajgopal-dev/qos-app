import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/* QOS-200: applying master data never publishes a menu, approves a
   translation, approves a recipe version or posts stock. The apply engine and
   its handlers may not even reference those services. */

const ROOT = path.join(process.cwd(), "src/lib/workbook/apply");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

describe("apply boundaries", () => {
  it("imports no publication, translation approval, recipe approval or stock posting service", () => {
    const files = sources(ROOT);
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const imports = [...text.matchAll(/from "([^"]+)"/g)].map((match) => match[1]!);
      expect(imports.filter((module) => /menu-publish|translation-review|stock|ledger|movement|production|opening/i.test(module)), file).toEqual([]);
      expect(text, file).not.toMatch(/\bapproveVersion\b|\bpublishDraftMenu|\bapproveTranslation/);
    }
  });
});
