"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/Button";
import { OverlaySurface } from "@/components/overlay-surface";

export type ModalProps = {
  open?: boolean;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  tone?: "default" | "danger";
  onClose?: () => void;
};

export function Modal({
  open = false,
  title,
  description,
  children,
  footer,
  size = "md",
  tone = "default",
  onClose,
}: ModalProps) {
  if (!open) {
    return null;
  }

  return (
    <OverlaySurface className="qos-scrim" onClose={onClose}>
      <div
        className="qos-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qos-modal-title"
        data-size={size === "md" ? undefined : size}
        data-tone={tone}
      >
        {title ? (
          <div className="qos-modal-head">
            <div className="qos-modal-title" id="qos-modal-title">
              {title}
            </div>
          </div>
        ) : null}
        <div className="qos-modal-body" id="qos-modal-description">
          {description}
          {children}
        </div>
        {footer ? <div className="qos-modal-foot">{footer}</div> : null}
      </div>
    </OverlaySurface>
  );
}

export type ConfirmDialogProps = {
  open?: boolean;
  title?: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  onConfirm?: () => void;
  onClose?: () => void;
  children?: ReactNode;
};

export function ConfirmDialog({
  open = false,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  onConfirm,
  onClose,
  children,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      description={description}
      tone={tone}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
