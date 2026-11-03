import { MenuEditorScreen } from "@/app/tenants/[tenantId]/catalogue/menus/menu-editor-screen";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function NewCatalogueMenuPage({ params }: PageProps) {
  const { tenantId } = await params;

  return <MenuEditorScreen tenantId={tenantId} />;
}
