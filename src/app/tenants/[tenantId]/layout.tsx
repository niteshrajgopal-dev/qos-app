import type { ReactNode } from "react";

import { StaffAppShellPrototype } from "@/components/staff/StaffAppShellPrototype";

type TenantLayoutProps = {
  children: ReactNode;
  params: Promise<{ tenantId: string }>;
};

export default async function TenantLayout({
  children,
  params,
}: TenantLayoutProps) {
  const { tenantId } = await params;

  return <StaffAppShellPrototype tenantId={tenantId}>{children}</StaffAppShellPrototype>;
}
