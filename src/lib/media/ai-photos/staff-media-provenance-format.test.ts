import { describe, expect, it } from "vitest";

import { formatStaffMediaGenerationSummary } from "@/lib/media/ai-photos/staff-media-provenance-format";

describe("formatStaffMediaGenerationSummary", () => {
  it("uses resolved staff labels instead of raw provider subjects", () => {
    const summary = formatStaffMediaGenerationSummary(
      {
        model: "gpt-image-1",
        requestedAt: "2026-01-01T12:00:00.000Z",
        requestedBySubject: "U5d7opaque",
        requestedByDisplayName: "chef@hbz.test",
      },
      "en",
    );
    expect(summary).toContain("gpt-image-1");
    expect(summary).toContain("chef@hbz.test");
    expect(summary).not.toContain("U5d7opaque");
  });

  it("falls back to a neutral staff label when the subject cannot be resolved", () => {
    const summary = formatStaffMediaGenerationSummary(
      {
        model: "gpt-image-1",
        requestedBySubject: "U5d7opaque",
      },
      "ar",
    );
    expect(summary).toContain("عضو الفريق");
    expect(summary).not.toContain("U5d7opaque");
  });
});
