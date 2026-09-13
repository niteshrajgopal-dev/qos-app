import type { ReactNode } from "react";

import { Icon } from "@/components/Icon";

type AlertProps = {
  tone?: "info" | "success" | "warning" | "error" | "neutral" | "intelligence";
  title?: ReactNode;
  children?: ReactNode;
  icon?: string;
  actions?: ReactNode;
  onDismiss?: () => void;
};

export function Alert({
  tone = "info",
  title,
  children,
  icon,
  actions,
  onDismiss,
}: AlertProps) {
  return (
    <div className="qos-alert" data-tone={tone} role="status">
      {icon ? (
        <span className="qos-alert-icon">
          <Icon name={icon} size={16} />
        </span>
      ) : null}
      <div style={{ flex: 1, minWidth: 0 }}>
        {title ? <div className="qos-alert-title">{title}</div> : null}
        {children ? <div className="qos-alert-body">{children}</div> : null}
      </div>
      {actions}
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
