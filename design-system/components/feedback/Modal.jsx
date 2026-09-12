import React from "react";
import { Icon } from "../primitives/Icon.jsx";
import { Button } from "../primitives/Button.jsx";
import { IconButton } from "../primitives/IconButton.jsx";

export function Modal({ open = true, title, description, children, footer, size = "md", onClose, tone = "default", ...rest }) {
  if (!open) return null;
  return (
    <div className="qos-scrim" onClick={onClose}>
      <div className="qos-modal" data-size={size} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} {...rest}>
        <div className="qos-modal-head" style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
          {tone === "danger" ? (
            <span style={{ width: 32, height: 32, borderRadius: "var(--radius-md)", background: "var(--action-danger-subtle)", color: "var(--status-error-fg)", display: "grid", placeItems: "center", flex: "none" }}>
              <Icon name="alert-triangle" size={16} />
            </span>
          ) : null}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="qos-modal-title">{title}</div>
            {description ? <div style={{ fontSize: "var(--text-body-sm-size)", color: "var(--text-secondary)", marginTop: 4 }}>{description}</div> : null}
          </div>
          {onClose ? <IconButton icon="x" label="Close" size="sm" onClick={onClose} /> : null}
        </div>
        {children ? <div className="qos-modal-body">{children}</div> : null}
        {footer ? <div className="qos-modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/* High-impact confirmation: publish, rollback, disconnect, delete.
   Always names the object and the consequence. */
export function ConfirmDialog({ open = true, title, description, confirmLabel = "Confirm", cancelLabel = "Cancel", tone = "default", onConfirm, onClose, children, ...rest }) {
  return (
    <Modal
      open={open}
      title={title}
      description={description}
      tone={tone}
      size="sm"
      onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={onClose}>{cancelLabel}</Button>
        <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm}>{confirmLabel}</Button>
      </>}
      {...rest}
    >
      {children}
    </Modal>
  );
}
