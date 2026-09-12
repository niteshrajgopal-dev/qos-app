import Link from "next/link";

import { InvitationAcceptForm } from "@/app/staff/invitations/accept/invitation-accept-form";

type InvitationAcceptPageProps = {
  searchParams: Promise<{ token?: string }>;
};

export default async function InvitationAcceptPage({
  searchParams,
}: InvitationAcceptPageProps) {
  const params = await searchParams;

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-10 font-sans text-zinc-900">
      <main className="mx-auto w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="mb-8">
          <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Staff access
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Accept invitation</h1>
          <p className="mt-2 text-zinc-600">
            Redeem an operator invitation token after signing in with the invited
            email address.
          </p>
        </div>

        <InvitationAcceptForm initialToken={params.token ?? ""} />

        <p className="mt-8 text-sm text-zinc-600">
          <Link href="/staff/sign-in" className="font-medium text-zinc-900 underline">
            Back to sign-in
          </Link>
        </p>
      </main>
    </div>
  );
}
