import { EmptyState } from "@/components/EmptyState";
import { StaffScreen } from "@/components/staff/StaffScreen";

export default function TenantPosPage() {
  return (
    <StaffScreen
      title="POS"
      subtitle="Point-of-sale devices are not provisioned in this environment."
    >
      <EmptyState
        icon="store"
        title="No POS devices"
        body="Android POS is a separate Phase 1 track. This page is live so the nav destination is real — it does not invent a device dashboard."
      />
    </StaffScreen>
  );
}
