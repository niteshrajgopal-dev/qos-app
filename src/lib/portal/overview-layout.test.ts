import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  PORTAL_OVERVIEW_LAYOUT_CHECK_WIDTHS_PX,
  PORTAL_OVERVIEW_STACKED_MAX_WIDTH_PX,
  portalOverviewAbsoluteCompositionRisk,
  portalOverviewUsesStackedLayout,
} from "./overview-layout";

describe("portal overview layout guard", () => {
  it("uses stacked composition at intermediate zoom widths that previously overlapped", () => {
    for (const width of [900, 853, 800, 731]) {
      expect(portalOverviewUsesStackedLayout(width)).toBe(true);
      expect(portalOverviewAbsoluteCompositionRisk(width)).toBe(false);
    }
  });

  it("keeps wide desktop composition above the stacked breakpoint", () => {
    for (const width of [1280, 1024]) {
      expect(portalOverviewUsesStackedLayout(width)).toBe(false);
      expect(portalOverviewAbsoluteCompositionRisk(width)).toBe(true);
    }
  });

  it("covers every regression viewport width in the layout check set", () => {
    for (const width of PORTAL_OVERVIEW_LAYOUT_CHECK_WIDTHS_PX) {
      const stacked = portalOverviewUsesStackedLayout(width);
      const absoluteRisk = portalOverviewAbsoluteCompositionRisk(width);
      expect(stacked).toBe(width <= PORTAL_OVERVIEW_STACKED_MAX_WIDTH_PX);
      expect(absoluteRisk).toBe(!stacked);
    }
  });

  it("ships CSS that stacks overview modules at the documented breakpoint", () => {
    const css = readFileSync(
      path.join(process.cwd(), "src/app/qos-portal.css"),
      "utf8",
    );
    expect(css).toContain("@media (max-width: 900px) and (min-width: 681px)");
    expect(css).toContain(".qosp-overview");
    expect(css).toContain("flex-direction: column");
  });
});
