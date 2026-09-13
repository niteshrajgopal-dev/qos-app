import { OnlineStoreManagement } from "@/app/tenants/[tenantId]/channels/online-store/online-store-management";
import { StaffScreen } from "@/components/staff/StaffScreen";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function OnlineStorePage({ params }: PageProps) {
  const { tenantId } = await params;

  return (
    <StaffScreen
      title="Online Store"
      subtitle="Theme, content blocks, and immutable storefront releases. Publishing never mutates the live release in place."
    >
      <OnlineStoreManagement tenantId={tenantId} />
    </StaffScreen>
  );
}
