import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  PORTAL_OVERVIEW_STACKED_SHORT_MAX_HEIGHT_PX,
  PORTAL_OVERVIEW_STACKED_WIDE_MAX_HEIGHT_PX,
  parsePortalOverviewStackedShortMaxHeightFromCss,
  parsePortalOverviewStackedWideMaxHeightFromCss,
  portalOverviewCssDeclaresStackedRail,
} from "./overview-layout";

describe("portal overview layout CSS contract", () => {
  const css = readFileSync(
    path.join(process.cwd(), "src/app/qos-portal.css"),
    "utf8",
  );

  it("keeps short-viewport stacked max-height in sync with the TypeScript constant", () => {
    expect(parsePortalOverviewStackedShortMaxHeightFromCss(css)).toBe(
      PORTAL_OVERVIEW_STACKED_SHORT_MAX_HEIGHT_PX,
    );
  });

  it("keeps wide-viewport stacked max-height in sync with the TypeScript constant", () => {
    expect(parsePortalOverviewStackedWideMaxHeightFromCss(css)).toBe(
      PORTAL_OVERVIEW_STACKED_WIDE_MAX_HEIGHT_PX,
    );
  });

  it("declares stacked composition that removes absolute positioning from the rail", () => {
    expect(portalOverviewCssDeclaresStackedRail(css)).toBe(true);
  });

  it("does not use a blanket max-width stacked breakpoint", () => {
    expect(css).not.toMatch(
      /@media\s*\(\s*max-width:\s*1279px\s*\)\s*and\s*\(\s*min-width:\s*681px\s*\)/,
    );
  });
});
