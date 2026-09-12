"use client";

import Link from "next/link";
import { useState } from "react";

type AuthMode = "sign-in" | "sign-up";

export function StaffSignInForm() {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);

    const endpoint =
      mode === "sign-in"
        ? "/api/staff-auth/sign-in/email"
        : "/api/staff-auth/sign-up/email";

    const body =
      mode === "sign-in"
        ? {
            email: form.email,
            password: form.password,
            rememberMe: true,
          }
        : {
            name: form.name,
            email: form.email,
            password: form.password,
          };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload = (await response.json()) as { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? payload.message ?? "Staff authentication failed.");
      }

      setMessage(
        mode === "sign-in"
          ? "Signed in. Protected staff APIs now use your session cookie."
          : "Account created. Verify email in local logs, then sign in.",
      );
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Staff authentication failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("sign-in")}
          className={`rounded-full px-4 py-2 text-sm font-medium ${
            mode === "sign-in"
              ? "bg-zinc-900 text-white"
              : "border border-zinc-300 text-zinc-700"
          }`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => setMode("sign-up")}
          className={`rounded-full px-4 py-2 text-sm font-medium ${
            mode === "sign-up"
              ? "bg-zinc-900 text-white"
              : "border border-zinc-300 text-zinc-700"
          }`}
        >
          Sign up
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === "sign-up" ? (
          <label className="block space-y-2">
            <span className="text-sm font-medium text-zinc-700">Name</span>
            <input
              className="w-full rounded-lg border border-zinc-300 px-3 py-2"
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              required
            />
          </label>
        ) : null}

        <label className="block space-y-2">
          <span className="text-sm font-medium text-zinc-700">Email</span>
          <input
            type="email"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2"
            value={form.email}
            onChange={(event) =>
              setForm((current) => ({ ...current, email: event.target.value }))
            }
            required
          />
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-zinc-700">Password</span>
          <input
            type="password"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2"
            value={form.password}
            onChange={(event) =>
              setForm((current) => ({ ...current, password: event.target.value }))
            }
            required
            minLength={8}
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {busy ? "Working…" : mode === "sign-in" ? "Sign in" : "Create account"}
        </button>
      </form>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {message ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </p>
      ) : null}

      <p className="text-sm text-zinc-600">
        Have an invitation token?{" "}
        <Link href="/staff/invitations/accept" className="font-medium text-zinc-900 underline">
          Accept invitation
        </Link>
      </p>
    </div>
  );
}
