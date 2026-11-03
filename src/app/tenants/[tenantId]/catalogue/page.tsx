import { CatalogueProductsList } from "@/components/platform/catalogue-products-list";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function CatalogueHubPage({ params }: PageProps) {
  const { tenantId } = await params;

  return <CatalogueProductsList tenantId={tenantId} />;
}
