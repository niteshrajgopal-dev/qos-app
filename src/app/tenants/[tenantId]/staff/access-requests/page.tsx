import Link from "next/link";

import { AccessRequestsReview } from "@/app/tenants/[tenantId]/staff/access-requests/access-requests-review";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function StaffAccessRequestsPage({ params }: PageProps) {
  const { tenantId } = await params;

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-10 font-sans text-zinc-900">
      <main className="mx-auto w-full max-w-4xl rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
              Staff administration
            </p>
            <h1 className="mt-2 text-3xl font-semibold">Access requests</h1>
            <p className="mt-2 text-zinc-600">
              Review pending staff access requests for tenant{" "}
              <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-sm">
                {tenantId}
              </code>
              .
            </p>
          </div>
          <div className="flex flex-col items-end gap-2 text-sm">
            <Link
              href={`/tenants/${tenantId}/staff/audit`}
              className="font-medium text-zinc-600 underline-offset-4 hover:underline"
            >
              Audit log
            </Link>
            <Link
              href="/"
              className="font-medium text-zinc-600 underline-offset-4 hover:underline"
            >
              Home
            </Link>
          </div>
        </div>
        <AccessRequestsReview tenantId={tenantId} />
      </main>
    </div>
  );
}
