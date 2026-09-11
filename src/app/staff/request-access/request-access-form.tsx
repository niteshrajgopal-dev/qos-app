"use client";

import { useState } from "react";

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

const defaultForm = {
  tenantPublicId: "ten_quotes_dev",
  staffSubject: "staff.requester@qosapp.com",
  staffEmail: "staff.requester@qosapp.com",
};

export function RequestAccessForm() {
  const [form, setForm] = useState(defaultForm);
  const [submitted, setSubmitted] = useState<SubmitResponse | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"submit" | "refresh" | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy("submit");
    setError(null);

    try {
      const response = await fetch("/api/staff/access-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-QOS-Staff-Subject": form.staffSubject,
          "X-QOS-Staff-Email": form.staffEmail,
        },
        body: JSON.stringify({ tenantPublicId: form.tenantPublicId }),
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
      const response = await fetch(
        `/api/staff/access-requests/${submitted.id}`,
        {
          headers: {
            "X-QOS-Staff-Subject": form.staffSubject,
            "X-QOS-Staff-Email": form.staffEmail,
          },
        },
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
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block space-y-2">
          <span className="text-sm font-medium text-zinc-700">
            Business public ID
          </span>
          <input
            className="w-full rounded-lg border border-zinc-300 px-3 py-2"
            value={form.tenantPublicId}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                tenantPublicId: event.target.value,
              }))
            }
            required
          />
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-zinc-700">
            Staff subject (provider identity)
          </span>
          <input
            className="w-full rounded-lg border border-zinc-300 px-3 py-2"
            value={form.staffSubject}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                staffSubject: event.target.value,
              }))
            }
            required
          />
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-zinc-700">
            Staff email (display only)
          </span>
          <input
            type="email"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2"
            value={form.staffEmail}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                staffEmail: event.target.value,
              }))
            }
            required
          />
        </label>
        <button
          type="submit"
          disabled={busy !== null}
          className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {busy === "submit" ? "Submitting…" : "Submit request"}
        </button>
      </form>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {submitted ? (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm">
          <p className="font-medium text-zinc-900">Request submitted</p>
          <p className="mt-2 text-zinc-600">Request ID: {submitted.id}</p>
          <p className="text-zinc-600">Status: {submitted.status}</p>
          <button
            type="button"
            onClick={refreshStatus}
            disabled={busy !== null}
            className="mt-4 rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium"
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
