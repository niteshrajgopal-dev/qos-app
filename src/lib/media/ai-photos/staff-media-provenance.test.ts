import { describe, expect, it } from "vitest";

import { toStaffGenerationView } from "@/lib/media/ai-photos/staff-media-provenance";

describe("staff media provenance views", () => {
  it("omits prompts for non-administrators", () => {
    const view = toStaffGenerationView(
      { schema: "qos.ai_photo_generation.v1", prompt: "secret", model: "gpt-image-1" },
      false,
    );
    expect(view).toMatchObject({ model: "gpt-image-1" });
    expect(view).not.toHaveProperty("prompt");
  });

  it("includes prompts for administrators", () => {
    const view = toStaffGenerationView({ prompt: "secret", model: "mock" }, true);
    expect(view.prompt).toBe("secret");
  });
});
