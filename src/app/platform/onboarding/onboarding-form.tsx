"use client";

import { useMemo, useState } from "react";

type BusinessProfile = "hospitality" | "generic_retail";

type PreviewResponse = {
  preview: {
    businessName: string;
    businessProfile: BusinessProfile;
    brandName: string;
    locationName: string;
    locationTimezone: string;
    administratorEmail: string;
    baseCurrency: string;
    defaultLocale: string;
    supportedLocales: string[];
    administratorRole: "administrator" | "user";
    derivedLocationSlug: string;
  };
};

type ProvisionResponse = PreviewResponse["preview"] & {
  tenant: { id: string; publicId: string; name: string; status: string };
  brand: { id: string; publicId: string; name: string };
  location: { id: string; publicId: string; name: string; slug: string };
  invitation: {
    id: string;
    email: string;
    role: string;
    status: string;
    deliveryStatus: string;
  };
  idempotentReplay: boolean;
};

const defaultForm = {
  businessName: "",
  businessProfile: "hospitality" as BusinessProfile,
  brandName: "",
  locationName: "",
  locationTimezone: "Asia/Dubai",
  administratorEmail: "",
  baseCurrency: "AED",
  defaultLocale: "en",
  supportedLocales: ["en", "ar"],
  operatorKey: "",
  operatorSubject: "operator@qosapp.com",
};

export function OnboardingForm() {
  const [form, setForm] = useState(defaultForm);
  const [preview, setPreview] = useState<PreviewResponse["preview"] | null>(
    null,
  );
  const [result, setResult] = useState<ProvisionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "create" | null>(null);
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  const payload = {
    businessName: form.businessName,
    businessProfile: form.businessProfile,
    brandName: form.brandName,
    locationName: form.locationName,
    locationTimezone: form.locationTimezone,
    administratorEmail: form.administratorEmail,
    baseCurrency: form.baseCurrency,
    defaultLocale: form.defaultLocale,
    supportedLocales: form.supportedLocales,
    administratorRole: "administrator" as const,
  };

  const operatorHeaders = {
    "Content-Type": "application/json",
    "X-QOS-Operator-Key": form.operatorKey,
    "X-QOS-Operator-Subject": form.operatorSubject,
  };

  async function handlePreview() {
    setBusy("preview");
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/platform/businesses/preview", {
        method: "POST",
        headers: operatorHeaders,
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Preview failed.");
      }
      setPreview(data.preview);
    } catch (previewError) {
      setPreview(null);
      setError(
        previewError instanceof Error
          ? previewError.message
          : "Preview failed.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleCreate() {
    setBusy("create");
    setError(null);

    try {
      const response = await fetch("/api/platform/businesses", {
        method: "POST",
        headers: {
          ...operatorHeaders,
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Create failed.");
      }
      setResult(data);
      setPreview(null);
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "Create failed.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-8">
      <section className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-zinc-700">Business name</span>
          <input
            className="rounded-lg border border-zinc-300 px-3 py-2"
            value={form.businessName}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                businessName: event.target.value,
              }))
            }
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-zinc-700">Business profile</span>
          <select
            className="rounded-lg border border-zinc-300 px-3 py-2"
            value={form.businessProfile}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                businessProfile: event.target.value as BusinessProfile,
              }))
            }
          >
            <option value="hospitality">Hospitality</option>
            <option value="generic_retail">Generic Retail</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-zinc-700">Brand name</span>
          <input
            className="rounded-lg border border-zinc-300 px-3 py-2"
            value={form.brandName}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                brandName: event.target.value,
              }))
            }
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-zinc-700">Initial location</span>
          <input
            className="rounded-lg border border-zinc-300 px-3 py-2"
            value={form.locationName}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                locationName: event.target.value,
              }))
            }
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-zinc-700">Location timezone</span>
          <input
            className="rounded-lg border border-zinc-300 px-3 py-2"
            value={form.locationTimezone}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                locationTimezone: event.target.value,
              }))
            }
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-zinc-700">Administrator email</span>
          <input
            type="email"
            className="rounded-lg border border-zinc-300 px-3 py-2"
            value={form.administratorEmail}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                administratorEmail: event.target.value,
              }))
            }
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-zinc-700">Operator subject</span>
          <input
            className="rounded-lg border border-zinc-300 px-3 py-2"
            value={form.operatorSubject}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                operatorSubject: event.target.value,
              }))
            }
          />
        </label>
        <label className="grid gap-1 text-sm md:col-span-2">
          <span className="font-medium text-zinc-700">Operator API key</span>
          <input
            type="password"
            className="rounded-lg border border-zinc-300 px-3 py-2"
            value={form.operatorKey}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                operatorKey: event.target.value,
              }))
            }
          />
        </label>
      </section>

      <div className="space-y-3">
        {!preview && !result ? (
          <p className="text-sm text-zinc-500">
            Step 1: click <span className="font-medium text-zinc-700">Preview defaults</span>.
            Step 2: click <span className="font-medium text-zinc-700">Create business</span>.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-medium"
            disabled={busy !== null}
            onClick={() => void handlePreview()}
          >
            {busy === "preview" ? "Previewing..." : "Preview defaults"}
          </button>
          <button
            type="button"
            className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-600"
            disabled={busy !== null || !preview}
            onClick={() => void handleCreate()}
          >
            {busy === "create" ? "Creating..." : "Create business"}
          </button>
        </div>
      </div>

      {preview ? (
        <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm">
          <h2 className="font-semibold text-zinc-900">Preview</h2>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-zinc-700">
            {JSON.stringify(preview, null, 2)}
          </pre>
        </section>
      ) : null}

      {result ? (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
          <h2 className="font-semibold text-emerald-900">
            {result.idempotentReplay ? "Existing business returned" : "Business created"}
          </h2>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-emerald-900">
            {JSON.stringify(result, null, 2)}
          </pre>
        </section>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
