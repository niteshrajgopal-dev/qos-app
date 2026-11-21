import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BusinessPicker, PortalTopBar } from "@/components/portal/PortalTopBar";
import { STAFF_UI_COPY, type StaffLocale } from "@/lib/staff/locale";
import { STAFF_TOP_NAV } from "@/lib/staff/nav";

const TENANTS = [
  { id: "tenant-quotes", name: "Quotes" },
  { id: "tenant-flowers", name: "Synthetic Flower Shop" },
];

function renderTopBar(locale: StaffLocale = "en") {
  return renderToStaticMarkup(
    createElement(PortalTopBar, {
      tenantId: "tenant-quotes",
      tenantName: "Quotes",
      tenants: TENANTS,
      activeId: "home",
      personName: "Staff Demo",
      roleLabel: "Administrator",
      locale,
      onToggleLocale: () => undefined,
      onOpenSearch: () => undefined,
      onSelectTenant: () => undefined,
      onSignOut: () => undefined,
    }),
  );
}

function renderBusinessPicker(open: boolean, locale: StaffLocale = "en") {
  return renderToStaticMarkup(
    createElement(BusinessPicker, {
      locale,
      tenantId: "tenant-quotes",
      tenantName: "Quotes",
      tenants: TENANTS,
      open,
      onToggle: () => undefined,
      onClose: () => undefined,
      onSelect: () => undefined,
    }),
  );
}

/* The markup between an element's opening tag and its matching close tag. */
function elementByClass(html: string, className: string) {
  const start = html.indexOf(`class="${className}"`);
  expect(start, className).toBeGreaterThan(-1);
  const open = html.lastIndexOf("<", start);
  const tag = /^<(\w+)/.exec(html.slice(open))?.[1] ?? "";
  let depth = 0;
  const pattern = new RegExp(`<(/?)${tag}\\b[^>]*>`, "g");
  pattern.lastIndex = open;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) {
      return html.slice(open, pattern.lastIndex);
    }
  }
  throw new Error(`unclosed ${className}`);
}

/* Bodies of every `@media (max-width: <width>px)` block in a stylesheet. */
function mediaBlocks(css: string, width: number) {
  const blocks: string[] = [];
  const marker = `@media (max-width: ${width}px) {`;
  for (let at = css.indexOf(marker); at > -1; at = css.indexOf(marker, at + 1)) {
    let depth = 0;
    for (let index = at + marker.length - 1; index < css.length; index += 1) {
      if (css[index] === "{") depth += 1;
      if (css[index] === "}") depth -= 1;
      if (depth === 0) {
        blocks.push(css.slice(at + marker.length, index));
        break;
      }
    }
  }
  return blocks;
}

function ruleBodies(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`(?:^|[}\\s,])${escaped}\\s*\\{([^}]*)\\}`, "g"))].map(
    (match) => match[1],
  );
}

const css = readFileSync(path.join(process.cwd(), "src/app/qos-portal.css"), "utf8");

describe("portal top bar at narrow widths", () => {
  it("keeps More outside the scrolling group of the five destinations", () => {
    const nav = elementByClass(renderTopBar(), "qosp-nav");
    const links = elementByClass(nav, "qosp-nav-links");
    const more = elementByClass(nav, "qosp-nav-more");

    expect(links.match(/<a\b/g)).toHaveLength(STAFF_TOP_NAV.length);
    expect(links).not.toContain("aria-haspopup");
    expect(more).toContain('aria-haspopup="menu"');
    expect(more).toContain(`>${STAFF_UI_COPY.en.more}<`);
    expect(nav.indexOf("qosp-nav-more")).toBeGreaterThan(nav.indexOf("</div>", nav.indexOf("qosp-nav-links")));
  });

  it("renders More and the business switch with Arabic copy", () => {
    const html = renderTopBar("ar");
    expect(elementByClass(html, "qosp-nav-more")).toContain(`>${STAFF_UI_COPY.ar.more}<`);
    expect(html).toContain(`aria-label="${STAFF_UI_COPY.ar.businessPickerLabel.replace("{name}", "Quotes")}"`);
    expect(html).toContain(`aria-label="${STAFF_UI_COPY.ar.searchThisBusiness}"`);
    expect(html).not.toContain(`>${STAFF_UI_COPY.en.more}<`);
  });

  it("renders a single search button between the nav and the actions", () => {
    const html = renderTopBar();
    expect(html.match(/class="qosp-search-trigger"/g)).toHaveLength(1);
    const search = html.indexOf('class="qosp-search-trigger"');
    expect(search).toBeGreaterThan(html.indexOf("</nav>"));
    expect(search).toBeLessThan(html.indexOf('class="qosp-top-actions"'));
  });

  it("scrolls only the destinations and never hides the business picker or search", () => {
    const narrow = mediaBlocks(css, 680).join("\n");
    expect(narrow.length).toBeGreaterThan(100);

    const linkRules = ruleBodies(narrow, ".qosp-nav-links").join(";");
    expect(linkRules).toMatch(/overflow-x:\s*auto/);
    for (const body of ruleBodies(narrow, ".qosp-nav")) {
      expect(body).not.toMatch(/overflow/);
    }
    expect(ruleBodies(css, ".qosp-nav-more").join(";")).toMatch(/flex:\s*none/);

    const hidden = [...narrow.matchAll(/([^{}]+)\{[^}]*display:\s*none/g)].map((match) => match[1]);
    for (const selectors of hidden) {
      expect(selectors).not.toMatch(/\.qosp-workspace-picker\s*(?:,|$)/);
      expect(selectors).not.toMatch(/\.qosp-search-trigger\s*(?:,|$)/);
      expect(selectors).not.toMatch(/\.qosp-nav-more/);
    }
  });

  it("shows the business initial tile and keeps the name for wider layouts", () => {
    const narrow = mediaBlocks(css, 680).join("\n");
    expect(ruleBodies(narrow, ".qosp-workspace-picker-name").join(";")).toMatch(/display:\s*none/);
    expect(ruleBodies(narrow, ".qosp-workspace-avatar").join(";")).not.toMatch(/display:\s*none/);
  });
});

describe("BusinessPicker", () => {
  it("names the current business on the compact trigger", () => {
    const html = renderBusinessPicker(false);
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Business: Quotes"');
    expect(html).toContain('class="qosp-workspace-avatar" aria-hidden="true">Q<');
    expect(html).not.toContain('role="listbox"');
  });

  it("lists every business with the current one selected", () => {
    const html = renderBusinessPicker(true);
    const listbox = elementByClass(html, "qos-menu qosp-workspace-menu");
    expect(listbox).toContain('role="listbox"');
    expect(listbox).toContain(`aria-label="${STAFF_UI_COPY.en.switchBusiness}"`);
    expect(listbox.match(/role="option"/g)).toHaveLength(2);
    expect(listbox).toMatch(/aria-selected="true"[^>]*>(?:<[^>]+>)*Quotes</);
    expect(listbox).toMatch(/aria-selected="false"[^>]*>(?:<[^>]+>)*Synthetic Flower Shop</);
  });

  it("uses Arabic chrome around business names", () => {
    const html = renderBusinessPicker(true, "ar");
    expect(html).toContain(`aria-label="${STAFF_UI_COPY.ar.businessPickerLabel.replace("{name}", "Quotes")}"`);
    expect(html).toContain(`>${STAFF_UI_COPY.ar.switchBusiness}<`);
    expect(html).not.toContain(STAFF_UI_COPY.en.switchBusiness);
  });
});
