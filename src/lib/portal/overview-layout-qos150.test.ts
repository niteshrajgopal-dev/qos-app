import { describe, expect, it } from "vitest";

import {
  QOS150_PROBE_HEIGHTS,
  QOS150_PROBE_WIDTHS,
  ZOOM_VIEWPORTS,
  qos150ViewportList,
} from "../../../scripts/overview-layout-probe.mjs";

describe("QOS-150 overview overlap probe grid", () => {
  it("includes narrow widths, two heights, and zoom cells", () => {
    expect(QOS150_PROBE_WIDTHS).toEqual([
      360, 390, 414, 600, 768, 900, 1024,
    ]);
    expect(QOS150_PROBE_HEIGHTS).toEqual([600, 800]);
    const list = qos150ViewportList();
    expect(list).toHaveLength(
      QOS150_PROBE_WIDTHS.length * QOS150_PROBE_HEIGHTS.length +
        ZOOM_VIEWPORTS.length,
    );
  });
});
