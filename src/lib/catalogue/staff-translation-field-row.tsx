type StaffTranslationFieldRowProps = {
  label: string;
  value: string;
  dir?: "ltr" | "rtl";
  labelDir?: "ltr" | "rtl";
};

/** Label above value avoids RTL colon mirroring on inline "label: value" rows. */
export function StaffTranslationFieldRow({
  label,
  value,
  dir = "ltr",
  labelDir,
}: StaffTranslationFieldRowProps) {
  const resolvedLabelDir = labelDir ?? dir;

  return (
    <div className="space-y-1 text-sm" dir={dir}>
      <div
        className="font-medium"
        style={{ color: "var(--text-primary)" }}
        dir={resolvedLabelDir}
      >
        {label}
      </div>
      <div style={{ color: "var(--text-primary)" }} dir="auto">
        <bdi>{value}</bdi>
      </div>
    </div>
  );
}
