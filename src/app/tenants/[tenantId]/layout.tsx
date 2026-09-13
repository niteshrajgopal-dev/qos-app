import type { ReactNode } from "react";

import { StaffAppShell } from "@/components/staff/StaffAppShell";

type TenantLayoutProps = {
  children: ReactNode;
  params: Promise<{ tenantId: string }>;
};

export default async function TenantLayout({
  children,
  params,
}: TenantLayoutProps) {
  const { tenantId } = await params;

  return <StaffAppShell tenantId={tenantId}>{children}</StaffAppShell>;
}
