"use client";

import type { ReactNode } from "react";

import { IconButton } from "@/components/IconButton";
import { OverlaySurface } from "@/components/overlay-surface";
import { overlayDrawerInlineSide } from "@/lib/staff/overlay";

export type DrawerProps = {
  open?: boolean;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number | string;
  /** "sheet" docks to the bottom on narrow screens; wider screens keep the side drawer. */
  placement?: "side" | "sheet";
  onClose?: () => void;
};

export function Drawer({
  open = false,
  title,
  description,
  children,
  footer,
  width,
  placement = "side",
  onClose,
}: DrawerProps) {
  if (!open) {
    return null;
  }

  return (
    <OverlaySurface
      className={placement === "sheet" ? "qos-drawer-scrim qos-sheet-scrim" : "qos-drawer-scrim"}
      onClose={onClose}
    >
      <div
        className="qos-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qos-drawer-title"
        data-inline-side={overlayDrawerInlineSide("ltr")}
        data-placement={placement === "sheet" ? "sheet" : undefined}
        style={width == null ? undefined : { width }}
      >
        <div className="qos-drawer-head">
          <div>
            {title ? (
              <div className="qos-modal-title" id="qos-drawer-title">
                {title}
              </div>
            ) : null}
            {description ? (
              <p className="qos-pagesub">{description}</p>
            ) : null}
          </div>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </div>
        <div className="qos-drawer-body">{children}</div>
        {footer ? <div className="qos-drawer-foot">{footer}</div> : null}
      </div>
    </OverlaySurface>
  );
}
