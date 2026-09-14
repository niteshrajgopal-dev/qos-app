import { CategoryEditor } from "@/app/tenants/[tenantId]/catalogue/categories/category-editor";
import { ButtonLink } from "@/components/ButtonLink";
import { StaffScreen } from "@/components/staff/StaffScreen";

type PageProps = {
  params: Promise<{ tenantId: string; categoryPublicId: string }>;
};

export default async function EditCategoryPage({ params }: PageProps) {
  const { tenantId, categoryPublicId } = await params;

  return (
    <StaffScreen
      title="Edit category"
      subtitle={categoryPublicId}
      actions={
        <ButtonLink
          href={`/tenants/${tenantId}/catalogue/categories`}
          variant="ghost"
        >
          All categories
        </ButtonLink>
      }
    >
      <CategoryEditor tenantId={tenantId} categoryPublicId={categoryPublicId} />
    </StaffScreen>
  );
}
