import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  PORTAL_OVERVIEW_STACK_BANDS,
  portalOverviewCssDeclaresStackedRail,
  portalOverviewCssIncludesStackBands,
} from "./overview-layout";

describe("portal overview layout CSS contract", () => {
  const css = readFileSync(
    path.join(process.cwd(), "src/app/qos-portal.css"),
    "utf8",
  );

  it("declares stacked composition that removes absolute positioning from the rail", () => {
    expect(portalOverviewCssDeclaresStackedRail(css)).toBe(true);
  });

  it("ships width-band stack thresholds derived from dense main measurements", () => {
    expect(portalOverviewCssIncludesStackBands(css)).toBe(true);
    expect(PORTAL_OVERVIEW_STACK_BANDS).toHaveLength(6);
  });

  it("does not use coarse grid-tuned single breakpoints (801px / 900px)", () => {
    expect(css).not.toMatch(/max-height:\s*801px/);
    expect(css).not.toMatch(/\(min-width: 1600px\) and \(max-height: 900px\)/);
  });
});
