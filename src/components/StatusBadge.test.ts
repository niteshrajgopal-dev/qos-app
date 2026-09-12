import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { qosStateFromDb } from "./map-db-status";
import { StatusBadge } from "./StatusBadge";

function render(state: string, label?: string) {
  return renderToStaticMarkup(
    createElement(StatusBadge, label === undefined ? { state } : { state, label }),
  );
}

describe("StatusBadge", () => {
  it("renders the canonical label, tone, and icon for a QOS_STATES key", () => {
    const html = render("out_of_sync");

    expect(html).toContain("Out of sync");
    expect(html).toContain('data-tone="warning"');
    expect(html).toContain('data-icon="refresh-cw-off"');
    expect(html).toContain("qos-badge");
  });

  it("keeps tone and icon when the label is overridden", () => {
    const html = render("warning", "Degraded");

    expect(html).toContain("Degraded");
    expect(html).not.toContain(">Warning<");
    expect(html).toContain('data-tone="warning"');
    expect(html).toContain('data-icon="alert-triangle"');
  });

  it("falls back to the info state for an unknown key", () => {
    const html = render("not_a_real_state");

    expect(html).toContain("Info");
    expect(html).toContain('data-tone="info"');
    expect(html).toContain('data-icon="info"');
  });

  it("renders a mapped schema status, never the raw enum string", () => {
    const html = render(qosStateFromDb("product_status", "active"));

    expect(html).toContain("Published");
    expect(html).not.toContain("active");
  });
});
