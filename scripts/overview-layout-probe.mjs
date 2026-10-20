/** Shared QOS-150 / QOS-149 viewport grids for overlap probes (no Playwright). */

export const ZOOM_VIEWPORTS = [
  { width: 853, height: 533, tag: "1280@150%" },
  { width: 731, height: 457, tag: "1280@175%" },
  { width: 960, height: 600, tag: "1440@150%" },
  { width: 823, height: 514, tag: "1440@175%" },
];

export const QOS150_PROBE_WIDTHS = [360, 390, 414, 600, 768, 900, 1024];
export const QOS150_PROBE_HEIGHTS = [600, 800];

export function qos150ViewportList() {
  const list = [];
  for (const width of QOS150_PROBE_WIDTHS) {
    for (const height of QOS150_PROBE_HEIGHTS) {
      list.push({ width, height });
    }
  }
  for (const zoom of ZOOM_VIEWPORTS) {
    list.push({ width: zoom.width, height: zoom.height, tag: zoom.tag });
  }
  return list;
}
