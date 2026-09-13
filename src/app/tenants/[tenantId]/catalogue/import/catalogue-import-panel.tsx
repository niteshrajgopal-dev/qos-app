"use client";

import { useCallback, useMemo, useState } from "react";

import type {
  CatalogueImportColumnMapping,
  CatalogueImportPreviewPayload,
} from "@/db/schema";
import { staffApiFetch } from "@/lib/staff/dev-fetch";

type PreviewResponse = {
  operationPublicId: string;
  previewHash: string;
  warnings: string[];
  headers: string[];
  suggestedMapping: CatalogueImportColumnMapping;
  preview: CatalogueImportPreviewPayload;
  replayed?: boolean;
};

type ApplyResponse = {
  operationPublicId: string;
  replayed: boolean;
  report: {
    createCount: number;
    updateCount: number;
    unchangedCount: number;
    skippedCount: number;
    conflictCount: number;
    errorCount: number;
    rows: Array<{
      sourceRow: number;
      sourceId: string;
      status: string;
      productPublicId: string | null;
      reason: string | null;
    }>;
  };
};

type CatalogueImportPanelProps = {
  tenantId: string;
};

const EMPTY_MAPPING: CatalogueImportColumnMapping = {
  sourceId: "",
  internalName: "",
  displayNameEn: "",
  displayNameAr: "",
  descriptionEn: "",
  descriptionAr: "",
  variantLabelEn: "",
  variantLabelAr: "",
  amountMinor: "",
  currency: "",
  sku: "",
  barcode: "",
};

export function CatalogueImportPanel({ tenantId }: CatalogueImportPanelProps) {
  const [connectionKey, setConnectionKey] = useState("quotes.synthetic");
  const [file, setFile] = useState<File | null>(null);
  const [columnMapping, setColumnMapping] =
    useState<CatalogueImportColumnMapping>(EMPTY_MAPPING);
  const [headers, setHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewIdempotencyKey = useMemo(() => crypto.randomUUID(), []);
  const applyIdempotencyKey = useMemo(() => crypto.randomUUID(), []);

  const basePath = `/api/tenants/${tenantId}/catalogue/import`;

  const updateMappingField = (
    field: keyof CatalogueImportColumnMapping,
    value: string,
  ) => {
    setColumnMapping((current) => ({ ...current, [field]: value }));
  };

  const runPreview = useCallback(async () => {
    if (!file) {
      setError("Choose a CSV or XLSX file first.");
      return;
    }

    setBusy(true);
    setError(null);
    setApplyResult(null);

    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("connectionKey", connectionKey);
      formData.set("columnMapping", JSON.stringify(columnMapping));

      const response = await staffApiFetch(`${basePath}/preview`, {
        method: "POST",
        headers: {
          "Idempotency-Key": previewIdempotencyKey,
        },
        body: formData,
      });

      const payload = (await response.json()) as PreviewResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Preview failed.");
      }

      setPreview(payload);
      setHeaders(payload.headers);
      if (headers.length === 0) {
        setColumnMapping(payload.suggestedMapping);
      }
    } catch (previewError) {
      setError(
        previewError instanceof Error
          ? previewError.message
          : "Preview failed.",
      );
    } finally {
      setBusy(false);
    }
  }, [basePath, columnMapping, connectionKey, file, previewIdempotencyKey]);

  const runApply = useCallback(async () => {
    if (!preview) {
      setError("Run preview before applying.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await staffApiFetch(`${basePath}/apply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": applyIdempotencyKey,
        },
        body: JSON.stringify({
          operationPublicId: preview.operationPublicId,
          previewHash: preview.previewHash,
        }),
      });

      const payload = (await response.json()) as ApplyResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Apply failed.");
      }

      setApplyResult(payload);
    } catch (applyError) {
      setError(
        applyError instanceof Error ? applyError.message : "Apply failed.",
      );
    } finally {
      setBusy(false);
    }
  }, [applyIdempotencyKey, basePath, preview]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Catalogue import</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Upload a CSV or XLSX file, review row-level changes, then apply
          validated draft updates. Imports never publish live menus.
        </p>
      </div>

      <section className="qos-card" data-padding="sm">
        <h2 className="text-lg font-medium">Format guidance</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Required columns: source ID, internal name, English and Arabic display
          names, price in minor units, and currency. Formula-leading cells are
          escaped on import.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <a
            className="qos-btn" data-variant="secondary" data-size="sm"
            href={`${basePath}/sample?format=csv`}
          >
            Download sample CSV
          </a>
          <a
            className="qos-btn" data-variant="secondary" data-size="sm"
            href={`${basePath}/sample?format=xlsx`}
          >
            Download sample XLSX
          </a>
        </div>
      </section>

      <section className="qos-card" data-padding="sm">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Connection key
            <input
              className="qos-input"
              value={connectionKey}
              onChange={(event) => setConnectionKey(event.target.value)}
              placeholder="quotes.synthetic"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Import file
            <input
              className="qos-input"
              type="file"
              accept=".csv,.xlsx"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setPreview(null);
                setApplyResult(null);
              }}
            />
          </label>
        </div>

        {headers.length > 0 ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {(
              [
                "sourceId",
                "internalName",
                "displayNameEn",
                "displayNameAr",
                "amountMinor",
                "currency",
              ] as const
            ).map((field) => (
              <label key={field} className="flex flex-col gap-1 text-sm">
                {field}
                <select
                  className="qos-input"
                  value={columnMapping[field]}
                  onChange={(event) =>
                    updateMappingField(field, event.target.value)
                  }
                >
                  <option value="">Select column</option>
                  {headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            className="qos-btn" data-variant="primary"
            disabled={busy || !file}
            onClick={() => void runPreview()}
            type="button"
          >
            Preview import
          </button>
          <button
            className="qos-btn" data-variant="secondary"
            disabled={busy || !preview}
            onClick={() => void runApply()}
            type="button"
          >
            Apply validated rows
          </button>
        </div>
      </section>

      {error ? (
        <p className="qos-alert" data-tone="error">
          {error}
        </p>
      ) : null}

      {preview ? (
        <section className="qos-card" data-padding="sm">
          <h2 className="text-lg font-medium">Preview</h2>
          <p className="mt-2 text-sm text-zinc-600">
            {preview.preview.createCount} create, {preview.preview.updateCount}{" "}
            update, {preview.preview.unchangedCount} unchanged,{" "}
            {preview.preview.errorCount} error, {preview.preview.duplicateCount}{" "}
            duplicate
          </p>
          {preview.warnings.length > 0 ? (
            <ul className="mt-2 list-disc pl-5 text-sm text-amber-700">
              {preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200">
                  <th className="px-2 py-2">Row</th>
                  <th className="px-2 py-2">Source ID</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">EN name</th>
                  <th className="px-2 py-2">AR name</th>
                  <th className="px-2 py-2">Price</th>
                  <th className="px-2 py-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {preview.preview.rows.map((row) => (
                  <tr key={`${row.sourceRow}-${row.sourceId}`} className="border-b border-zinc-100">
                    <td className="px-2 py-2">{row.sourceRow}</td>
                    <td className="px-2 py-2">{row.sourceId}</td>
                    <td className="px-2 py-2">{row.status}</td>
                    <td className="px-2 py-2">{row.displayNameEn}</td>
                    <td className="px-2 py-2">{row.displayNameAr}</td>
                    <td className="px-2 py-2">
                      {row.amountMinor != null
                        ? `${row.amountMinor} ${row.currency ?? ""}`
                        : "—"}
                    </td>
                    <td className="px-2 py-2">{row.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {applyResult ? (
        <section className="qos-card" data-padding="sm">
          <h2 className="text-lg font-medium">Apply report</h2>
          <p className="mt-2 text-sm text-zinc-600">
            {applyResult.replayed ? "Replayed prior apply. " : null}
            {applyResult.report.createCount} created,{" "}
            {applyResult.report.updateCount} updated,{" "}
            {applyResult.report.unchangedCount} unchanged,{" "}
            {applyResult.report.skippedCount} skipped,{" "}
            {applyResult.report.conflictCount} conflicts,{" "}
            {applyResult.report.errorCount} errors
          </p>
        </section>
      ) : null}
    </div>
  );
}
