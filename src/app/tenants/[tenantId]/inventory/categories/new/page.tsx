import { CategoryEditorScreen } from "../../category-editor";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function NewInventoryCategoryPage({ params }: PageProps) {
  const { tenantId } = await params;
  return <CategoryEditorScreen tenantId={tenantId} />;
}
