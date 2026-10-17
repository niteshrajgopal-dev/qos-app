/**
 * Width-band stacked-overview breakpoints derived from dense Playwright
 * measurements against origin/main CSS (see measurements.md).
 */
export const PORTAL_OVERVIEW_STACK_BANDS = [
  { minWidth: 681, maxWidth: 767, maxHeight: 874 },
  { minWidth: 768, maxWidth: 959, maxHeight: 874 },
  { minWidth: 960, maxWidth: 1023, maxHeight: 874 },
  { minWidth: 1024, maxWidth: 1180, maxHeight: 849 },
  { minWidth: 1181, maxWidth: 1599, maxHeight: 874 },
  { minWidth: 1600, maxWidth: null, maxHeight: 974 },
] as const;

const STACKED_RAIL_RELATIVE =
  /@media \(min-width: 681px\)[\s\S]*?\.qosp-rail\s*\{[\s\S]*?position:\s*relative/;

export function portalOverviewCssDeclaresStackedRail(css: string): boolean {
  return STACKED_RAIL_RELATIVE.test(css);
}

export function portalOverviewCssIncludesStackBands(css: string): boolean {
  return PORTAL_OVERVIEW_STACK_BANDS.every(
    (band) =>
      css.includes(`min-width: ${band.minWidth}px`) &&
      (band.maxWidth == null ||
        css.includes(`max-width: ${band.maxWidth}px`)) &&
      css.includes(`max-height: ${band.maxHeight}px`),
  );
}
