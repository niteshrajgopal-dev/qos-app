import { describe, expect, it } from "vitest";

import {
  AGENT_OPENAI_TASK_MODEL_ALLOWLIST_ENV,
  approvedOpenAiModelForTask,
  readOpenAiTaskModelAllowlist,
} from "@/lib/agents/native/openai-task-allowlist";

describe("OpenAI task model allowlist", () => {
  it("returns an empty allowlist when unset", () => {
    expect(readOpenAiTaskModelAllowlist({})).toEqual(new Map());
    expect(approvedOpenAiModelForTask("menu_manager.native", {})).toBeNull();
  });

  it("parses explicit task=model pairs", () => {
    const allowlist = readOpenAiTaskModelAllowlist({
      [AGENT_OPENAI_TASK_MODEL_ALLOWLIST_ENV]: "menu_manager.native=gpt-4.1-mini,ai_photo.async=gpt-image-1",
    });
    expect(allowlist.get("menu_manager.native")).toBe("gpt-4.1-mini");
    expect(allowlist.get("ai_photo.async")).toBe("gpt-image-1");
    expect(allowlist.get("catalogue.translation")).toBeUndefined();
  });

  it("parses catalogue.translation when configured", () => {
    const allowlist = readOpenAiTaskModelAllowlist({
      [AGENT_OPENAI_TASK_MODEL_ALLOWLIST_ENV]: "catalogue.translation=gpt-4.1-mini",
    });
    expect(allowlist.get("catalogue.translation")).toBe("gpt-4.1-mini");
  });

  it("parses catalogue.description when configured", () => {
    const allowlist = readOpenAiTaskModelAllowlist({
      [AGENT_OPENAI_TASK_MODEL_ALLOWLIST_ENV]: "catalogue.description=gpt-4.1-mini",
    });
    expect(allowlist.get("catalogue.description")).toBe("gpt-4.1-mini");
  });

  it("rejects tenant-style model ids and duplicate tasks", () => {
    expect(() =>
      readOpenAiTaskModelAllowlist({
        [AGENT_OPENAI_TASK_MODEL_ALLOWLIST_ENV]: "menu_manager.native=GPT-4o",
      }),
    ).toThrow("lowercase");
    expect(() =>
      readOpenAiTaskModelAllowlist({
        [AGENT_OPENAI_TASK_MODEL_ALLOWLIST_ENV]:
          "menu_manager.native=gpt-4.1-mini,menu_manager.native=gpt-4.1",
      }),
    ).toThrow("more than once");
  });
});
