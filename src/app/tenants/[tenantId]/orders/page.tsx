import { StaffOrdersPanel } from "@/components/staff/staff-workspace-ui";
import { StaffScreen } from "@/components/staff/StaffScreen";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function TenantOrdersPage({ params }: PageProps) {
  const { tenantId } = await params;

  return (
    <StaffScreen
      title="Orders"
      subtitle="Stripe sandbox checkout attempts for this business. Kitchen tickets and POS boards are not part of this list."
    >
      <StaffOrdersPanel tenantId={tenantId} />
    </StaffScreen>
  );
}
