import { describe, expect, it } from "vitest";

import {
  aliasOpenAiToolNames,
  openaiFunctionName,
  qosToolNameFromOpenAi,
} from "@/lib/agents/native/openai-tool-names";

describe("OpenAI tool name aliases", () => {
  it("maps dotted QOS tool names to OpenAI function names", () => {
    expect(openaiFunctionName("menu.get_health")).toBe("menu_get_health");
    expect(openaiFunctionName("menu_get_health")).toBe("menu_get_health");
    const aliases = aliasOpenAiToolNames(["menu.get_health", "menu.get_items"]);
    expect(aliases.toProvider.get("menu.get_health")).toBe("menu_get_health");
    expect(qosToolNameFromOpenAi("menu_get_health", aliases)).toBe("menu.get_health");
    expect(qosToolNameFromOpenAi("menu_get_items", aliases)).toBe("menu.get_items");
  });

  it("refuses two QOS names that collapse to the same OpenAI function name", () => {
    expect(() => aliasOpenAiToolNames(["menu.get_health", "menu_get_health"])).toThrow(/collided/);
  });
});
