import Link from "next/link";

import { MenuEditor } from "@/app/tenants/[tenantId]/catalogue/menus/menu-editor";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function NewCatalogueMenuPage({ params }: PageProps) {
  const { tenantId } = await params;

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-10 font-sans text-zinc-900">
      <main className="mx-auto w-full max-w-4xl rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
              Catalogue
            </p>
            <h1 className="mt-2 text-3xl font-semibold">Create draft menu</h1>
          </div>
          <Link
            href={`/tenants/${tenantId}/catalogue/menus`}
            className="text-sm font-medium text-zinc-600 underline-offset-4 hover:underline"
          >
            Back to menus
          </Link>
        </div>
        <MenuEditor tenantId={tenantId} />
      </main>
    </div>
  );
}
