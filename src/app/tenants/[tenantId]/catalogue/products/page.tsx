import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function CatalogueProductsListPage({ params }: PageProps) {
  const { tenantId } = await params;
  redirect(`/tenants/${tenantId}/catalogue`);
}
