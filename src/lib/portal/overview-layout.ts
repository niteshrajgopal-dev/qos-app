/**
 * Stacked overview composition (see qos-portal.css) applies only on viewports where
 * the default absolute layout overlapped in baseline measurements.
 */
export const PORTAL_OVERVIEW_STACKED_SHORT_MAX_HEIGHT_PX = 801;

export const PORTAL_OVERVIEW_STACKED_WIDE_MIN_WIDTH_PX = 1600;

export const PORTAL_OVERVIEW_STACKED_WIDE_MAX_HEIGHT_PX = 900;

const STACKED_SHORT_VIEWPORT_MEDIA =
  /@media\s*\(\s*min-width:\s*681px\s*\)\s*and\s*\(\s*max-height:\s*(\d+)px\s*\)/;

const STACKED_WIDE_VIEWPORT_MEDIA =
  /@media[\s\S]*?\(\s*min-width:\s*1600px\s*\)\s*and\s*\(\s*max-height:\s*(\d+)px\s*\)/;

const STACKED_RAIL_RELATIVE =
  /@media \(min-width: 681px\)[\s\S]*?\.qosp-rail\s*\{[\s\S]*?position:\s*relative/;

export function parsePortalOverviewStackedShortMaxHeightFromCss(
  css: string,
): number | null {
  const match = css.match(STACKED_SHORT_VIEWPORT_MEDIA);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parsePortalOverviewStackedWideMaxHeightFromCss(
  css: string,
): number | null {
  const match = css.match(STACKED_WIDE_VIEWPORT_MEDIA);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function portalOverviewCssDeclaresStackedRail(css: string): boolean {
  return STACKED_RAIL_RELATIVE.test(css);
}
