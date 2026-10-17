/**
 * Overview home stacks Business Pulse and the module dock below this width (and on
 * short viewports — see qos-portal.css) so absolutely positioned panels never overlap.
 */
export const PORTAL_OVERVIEW_STACKED_MAX_WIDTH_PX = 1279;

export const PORTAL_OVERVIEW_STACKED_MAX_HEIGHT_PX = 950;

const STACKED_OVERVIEW_MEDIA =
  /@media\s*\(\s*max-width:\s*(\d+)px\s*\)\s*and\s*\(\s*min-width:\s*681px\s*\)/;

const STACKED_RAIL_RELATIVE =
  /@media \(max-width: 1279px\)[\s\S]*?\.qosp-rail\s*\{[\s\S]*?position:\s*relative/;

/** Parse the max-width from the stacked-overview media query in qos-portal.css. */
export function parsePortalOverviewStackedMaxWidthFromCss(css: string): number | null {
  const match = css.match(STACKED_OVERVIEW_MEDIA);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** True when the CSS ships stacked rules that take the rail out of absolute positioning. */
export function portalOverviewCssDeclaresStackedRail(css: string): boolean {
  return STACKED_RAIL_RELATIVE.test(css);
}

export function portalOverviewUsesStackedLayout(viewportWidthPx: number): boolean {
  return viewportWidthPx <= PORTAL_OVERVIEW_STACKED_MAX_WIDTH_PX;
}
