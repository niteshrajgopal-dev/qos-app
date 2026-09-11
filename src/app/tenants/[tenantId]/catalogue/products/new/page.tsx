import Link from "next/link";

import { ProductEditor } from "@/app/tenants/[tenantId]/catalogue/products/product-editor";
import { db } from "@/db";
import { findTenantById } from "@/lib/tenant/repository";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function NewCatalogueProductPage({ params }: PageProps) {
  const { tenantId } = await params;
  const tenant = await findTenantById(db, tenantId);

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-10 font-sans text-zinc-900">
      <main className="mx-auto w-full max-w-3xl rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
              Catalogue
            </p>
            <h1 className="mt-2 text-3xl font-semibold">New draft product</h1>
            <p className="mt-2 text-zinc-600">
              Create a reusable bilingual draft product for tenant{" "}
              <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-sm">
                {tenantId}
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
        <ProductEditor
          tenantId={tenantId}
          initialBusinessProfile={tenant?.businessProfile ?? "generic_retail"}
        />
      </main>
    </div>
  );
}
