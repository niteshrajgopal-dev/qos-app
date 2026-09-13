import { ModifierGroupEditor } from "@/app/tenants/[tenantId]/catalogue/modifier-groups/modifier-group-editor";

type PageProps = {
  params: Promise<{ tenantId: string; groupPublicId: string }>;
};

export default async function EditModifierGroupPage({ params }: PageProps) {
  const { tenantId, groupPublicId } = await params;

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-10 font-sans text-zinc-900">
      <main className="mx-auto w-full max-w-4xl rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="mb-8">
          <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Catalogue
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Edit modifier group</h1>
          <p className="mt-2 text-zinc-600">
            Configure reusable choices for{" "}
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-sm">
              {groupPublicId}
            </code>
            .
          </p>
        </div>
        <ModifierGroupEditor tenantId={tenantId} groupPublicId={groupPublicId} />
      </main>
    </div>
  );
}
