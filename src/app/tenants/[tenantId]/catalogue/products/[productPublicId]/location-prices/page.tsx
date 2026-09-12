import Link from "next/link";

import { LocationPriceOverrides } from "@/app/tenants/[tenantId]/catalogue/products/[productPublicId]/location-prices/location-price-overrides";

type PageProps = {
  params: Promise<{ tenantId: string; productPublicId: string }>;
};

export default async function ProductLocationPricesPage({ params }: PageProps) {
  const { tenantId, productPublicId } = await params;

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-10 font-sans text-zinc-900">
      <main className="mx-auto w-full max-w-5xl rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
              Catalogue
            </p>
            <h1 className="mt-2 text-3xl font-semibold">Location prices</h1>
            <p className="mt-2 text-zinc-600">
              Review inherited and overridden branch prices for{" "}
              <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-sm">
                {productPublicId}
              </code>
              .
            </p>
          </div>
          <Link
            href="/"
            className="text-sm font-medium text-zinc-600 underline-offset-4 hover:underline"
          >
            Home
          </Link>
        </div>
        <LocationPriceOverrides
          tenantId={tenantId}
          productPublicId={productPublicId}
        />
      </main>
    </div>
  );
}
