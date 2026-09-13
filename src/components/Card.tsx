import type { CSSProperties, ReactNode } from "react";

type CardProps = {
  children?: ReactNode;
  padding?: "none" | "sm" | "md";
  tone?: "default" | "intelligence";
  interactive?: boolean;
  header?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  style?: CSSProperties;
};

export function Card({
  children,
  padding = "md",
  tone = "default",
  interactive = false,
  header,
  subtitle,
  actions,
  style,
}: CardProps) {
  const hasHead = Boolean(header || subtitle || actions);

  return (
    <div
      className="qos-card"
      data-padding={hasHead ? "none" : padding}
      data-tone={tone === "default" ? undefined : tone}
      data-interactive={interactive || undefined}
      style={style}
    >
      {hasHead ? (
        <div className="qos-card-head">
          <div>
            {header ? <div className="qos-card-title">{header}</div> : null}
            {subtitle ? <div className="qos-card-sub">{subtitle}</div> : null}
          </div>
          {actions}
        </div>
      ) : null}
      {hasHead && padding !== "none" ? (
        <div
          style={{
            padding:
              padding === "sm"
                ? "var(--card-padding-compact)"
                : "var(--card-padding)",
          }}
        >
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  );
}
