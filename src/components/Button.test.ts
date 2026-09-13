import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";

describe("QOS primitives", () => {
  it("renders buttons on the design-system class contract", () => {
    const html = renderToStaticMarkup(
      createElement(Button, { variant: "secondary", size: "lg" }, "Save"),
    );

    expect(html).toContain("qos-btn");
    expect(html).toContain('data-variant="secondary"');
    expect(html).toContain('data-size="lg"');
    expect(html).toContain("Save");
  });

  it("renders page headers with the product title scale", () => {
    const html = renderToStaticMarkup(
      createElement(PageHeader, {
        title: "Menu management",
        subtitle: "Draft menus",
      }),
    );

    expect(html).toContain("qos-pagetitle");
    expect(html).toContain("Menu management");
    expect(html).toContain("qos-pagesub");
  });
});
