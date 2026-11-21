import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PortalBranchState } from "@/components/portal/portal-shell-context";
import { BranchPicker } from "@/components/portal/PortalTopBar";
import { STAFF_UI_COPY } from "@/lib/staff/locale";

const READY: PortalBranchState = {
  status: "ready",
  selection: "loc_quotes_hbz",
  branches: [
    { publicId: "loc_quotes_hbz", name: "HBZ Stadium", status: "active", timezone: "Asia/Dubai", currency: "AED" },
    { publicId: "loc_quotes_hct", name: "HCT Academic City", status: "suspended", timezone: "Asia/Dubai", currency: "AED" },
  ],
  allBranchesAllowed: true,
  baseCurrency: "AED",
  role: "administrator",
  requestedBusinessLabels: [],
};

function render(branch: PortalBranchState, open = true, locale: "en" | "ar" = "en") {
  return renderToStaticMarkup(
    createElement(BranchPicker, {
      locale,
      branch,
      open,
      onToggle: () => undefined,
      onClose: () => undefined,
      onSelect: () => undefined,
    }),
  );
}

describe("BranchPicker", () => {
  it("shows the selected branch with its timezone and currency", () => {
    const html = render(READY, false);
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Branch: HBZ Stadium"');
    expect(html).toContain("Asia/Dubai · AED");
    expect(html).not.toContain('role="listbox"');
  });

  it("lists All branches first, then each branch with timezone, currency and status", () => {
    const html = render(READY);
    expect(html).toContain('role="listbox"');
    const options = html.match(/role="option"/g) ?? [];
    expect(options).toHaveLength(3);
    const listbox = html.slice(html.indexOf('role="listbox"'));
    expect(listbox.indexOf(">All branches<")).toBeLessThan(listbox.indexOf(">HBZ Stadium<"));
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain(">Suspended<");
  });

  it("omits All branches when the server did not allow it", () => {
    const html = render({ ...READY, allBranchesAllowed: false, role: "user" });
    expect(html).not.toContain("All branches");
    expect(html.match(/role="option"/g)).toHaveLength(2);
  });

  it("renders Arabic chrome around tenant branch names", () => {
    const html = render({ ...READY, selection: "all" }, true, "ar");
    expect(html).toContain(STAFF_UI_COPY.ar.allBranches);
    expect(html).toContain(STAFF_UI_COPY.ar.switchBranch);
    expect(html).toContain(STAFF_UI_COPY.ar.branchStatusSuspended);
    expect(html).not.toContain("All branches");
  });

  it("is disabled with a status label while loading, on error or with no branches", () => {
    expect(render({ ...READY, status: "loading", selection: null })).toContain("disabled");
    expect(render({ ...READY, status: "error", selection: null })).toContain(STAFF_UI_COPY.en.branchUnavailable);
    expect(render({ ...READY, branches: [], selection: null, allBranchesAllowed: false })).toContain(
      STAFF_UI_COPY.en.noBranches,
    );
  });

  it("renders nothing before the branch context is requested", () => {
    expect(render({ ...READY, status: "idle" })).toBe("");
  });
});

describe("branch context styles", () => {
  it("use logical properties and no uppercase text", () => {
    const css = readFileSync(path.join(process.cwd(), "src/app/qos-portal.css"), "utf8");
    const block = css.slice(css.indexOf("/* ---------- Branch context (QOS-192)"));
    expect(block.length).toBeGreaterThan(100);
    expect(block).not.toMatch(/text-transform\s*:\s*uppercase/);
    expect(block).not.toMatch(/(?:^|[\s;{])(?:left|right)\s*:/);
    expect(block).not.toMatch(/margin-(?:left|right)|padding-(?:left|right)/);
  });
});
