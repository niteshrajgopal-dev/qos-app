import type { ReactNode } from "react";

import { Icon } from "@/components/Icon";

export type ToastProps = {
  tone?: "info" | "success" | "warning" | "error" | "processing";
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
};

export function Toast({
  tone = "info",
  title,
  children,
  action,
  onDismiss,
}: ToastProps) {
  return (
    <div className="qos-toast" data-tone={tone} role="status">
      <div style={{ flex: 1, minWidth: 0 }}>
        {title ? <div className="qos-toast-title">{title}</div> : null}
        {children}
      </div>
      {action}
      {onDismiss ? (
        <button
          type="button"
          className="qos-iconbtn"
          data-size="sm"
          aria-label="Dismiss"
          onClick={onDismiss}
        >
          <Icon name="x" size={14} />
        </button>
      ) : null}
    </div>
  );
}

export type ToastStackProps = {
  children?: ReactNode;
};

export function ToastStack({ children }: ToastStackProps) {
  return <div className="qos-toast-stack">{children}</div>;
}
