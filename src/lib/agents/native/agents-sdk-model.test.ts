import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("Agents SDK model adapter", () => {
  const source = readFileSync(path.join(process.cwd(), "src/lib/agents/native/agents-sdk-model.ts"), "utf8");

  it("disables SDK tracing and OpenAI client retries", () => {
    expect(source).toContain("setTracingDisabled(true)");
    expect(source).toContain("maxRetries: 0");
    expect(source).toContain("store: false");
  });

  it("keeps SDK imports inside the adapter file", () => {
    expect(source).toContain('from "@openai/agents"');
    expect(source).toContain('from "openai"');
  });
});
