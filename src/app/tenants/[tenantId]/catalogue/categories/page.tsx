import { EmptyState } from "@/components/EmptyState";
import { StaffScreen } from "@/components/staff/StaffScreen";

export default function TenantCategoriesPage() {
  return (
    <StaffScreen
      title="Categories"
      subtitle="Catalogue categories are not a stored entity yet. Use menu sections for grouping."
    >
      <EmptyState
        icon="package"
        title="No category model"
        body="Products attach to menu sections today. Category CRUD stays on QOS-66 until a schema exists."
      />
    </StaffScreen>
  );
}
