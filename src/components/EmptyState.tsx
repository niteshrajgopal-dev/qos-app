import type { ReactNode } from "react";

import { Icon } from "@/components/Icon";

type EmptyStateProps = {
  icon?: string;
  title?: string;
  body?: string;
  tone?: "default" | "brand";
  actions?: ReactNode;
};

export function EmptyState({
  icon = "package",
  title,
  body,
  tone = "default",
  actions,
}: EmptyStateProps) {
  return (
    <div className="qos-empty" data-tone={tone === "default" ? undefined : tone}>
      <div className="qos-empty-art">
        <Icon name={icon} size={28} />
      </div>
      {title ? <div className="qos-empty-title">{title}</div> : null}
      {body ? <p className="qos-empty-body">{body}</p> : null}
      {actions}
    </div>
  );
}
