type StaffWordmarkProps = {
  tone?: "light" | "navy";
  height?: number;
};

export function StaffWordmark({ tone = "light", height = 20 }: StaffWordmarkProps) {
  return (
    <span
      aria-label="QOS"
      style={{
        display: "inline-flex",
        alignItems: "center",
        height,
        fontSize: Math.round(height * 0.82),
        fontWeight: "var(--fw-semibold)",
        letterSpacing: "-0.04em",
        color: tone === "navy" ? "var(--white)" : "var(--text-primary)",
        lineHeight: 1,
      }}
    >
      QOS
    </span>
  );
}
