import Link from "next/link";

import { RequestAccessForm } from "@/app/staff/request-access/request-access-form";

export default function RequestAccessPage() {
  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-10 font-sans text-zinc-900">
      <main className="mx-auto w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
              Staff access
            </p>
            <h1 className="mt-2 text-3xl font-semibold">Request access</h1>
            <p className="mt-2 text-zinc-600">
              Submit a request to join an existing business. Pending requesters
              cannot view business data until an Administrator approves them.
            </p>
          </div>
          <Link
            href="/"
            className="text-sm font-medium text-zinc-600 underline-offset-4 hover:underline"
          >
            Home
          </Link>
        </div>
        <RequestAccessForm />
      </main>
    </div>
  );
}
