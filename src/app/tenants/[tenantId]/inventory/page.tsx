import { InventoryScreen } from "./inventory-screen";
import { inventoryTabFrom } from "./inventory-tabs";

type PageProps = {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
};

export default async function TenantInventoryPage({ params, searchParams }: PageProps) {
  const { tenantId } = await params;
  const { tab } = await searchParams;
  return <InventoryScreen tenantId={tenantId} initialTab={inventoryTabFrom(tab)} />;
}
