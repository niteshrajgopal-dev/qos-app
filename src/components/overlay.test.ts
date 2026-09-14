import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CommandPalette } from "@/components/CommandPalette";
import { Drawer } from "@/components/Drawer";
import { ConfirmDialog, Modal } from "@/components/Modal";
import { Toast, ToastStack } from "@/components/Toast";

describe("QOS overlay primitives", () => {
  it("renders modal and confirm dialog on the design-system class contract", () => {
    const modal = renderToStaticMarkup(
      createElement(
        Modal,
        {
          open: true,
          title: "Publish menu",
          description: "Live on quotes.dev.qosapp.com.",
          size: "lg",
          tone: "default",
        },
        "Body",
      ),
    );

    expect(modal).toContain("qos-scrim");
    expect(modal).toContain("qos-modal");
    expect(modal).toContain('data-size="lg"');
    expect(modal).toContain('role="dialog"');
    expect(modal).toContain("Publish menu");
    expect(createElement(Modal, { open: false, title: "Hidden" })).toBeTruthy();
    expect(renderToStaticMarkup(createElement(Modal, { open: false, title: "Hidden" }))).toBe(
      "",
    );

    const confirm = renderToStaticMarkup(
      createElement(ConfirmDialog, {
        open: true,
        tone: "danger",
        title: "Discard unsaved changes to this draft product?",
        description: "The current draft will revert to the last saved version.",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
      }),
    );

    expect(confirm).toContain("qos-modal");
    expect(confirm).toContain('data-tone="danger"');
    expect(confirm).toContain("Discard");
    expect(confirm).toContain("Keep editing");
    expect(confirm).toContain('data-variant="danger"');
  });

  it("renders drawer, toast, and command palette on the CSS contracts", () => {
    const drawer = renderToStaticMarkup(
      createElement(
        Drawer,
        {
          open: true,
          title: "Order pay_demo",
          description: "Stripe sandbox · Quotes",
          width: 420,
        },
        "Attempt detail",
      ),
    );

    expect(drawer).toContain("qos-drawer-scrim");
    expect(drawer).toContain("qos-drawer");
    expect(drawer).toContain('data-inline-side="end"');
    expect(drawer).toContain("Order pay_demo");

    const toast = renderToStaticMarkup(
      createElement(
        ToastStack,
        null,
        createElement(Toast, { tone: "success", title: "Draft saved" }, "Product version 2"),
      ),
    );

    expect(toast).toContain("qos-toast-stack");
    expect(toast).toContain("qos-toast");
    expect(toast).toContain('data-tone="success"');
    expect(toast).toContain("Draft saved");

    const palette = renderToStaticMarkup(
      createElement(CommandPalette, {
        open: true,
        query: "men",
        placeholder: "Search pages and actions",
        groups: [
          {
            label: "Commerce",
            items: [
              { id: "menus", label: "Menus", kind: "Go", icon: "package" },
              { id: "products", label: "Products", kind: "Go" },
            ],
          },
        ],
      }),
    );

    expect(palette).toContain("qos-cmd");
    expect(palette).toContain("qos-cmd-item");
    expect(palette).toContain("Menus");
    expect(palette).not.toContain("Products");
    expect(palette).toContain("Search pages and actions");
  });
});
