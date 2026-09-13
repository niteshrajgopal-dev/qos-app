import { ModifierGroupEditor } from "@/app/tenants/[tenantId]/catalogue/modifier-groups/modifier-group-editor";
import { ButtonLink } from "@/components/ButtonLink";
import { StaffScreen } from "@/components/staff/StaffScreen";

type PageProps = {
  params: Promise<{ tenantId: string; groupPublicId: string }>;
};

export default async function EditModifierGroupPage({ params }: PageProps) {
  const { tenantId, groupPublicId } = await params;

  return (
    <StaffScreen
      title="Edit modifier group"
      subtitle={groupPublicId}
      actions={
        <ButtonLink
          href={`/tenants/${tenantId}/catalogue/modifier-groups`}
          variant="ghost"
        >
          All groups
        </ButtonLink>
      }
    >
      <ModifierGroupEditor tenantId={tenantId} groupPublicId={groupPublicId} />
    </StaffScreen>
  );
}
