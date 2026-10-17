/**
 * Overview home uses absolute positioning for the Business Pulse rail and module
 * dock above ~900px. Narrower viewports (including browser zoom on a 1280px window)
 * switch to stacked composition so cards never overlap.
 */
export const PORTAL_OVERVIEW_STACKED_MAX_WIDTH_PX = 900;

export const PORTAL_OVERVIEW_LAYOUT_CHECK_WIDTHS_PX = [
  1280,
  1024,
  900,
  853,
  800,
  731,
  640,
  480,
  390,
  320,
] as const;

export function portalOverviewUsesStackedLayout(viewportWidthPx: number): boolean {
  return viewportWidthPx <= PORTAL_OVERVIEW_STACKED_MAX_WIDTH_PX;
}

/** Absolute rail + dock composition is only safe above the stacked breakpoint. */
export function portalOverviewAbsoluteCompositionRisk(
  viewportWidthPx: number,
): boolean {
  return viewportWidthPx > PORTAL_OVERVIEW_STACKED_MAX_WIDTH_PX;
}
