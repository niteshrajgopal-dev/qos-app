import type { CSSProperties, ReactNode } from "react";

export function Section({
  title,
  action,
  children,
  style,
}: {
  title: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section style={{ marginTop: "var(--section-gap)", ...style }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 12,
        }}
      >
        <h2
          style={{
            fontSize: "var(--text-section-size)",
            lineHeight: "var(--text-section-lh)",
            fontWeight: "var(--fw-semibold)",
            letterSpacing: "var(--text-section-ls)",
          }}
        >
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Grid({
  cols = 4,
  children,
  gap = 16,
  style,
}: {
  cols?: number;
  children?: ReactNode;
  gap?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gap,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function DefinitionList({
  items,
}: {
  items: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <dl
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: "10px 20px",
        margin: 0,
        fontSize: 13,
      }}
    >
      {items.map((item) => (
        <span key={item.label} style={{ display: "contents" }}>
          <dt style={{ color: "var(--text-secondary)" }}>{item.label}</dt>
          <dd style={{ margin: 0, fontWeight: "var(--fw-medium)" }}>{item.value}</dd>
        </span>
      ))}
    </dl>
  );
}
