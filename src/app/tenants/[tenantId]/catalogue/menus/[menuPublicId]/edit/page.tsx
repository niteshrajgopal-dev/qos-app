import { MenuEditor } from "@/app/tenants/[tenantId]/catalogue/menus/menu-editor";
import { ButtonLink } from "@/components/ButtonLink";
import { StaffScreen } from "@/components/staff/StaffScreen";

type PageProps = {
  params: Promise<{ tenantId: string; menuPublicId: string }>;
};

export default async function EditCatalogueMenuPage({ params }: PageProps) {
  const { tenantId, menuPublicId } = await params;

  return (
    <StaffScreen
      title="Edit draft menu"
      subtitle={menuPublicId}
      actions={
        <ButtonLink
          href={`/tenants/${tenantId}/catalogue/menus`}
          variant="ghost"
        >
          Back to menus
        </ButtonLink>
      }
    >
      <MenuEditor tenantId={tenantId} menuPublicId={menuPublicId} />
    </StaffScreen>
  );
}
