"use client";

import Link from "next/link";
import { useState } from "react";

import { staffApiFetch } from "@/lib/staff/dev-fetch";

type RedeemResponse = {
  tenantId: string;
  membershipId: string;
  role: "administrator" | "user";
  locationIds: string[];
  idempotentReplay: boolean;
};

type InvitationAcceptFormProps = {
  initialToken?: string;
};

export function InvitationAcceptForm({ initialToken = "" }: InvitationAcceptFormProps) {
  const [token, setToken] = useState(initialToken);
  const [result, setResult] = useState<RedeemResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const response = await staffApiFetch("/api/staff/invitations/redeem", {
        method: "POST",
        body: JSON.stringify({ token }),
      });

      const payload = (await response.json()) as RedeemResponse & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to redeem invitation.");
      }

      setResult(payload);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to redeem invitation.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block space-y-2">
          <span className="text-sm font-medium text-zinc-700">Invitation token</span>
          <textarea
            className="qos-textarea"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            required
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="qos-btn" data-variant="primary"
        >
          {busy ? "Redeeming…" : "Accept invitation"}
        </button>
      </form>

      {error ? (
        <p className="qos-alert" data-tone="error">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-medium">
            {result.idempotentReplay ? "Invitation already accepted." : "Invitation accepted."}
          </p>
          <p className="mt-2">Role: {result.role}</p>
          <p>Membership: {result.membershipId}</p>
          <p>Locations: {result.locationIds.length}</p>
        </div>
      ) : null}

      <p className="text-sm text-zinc-600">
        Sign in with the invited email first at{" "}
        <Link href="/staff/sign-in" className="font-medium text-zinc-900 underline">
          staff sign-in
        </Link>
        .
      </p>
    </div>
  );
}
