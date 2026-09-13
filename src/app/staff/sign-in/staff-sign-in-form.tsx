"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { staffUiCopy } from "@/lib/staff/locale";
import { resolveStaffDestinationAfterSignIn } from "@/lib/staff/post-sign-in";
import { fetchStaffSession } from "@/lib/staff/staff-session-client";

type AuthMode = "sign-in" | "sign-up";

export function StaffSignInForm() {
  const router = useRouter();
  const { locale, setLocale } = useStaffLocale();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchStaffSession().then((result) => {
      if (result.ok) {
        router.replace(resolveStaffDestinationAfterSignIn(result.data.memberships));
      }
    });
  }, [router]);

  async function redirectAfterSession() {
    const session = await fetchStaffSession();
    if (!session.ok) {
      throw new Error(session.error);
    }
    router.replace(resolveStaffDestinationAfterSignIn(session.data.memberships));
  }

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

      const raw = await response.text();
      const payload = (
        raw
          ? (JSON.parse(raw) as { error?: string; message?: string })
          : {}
      ) as { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(
          payload.error ?? payload.message ?? "Staff authentication failed.",
        );
      }

      if (mode === "sign-up") {
        setMessage("Account created. Verify email in local logs, then sign in.");
        setMode("sign-in");
        return;
      }

      await redirectAfterSession();
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
    <div style={{ width: "100%", maxWidth: 340, display: "grid", gap: 16 }}>
      <div>
        <h2
          style={{
            fontSize: 24,
            lineHeight: "32px",
            fontWeight: 600,
            letterSpacing: "-.015em",
          }}
        >
          {staffUiCopy(locale, "signInTitle")}
        </h2>
        <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 6 }}>
          {staffUiCopy(locale, "signInSubtitle")}
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
        {mode === "sign-up" ? (
          <label className="qos-field" htmlFor="staff-name">
            <span className="qos-field-label">Name</span>
            <input
              id="staff-name"
              className="qos-input"
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              required
            />
          </label>
        ) : null}

        <label className="qos-field" htmlFor="staff-email">
          <span className="qos-field-label">{staffUiCopy(locale, "workEmail")}</span>
          <input
            id="staff-email"
            type="email"
            className="qos-input"
            autoComplete="username"
            value={form.email}
            onChange={(event) =>
              setForm((current) => ({ ...current, email: event.target.value }))
            }
            required
          />
        </label>

        <label className="qos-field" htmlFor="staff-password">
          <span className="qos-field-label">{staffUiCopy(locale, "password")}</span>
          <input
            id="staff-password"
            type="password"
            className="qos-input"
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
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
          className="qos-btn"
          data-variant="primary"
          data-size="lg"
          data-full="true"
          data-loading={busy || undefined}
          disabled={busy}
        >
          {mode === "sign-in" ? staffUiCopy(locale, "continue") : "Create account"}
        </button>
      </form>

      {error ? (
        <div className="qos-alert" data-tone="error" role="alert">
          <div className="qos-alert-body">{error}</div>
        </div>
      ) : null}

      {message ? (
        <div className="qos-alert" data-tone="success" role="status">
          <div className="qos-alert-body">{message}</div>
        </div>
      ) : null}

      <p
        style={{
          fontSize: 12,
          color: "var(--text-secondary)",
          textAlign: "center",
        }}
      >
        Trouble signing in?{" "}
        <Link href="/staff/request-access">Request staff access</Link>
        {" · "}
        <Link href="/staff/invitations/accept">Accept invitation</Link>
      </p>
      <p
        style={{
          fontSize: 12,
          color: "var(--text-tertiary)",
          textAlign: "center",
        }}
      >
        {mode === "sign-in" ? (
          <button
            type="button"
            className="qos-btn"
            data-variant="ghost"
            data-size="sm"
            onClick={() => setMode("sign-up")}
          >
            Create a local staff account
          </button>
        ) : (
          <button
            type="button"
            className="qos-btn"
            data-variant="ghost"
            data-size="sm"
            onClick={() => setMode("sign-in")}
          >
            Back to sign in
          </button>
        )}
        <button
          type="button"
          className="qos-btn"
          data-variant="ghost"
          data-size="sm"
          onClick={() => setLocale(locale === "en" ? "ar" : "en")}
        >
          {locale === "en" ? "العربية" : "English"}
        </button>
      </p>
    </div>
  );
}
