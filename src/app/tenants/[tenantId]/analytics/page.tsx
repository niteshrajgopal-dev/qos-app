import { StaffAnalyticsPanel } from "@/components/staff/staff-workspace-ui";
import { StaffScreen } from "@/components/staff/StaffScreen";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function TenantAnalyticsPage({ params }: PageProps) {
  const { tenantId } = await params;

  return (
    <StaffScreen
      title="Analytics"
      subtitle="Counts from this tenant’s real checkout, customer, and menu records."
    >
      <StaffAnalyticsPanel tenantId={tenantId} />
    </StaffScreen>
  );
}
