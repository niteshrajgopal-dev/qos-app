import React from "react";
import { IconButton } from "../primitives/IconButton.jsx";

export function Drawer({ open = true, title, description, children, footer, width, onClose, ...rest }) {
  if (!open) return null;
  return (
    <div className="qos-drawer-scrim" onClick={onClose}>
      <aside className="qos-drawer" role="dialog" aria-modal="true" style={width ? { width } : undefined} onClick={(e) => e.stopPropagation()} {...rest}>
        <div className="qos-drawer-head">
          <div>
            <div className="qos-modal-title" style={{ fontSize: "var(--text-section-size)", lineHeight: "var(--text-section-lh)" }}>{title}</div>
            {description ? <div style={{ fontSize: "var(--text-meta-size)", color: "var(--text-secondary)", marginTop: 3 }}>{description}</div> : null}
          </div>
          {onClose ? <IconButton icon="x" label="Close" size="sm" onClick={onClose} /> : null}
        </div>
        <div className="qos-drawer-body">{children}</div>
        {footer ? <div className="qos-drawer-foot">{footer}</div> : null}
      </aside>
    </div>
  );
}
