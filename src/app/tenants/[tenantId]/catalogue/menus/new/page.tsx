import { MenuEditor } from "@/app/tenants/[tenantId]/catalogue/menus/menu-editor";
import { ButtonLink } from "@/components/ButtonLink";
import { StaffScreen } from "@/components/staff/StaffScreen";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function NewCatalogueMenuPage({ params }: PageProps) {
  const { tenantId } = await params;

  return (
    <StaffScreen
      title="Create draft menu"
      subtitle="Build sections and place reusable catalogue items."
      actions={
        <ButtonLink
          href={`/tenants/${tenantId}/catalogue/menus`}
          variant="ghost"
        >
          Back to menus
        </ButtonLink>
      }
    >
      <MenuEditor tenantId={tenantId} />
    </StaffScreen>
  );
}
