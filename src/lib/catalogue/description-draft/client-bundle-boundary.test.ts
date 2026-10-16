import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const CLIENT_FILES = [
  "src/app/tenants/[tenantId]/catalogue/products/product-editor.tsx",
  "src/app/tenants/[tenantId]/catalogue/products/ai-description-review.tsx",
];

const SECRET_PATTERN = /\b(OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY)\b/;

describe("description draft client bundles", () => {
  it("does not embed provider credential env names", () => {
    for (const relative of CLIENT_FILES) {
      const source = readFileSync(path.join(process.cwd(), relative), "utf8");
      expect(SECRET_PATTERN.test(source), relative).toBe(false);
    }
  });
});
