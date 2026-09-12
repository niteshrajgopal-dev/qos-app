import Link from "next/link";

import { StaffSignInForm } from "@/app/staff/sign-in/staff-sign-in-form";

export default function StaffSignInPage() {
  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-10 font-sans text-zinc-900">
      <main className="mx-auto w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="mb-8">
          <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Staff access
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Sign in</h1>
          <p className="mt-2 text-zinc-600">
            Use a verified staff account before calling protected catalogue and
            membership APIs.
          </p>
        </div>

        <StaffSignInForm />

        <p className="mt-8 text-sm text-zinc-600">
          Need access without an invitation?{" "}
          <Link href="/staff/request-access" className="font-medium text-zinc-900 underline">
            Request access
          </Link>
        </p>
      </main>
    </div>
  );
}
