import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("overview layout harness gating (QOS-150)", () => {
  const pageSource = readFileSync(
    path.join(process.cwd(), "src/app/dev/overview-layout-harness/page.tsx"),
    "utf8",
  );

  const clientSource = readFileSync(
    path.join(
      process.cwd(),
      "src/app/dev/overview-layout-harness/overview-layout-harness-client.tsx",
    ),
    "utf8",
  );

  it("returns notFound in production unless QOS_ENABLE_OVERVIEW_LAYOUT_HARNESS is set", () => {
    expect(pageSource).toContain('process.env.NODE_ENV !== "production"');
    expect(pageSource).toContain("QOS_ENABLE_OVERVIEW_LAYOUT_HARNESS");
    expect(pageSource).toContain("notFound()");
  });

  it("does not bypass harness gating when applying ?locale= on the client", () => {
    expect(clientSource).toContain("setStoredStaffLocale");
    expect(clientSource).not.toContain("harnessEnabled");
    expect(pageSource).toContain("OverviewLayoutHarnessClient");
  });
});
