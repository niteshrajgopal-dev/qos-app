import Link from "next/link";

import { LocationAvailabilityPanel } from "@/app/tenants/[tenantId]/locations/[locationPublicId]/availability/location-availability-panel";

type PageProps = {
  params: Promise<{ tenantId: string; locationPublicId: string }>;
};

export default async function LocationAvailabilityPage({ params }: PageProps) {
  const { tenantId, locationPublicId } = await params;

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-10 font-sans text-zinc-900">
      <main className="mx-auto w-full max-w-5xl rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
              Locations
            </p>
            <h1 className="mt-2 text-3xl font-semibold">Availability</h1>
            <p className="mt-2 text-zinc-600">
              Manage opening hours and temporary stop-sales for{" "}
              <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-sm">
                {locationPublicId}
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
        <LocationAvailabilityPanel
          tenantId={tenantId}
          locationPublicId={locationPublicId}
        />
      </main>
    </div>
  );
}
