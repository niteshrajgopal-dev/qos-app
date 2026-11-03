import { MenuEditorScreen } from "@/app/tenants/[tenantId]/catalogue/menus/menu-editor-screen";

type PageProps = {
  params: Promise<{ tenantId: string; menuPublicId: string }>;
};

export default async function EditCatalogueMenuPage({ params }: PageProps) {
  const { tenantId, menuPublicId } = await params;

  return <MenuEditorScreen tenantId={tenantId} menuPublicId={menuPublicId} />;
}
