import { StaffIntegrationsPanel } from "@/components/staff/staff-workspace-ui";
import { StaffScreen } from "@/components/staff/StaffScreen";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function TenantIntegrationsPage({ params }: PageProps) {
  const { tenantId } = await params;

  return (
    <StaffScreen
      title="Integrations"
      subtitle="Payment configuration status only. Secrets stay on the server."
    >
      <StaffIntegrationsPanel tenantId={tenantId} />
    </StaffScreen>
  );
}
