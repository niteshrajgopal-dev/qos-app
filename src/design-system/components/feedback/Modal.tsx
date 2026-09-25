"use client";

export type ModalProps = {

  open?: boolean;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  tone?: "default" | "danger";
  onClose?: () => void;
  style?: React.CSSProperties;
  className?: string;
};

export type ConfirmDialogProps = {

  open?: boolean;
  title?: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  onConfirm?: () => void;
  onClose?: () => void;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
};

import React from "react";
import { Icon } from "../primitives/Icon";
import { Button } from "../primitives/Button";
import { IconButton } from "../primitives/IconButton";

export function Modal({ open = true, title, description, children, footer, size = "md", onClose, tone = "default", ...rest }: ModalProps) {
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
export function ConfirmDialog({ open = true, title, description, confirmLabel = "Confirm", cancelLabel = "Cancel", tone = "default", onConfirm, onClose, children, ...rest }: ConfirmDialogProps) {
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
