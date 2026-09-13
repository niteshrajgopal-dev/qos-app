import type { ReactNode } from "react";

import { PageHeader } from "@/components/PageHeader";

type StaffScreenProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
};

export function StaffScreen({
  title,
  subtitle,
  actions,
  badge,
  children,
}: StaffScreenProps) {
  return (
    <div style={{ display: "grid", gap: "var(--space-6)" }}>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={actions}
        badge={badge}
      />
      {children}
    </div>
  );
}
