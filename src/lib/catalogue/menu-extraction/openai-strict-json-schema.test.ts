import { describe, expect, it } from "vitest";

import {
  assertOpenAiStrictJsonSchema,
  toOpenAiStrictJsonSchema,
} from "@/lib/catalogue/menu-extraction/openai-strict-json-schema";
import { menuExtractionResultJsonSchema } from "@/lib/catalogue/menu-extraction/result";

describe("OpenAI strict menu extraction schema", () => {
  it("removes anyOf and satisfies OpenAI strict object rules", () => {
    const schema = menuExtractionResultJsonSchema();
    const serialized = JSON.stringify(schema);
    expect(serialized.includes("anyOf")).toBe(false);
    expect(serialized.includes("oneOf")).toBe(false);
    assertOpenAiStrictJsonSchema(schema);
  });

  it("normalizes nullable Zod fields to type unions", () => {
    const strict = toOpenAiStrictJsonSchema({
      type: "object",
      properties: {
        label: {
          anyOf: [{ type: "string", maxLength: 10 }, { type: "null" }],
        },
      },
      required: ["label"],
      additionalProperties: false,
    });
    expect(strict.properties).toMatchObject({
      label: { type: ["string", "null"], maxLength: 10 },
    });
  });
});
