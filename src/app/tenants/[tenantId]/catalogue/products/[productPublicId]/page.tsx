import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{ tenantId: string; productPublicId: string }>;
};

export default async function ProductRedirectPage({ params }: PageProps) {
  const { tenantId, productPublicId } = await params;
  redirect(
    `/tenants/${tenantId}/catalogue/products/${productPublicId}/edit`,
  );
}
