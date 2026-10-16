import { describe, expect, it } from "vitest";

import { diffDescriptionLines } from "@/lib/catalogue/description-draft/description-diff";

describe("diffDescriptionLines", () => {
  it("marks added and removed lines", () => {
    const diff = diffDescriptionLines("Line one\nOld line", "Line one\nNew line");
    expect(diff).toEqual([
      { kind: "unchanged", text: "Line one" },
      { kind: "removed", text: "Old line" },
      { kind: "added", text: "New line" },
    ]);
  });
});
