import * as React from "react";

export interface ModalProps {
  open?: boolean;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  tone?: "default" | "danger";
  onClose?: () => void;
}

export declare function Modal(props: ModalProps): JSX.Element;

export interface ConfirmDialogProps {
  open?: boolean;
  title?: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  onConfirm?: () => void;
  onClose?: () => void;
  children?: React.ReactNode;
}

export declare function ConfirmDialog(props: ConfirmDialogProps): JSX.Element;
