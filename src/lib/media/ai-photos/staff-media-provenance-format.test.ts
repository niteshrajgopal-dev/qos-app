import { describe, expect, it } from "vitest";

import {
  formatStaffMediaGenerationSummary,
  formatStaffMediaSourceLabel,
  formatStaffMediaTimestamp,
} from "@/lib/media/ai-photos/staff-media-provenance-format";

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

  it("includes a timezone label on formatted timestamps", () => {
    const formatted = formatStaffMediaTimestamp("2026-06-15T09:30:00.000Z", "en");
    expect(formatted).toBeTruthy();
    expect(formatted).toMatch(/GMT|UTC|[A-Z]{2,5}/);
  });

  it("labels AI and uploaded photo sources for staff UI", () => {
    expect(formatStaffMediaSourceLabel("ai_generated", "en")).toBe("AI-generated");
    expect(formatStaffMediaSourceLabel("operator_entered", "en")).toBe("Uploaded");
    expect(formatStaffMediaSourceLabel("ai_generated", "ar")).toContain("الذكاء");
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
