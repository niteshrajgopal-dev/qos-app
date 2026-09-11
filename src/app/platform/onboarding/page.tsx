import Link from "next/link";

import { OnboardingForm } from "@/app/platform/onboarding/onboarding-form";

export default function PlatformOnboardingPage() {
  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-10 font-sans text-zinc-900">
      <main className="mx-auto w-full max-w-3xl rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
              Platform operator
            </p>
            <h1 className="mt-2 text-3xl font-semibold">
              Create a business
            </h1>
            <p className="mt-2 text-zinc-600">
              Operator-managed onboarding for Quotes, the synthetic flower shop,
              or another Phase 1 tenant.
            </p>
          </div>
          <Link
            href="/"
            className="text-sm font-medium text-zinc-600 underline-offset-4 hover:underline"
          >
            Home
          </Link>
        </div>
        <OnboardingForm />
      </main>
    </div>
  );
}
