import type { ReactNode } from "react";

import { PageHeader } from "@/components/PageHeader";
import { StaffWordmark } from "@/components/staff/StaffWordmark";

type StaffAuthFrameProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
};

export function StaffAuthFrame({
  title,
  subtitle,
  actions,
  children,
}: StaffAuthFrameProps) {
  return (
    <div
      data-qos-theme="light"
      style={{
        minHeight: "100vh",
        background: "var(--surface-canvas)",
        color: "var(--text-primary)",
        padding: "40px 24px",
      }}
    >
      <main
        className="qos-card"
        data-padding="md"
        style={{ maxWidth: 720, margin: "0 auto" }}
      >
        <div style={{ marginBottom: "var(--space-6)" }}>
          <StaffWordmark height={18} />
        </div>
        <PageHeader title={title} subtitle={subtitle} actions={actions} />
        <div style={{ marginTop: "var(--space-6)" }}>{children}</div>
      </main>
    </div>
  );
}
