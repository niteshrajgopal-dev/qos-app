import { MenuManagement } from "@/app/tenants/[tenantId]/catalogue/menus/menu-management";
import { ButtonLink } from "@/components/ButtonLink";
import { StaffScreen } from "@/components/staff/StaffScreen";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function CatalogueMenusPage({ params }: PageProps) {
  const { tenantId } = await params;

  return (
    <StaffScreen
      title="Menu management"
      subtitle="Draft, publish, and edit menus for this business."
      actions={
        <ButtonLink
          href={`/tenants/${tenantId}/catalogue/menus/new`}
          variant="primary"
        >
          New menu
        </ButtonLink>
      }
    >
      <MenuManagement tenantId={tenantId} />
    </StaffScreen>
  );
}
