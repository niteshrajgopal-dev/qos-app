import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

describe("Product redirect page", () => {
  it("redirects to the edit page", async () => {
    const { redirect } = await import("next/navigation");
    const ProductRedirectPage = (
      await import(
        "../app/tenants/[tenantId]/catalogue/products/[productPublicId]/page"
      )
    ).default;

    const params = Promise.resolve({
      tenantId: "tenant-123",
      productPublicId: "prd_abc",
    });

    await ProductRedirectPage({ params });

    expect(redirect).toHaveBeenCalledWith(
      "/tenants/tenant-123/catalogue/products/prd_abc/edit",
    );
  });
});

describe("Products list redirect page", () => {
  it("redirects to the catalogue page", async () => {
    const { redirect } = await import("next/navigation");
    vi.clearAllMocks();
    
    const ProductsListRedirectPage = (
      await import("../app/tenants/[tenantId]/catalogue/products/page")
    ).default;

    const params = Promise.resolve({
      tenantId: "tenant-456",
    });

    await ProductsListRedirectPage({ params });

    expect(redirect).toHaveBeenCalledWith("/tenants/tenant-456/catalogue");
  });
});
