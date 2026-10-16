import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const CLIENT_FILES = [
  "src/app/tenants/[tenantId]/catalogue/menu-extraction/menu-extraction-review.tsx",
];

const SECRET_PATTERN = /\b(OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY)\b/;

describe("menu extraction client bundles", () => {
  it("does not embed provider credential env names", () => {
    for (const relative of CLIENT_FILES) {
      const source = readFileSync(path.join(process.cwd(), relative), "utf8");
      expect(SECRET_PATTERN.test(source), relative).toBe(false);
    }
  });
});
