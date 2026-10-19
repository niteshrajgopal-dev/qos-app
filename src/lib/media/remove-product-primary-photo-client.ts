import { staffApiFetch } from "@/lib/staff/dev-fetch";

export async function fetchCatalogueProductVersion(
  tenantId: string,
  productPublicId: string,
): Promise<number> {
  const response = await staffApiFetch(
    `/api/tenants/${tenantId}/catalogue/products/${productPublicId}`,
  );
  const payload = (await response.json()) as {
    product?: { version: number };
    error?: string;
  };
  if (!response.ok || !Number.isInteger(payload.product?.version)) {
    throw new Error(payload.error ?? "Unable to load product version.");
  }
  return payload.product!.version;
}

export async function removeProductPrimaryPhotoClient(
  tenantId: string,
  productPublicId: string,
  expectedVersion: number,
): Promise<number | null> {
  const response = await staffApiFetch(
    `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/media/primary/remove`,
    {
      method: "POST",
      body: JSON.stringify({ expectedVersion }),
    },
  );
  const payload = (await response.json()) as {
    result?: { version: number };
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error ?? "Unable to remove product photo.");
  }
  return payload.result?.version ?? null;
}
