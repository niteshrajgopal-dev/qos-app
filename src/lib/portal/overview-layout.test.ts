import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  PORTAL_OVERVIEW_STACKED_MAX_WIDTH_PX,
  parsePortalOverviewStackedMaxWidthFromCss,
  portalOverviewCssDeclaresStackedRail,
  portalOverviewUsesStackedLayout,
} from "./overview-layout";

describe("portal overview layout CSS contract", () => {
  const css = readFileSync(
    path.join(process.cwd(), "src/app/qos-portal.css"),
    "utf8",
  );

  it("keeps the stacked breakpoint in sync with the TypeScript constant", () => {
    expect(parsePortalOverviewStackedMaxWidthFromCss(css)).toBe(
      PORTAL_OVERVIEW_STACKED_MAX_WIDTH_PX,
    );
  });

  it("declares stacked composition that removes absolute positioning from the rail", () => {
    expect(portalOverviewCssDeclaresStackedRail(css)).toBe(true);
  });

  it("treats zoom-prone widths as stacked (e.g. 1280px at 125% → 1024px)", () => {
    expect(portalOverviewUsesStackedLayout(1024)).toBe(true);
    expect(portalOverviewUsesStackedLayout(1280)).toBe(false);
  });
});
