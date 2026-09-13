import { StaffCustomersPanel } from "@/components/staff/staff-workspace-ui";
import { StaffScreen } from "@/components/staff/StaffScreen";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function TenantCustomersPage({ params }: PageProps) {
  const { tenantId } = await params;

  return (
    <StaffScreen
      title="Customers"
      subtitle="Storefront accounts associated with this tenant. This is not a marketing CRM."
    >
      <StaffCustomersPanel tenantId={tenantId} />
    </StaffScreen>
  );
}
