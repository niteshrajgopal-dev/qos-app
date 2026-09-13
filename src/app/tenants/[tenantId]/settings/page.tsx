import { StaffSettingsPanel } from "@/components/staff/staff-workspace-ui";
import { StaffScreen } from "@/components/staff/StaffScreen";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function TenantSettingsPage({ params }: PageProps) {
  const { tenantId } = await params;

  return (
    <StaffScreen
      title="Settings"
      subtitle="Read-only business profile from onboarding. Editing locale defaults is not in this slice."
    >
      <StaffSettingsPanel tenantId={tenantId} />
    </StaffScreen>
  );
}
