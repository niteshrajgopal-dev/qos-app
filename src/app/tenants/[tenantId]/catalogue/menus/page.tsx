import { MenuManagement } from "@/app/tenants/[tenantId]/catalogue/menus/menu-management";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function CatalogueMenusPage({ params }: PageProps) {
  const { tenantId } = await params;

  return <MenuManagement tenantId={tenantId} />;
}
