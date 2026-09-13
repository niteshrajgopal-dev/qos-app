"use client";

import Link from "next/link";
import { useState } from "react";

import { staffApiFetch } from "@/lib/staff/dev-fetch";

type SubmitResponse = {
  id: string;
  tenantPublicId: string;
  status: string;
  version: number;
  createdAt: string;
};

type StatusResponse = {
  id: string;
  tenantPublicId: string;
  status: string;
  version: number;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
};

export function RequestAccessForm() {
  const [tenantPublicId, setTenantPublicId] = useState("ten_quotes_dev");
  const [submitted, setSubmitted] = useState<SubmitResponse | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"submit" | "refresh" | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy("submit");
    setError(null);

    try {
      const response = await staffApiFetch("/api/staff/access-requests", {
        method: "POST",
        body: JSON.stringify({ tenantPublicId }),
      });

      const payload = (await response.json()) as SubmitResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to submit access request.");
      }

      setSubmitted(payload);
      setStatus(null);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to submit access request.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function refreshStatus() {
    if (!submitted) {
      return;
    }

    setBusy("refresh");
    setError(null);

    try {
      const response = await staffApiFetch(
        `/api/staff/access-requests/${submitted.id}`,
      );

      const payload = (await response.json()) as StatusResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load request status.");
      }

      setStatus(payload);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Unable to load request status.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-600">
        Sign in first at{" "}
        <Link href="/staff/sign-in" className="font-medium text-zinc-900 underline">
          staff sign-in
        </Link>
        . This form uses your verified staff session cookie.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block space-y-2">
          <span className="text-sm font-medium text-zinc-700">
            Business public ID
          </span>
          <input
            className="qos-input"
            value={tenantPublicId}
            onChange={(event) => setTenantPublicId(event.target.value)}
            required
          />
        </label>
        <button
          type="submit"
          disabled={busy !== null}
          className="qos-btn" data-variant="primary"
        >
          {busy === "submit" ? "Submitting…" : "Submit request"}
        </button>
      </form>

      {error ? (
        <p className="qos-alert" data-tone="error">
          {error}
        </p>
      ) : null}

      {submitted ? (
        <div className="qos-card" data-padding="sm">
          <p className="font-medium text-zinc-900">Request submitted</p>
          <p className="mt-2 text-zinc-600">Request ID: {submitted.id}</p>
          <p className="text-zinc-600">Status: {submitted.status}</p>
          <button
            type="button"
            onClick={refreshStatus}
            disabled={busy !== null}
            className="qos-btn" data-variant="secondary"
          >
            {busy === "refresh" ? "Refreshing…" : "Refresh status"}
          </button>
          {status ? (
            <div className="mt-4 space-y-1 text-zinc-700">
              <p>Current status: {status.status}</p>
              {status.decisionNote ? (
                <p>Decision note: {status.decisionNote}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
