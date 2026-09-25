"use client";

import { useCallback, useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/Modal";
import { Toast, ToastStack } from "@/components/Toast";
import { staffApiFetch } from "@/lib/staff/dev-fetch";

type TranslationFormState = {
  displayName: string;
  description: string;
  translationVersion: number;
};

type ProductEditorState = {
  publicId: string | null;
  internalName: string;
  sku: string;
  barcode: string;
  version: number;
  businessProfile: "hospitality" | "generic_retail";
  canEditPrice: boolean;
  nutritionCalories: string;
  priceMajor: string;
  translations: {
    en: TranslationFormState;
    ar: TranslationFormState;
  };
};

type ProductEditorProps = {
  tenantId: string;
  productPublicId?: string;
  initialBusinessProfile?: "hospitality" | "generic_retail";
};

const emptyTranslation = (): TranslationFormState => ({
  displayName: "",
  description: "",
  translationVersion: 1,
});

const initialState: ProductEditorState = {
  publicId: null,
  internalName: "",
  sku: "",
  barcode: "",
  version: 1,
  businessProfile: "generic_retail",
  canEditPrice: true,
  nutritionCalories: "",
  priceMajor: "",
  translations: {
    en: emptyTranslation(),
    ar: emptyTranslation(),
  },
};

function majorToMinor(value: string) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.round(parsed * 100);
}

function minorToMajor(value: number) {
  return (value / 100).toFixed(2);
}

function createEmptyFormState(
  businessProfile: "hospitality" | "generic_retail",
): ProductEditorState {
  return {
    ...initialState,
    businessProfile,
  };
}

export function ProductEditor({
  tenantId,
  productPublicId,
  initialBusinessProfile = "generic_retail",
}: ProductEditorProps) {
  const isEditMode = Boolean(productPublicId);
  const [form, setForm] = useState<ProductEditorState>(() =>
    createEmptyFormState(initialBusinessProfile),
  );
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(createEmptyFormState(initialBusinessProfile)),
  );
  const [loading, setLoading] = useState(false);
  const [hasLoadedProduct, setHasLoadedProduct] = useState(!isEditMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageStatus, setImageStatus] = useState<string | null>(null);
  const [thumbnailPublicId, setThumbnailPublicId] = useState<string | null>(
    null,
  );
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoStatus, setVideoStatus] = useState<string | null>(null);
  const [videoJobState, setVideoJobState] = useState<"queued" | "processing" | "ready" | "rejected" | "failed" | null>(null);
  const [videoRejectionReason, setVideoRejectionReason] = useState<string | null>(null);
  const [approvedVideoUrls, setApprovedVideoUrls] = useState<{ playbackUrl: string; posterUrl: string } | null>(null);

  const serializedForm = useMemo(() => JSON.stringify(form), [form]);
  const isDirty = baseline !== "" && serializedForm !== baseline;

  const loadApprovedVideoUrls = useCallback(async () => {
    if (!productPublicId) {
      return;
    }

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/media/videos/approved`,
      );

      const payload = (await response.json()) as {
        video?: { playbackUrl: string; posterUrl: string } | null;
        error?: string;
      };

      if (!response.ok) {
        return;
      }

      setApprovedVideoUrls(payload.video ?? null);
    } catch {
      // Silently fail - video URLs are optional
    }
  }, [productPublicId, tenantId]);

  const applyProductPayload = useCallback(
    (product: {
      publicId: string;
      internalName: string;
      version: number;
      sku: string | null;
      barcode: string | null;
      nutritionCalories: number | null;
      businessProfile: "hospitality" | "generic_retail";
      canEditPrice: boolean;
      defaultVariant: { amountMinor: number };
      translations: {
        en: TranslationFormState & { approvalStatus?: string };
        ar: TranslationFormState & { approvalStatus?: string };
      };
    }) => {
      const nextState: ProductEditorState = {
        publicId: product.publicId,
        internalName: product.internalName,
        sku: product.sku ?? "",
        barcode: product.barcode ?? "",
        version: product.version,
        businessProfile: product.businessProfile,
        canEditPrice: product.canEditPrice,
        nutritionCalories:
          product.nutritionCalories == null
            ? ""
            : String(product.nutritionCalories),
        priceMajor: minorToMajor(product.defaultVariant.amountMinor),
        translations: {
          en: {
            displayName: product.translations.en.displayName,
            description: product.translations.en.description ?? "",
            translationVersion: product.translations.en.translationVersion,
          },
          ar: {
            displayName: product.translations.ar.displayName,
            description: product.translations.ar.description ?? "",
            translationVersion: product.translations.ar.translationVersion,
          },
        },
      };

      setForm(nextState);
      setBaseline(JSON.stringify(nextState));
      setHasLoadedProduct(true);
      void loadApprovedVideoUrls();
    },
    [loadApprovedVideoUrls],
  );

  const loadProduct = useCallback(async () => {
    if (!productPublicId) {
      return;
    }

    setLoading(true);
    setError(null);
    setFieldError(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${productPublicId}`,
      );
      const payload = (await response.json()) as {
        product?: Parameters<typeof applyProductPayload>[0];
        error?: string;
        field?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load product.");
      }

      if (!payload.product) {
        throw new Error("Product payload is missing.");
      }

      applyProductPayload(payload.product);
    } finally {
      setLoading(false);
    }
  }, [applyProductPayload, productPublicId, tenantId]);

  function requestResetForm() {
    if (!isDirty) {
      return;
    }

    setDiscardOpen(true);
  }

  function resetForm() {
    setForm(JSON.parse(baseline) as ProductEditorState);
    setError(null);
    setFieldError(null);
    setSavedMessage(null);
    setDiscardOpen(false);
  }

  async function uploadProductImage(file: File) {
    if (!productPublicId) {
      return;
    }

    setImageUploading(true);
    setImageStatus(null);
    setError(null);

    try {
      const grantResponse = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/media/upload-grants`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedByteSize: file.size,
            expectedContentType: file.type,
          }),
        },
      );

      const grantPayload = (await grantResponse.json()) as {
        grant?: {
          assetPublicId: string;
          grantToken: string;
        };
        error?: string;
      };

      if (!grantResponse.ok || !grantPayload.grant) {
        throw new Error(grantPayload.error ?? "Unable to create upload grant.");
      }

      const uploadResponse = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/media/upload`,
        {
          method: "PUT",
          headers: {
            "X-QOS-Upload-Grant": grantPayload.grant.grantToken,
            "Content-Type": file.type,
          },
          body: file,
        },
      );

      const uploadPayload = (await uploadResponse.json()) as {
        error?: string;
      };

      if (!uploadResponse.ok) {
        throw new Error(uploadPayload.error ?? "Unable to upload image.");
      }

      const processResponse = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/media/process`,
        {
          method: "POST",
          body: JSON.stringify({
            assetPublicId: grantPayload.grant.assetPublicId,
          }),
        },
      );

      const processPayload = (await processResponse.json()) as {
        media?: {
          derivatives: Array<{
            kind: string;
            publicDerivativeId: string;
          }>;
        };
        error?: string;
      };

      if (!processResponse.ok || !processPayload.media) {
        throw new Error(processPayload.error ?? "Unable to process image.");
      }

      const thumbnail = processPayload.media.derivatives.find(
        (derivative) => derivative.kind === "thumbnail",
      );
      setThumbnailPublicId(thumbnail?.publicDerivativeId ?? null);
      setImageStatus("Product image approved and ready for menu publish.");
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Unable to upload product image.",
      );
    } finally {
      setImageUploading(false);
    }
  }

  async function uploadProductVideo(file: File) {
    if (!productPublicId) {
      return;
    }

    setVideoUploading(true);
    setVideoStatus("Uploading video...");
    setVideoRejectionReason(null);
    setError(null);

    try {
      const grantResponse = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/media/videos/upload-grants`,
        {
          method: "POST",
          body: JSON.stringify({
            byteSize: file.size,
            contentType: file.type,
          }),
        },
      );

      const grantPayload = (await grantResponse.json()) as {
        grant?: {
          assetPublicId: string;
          grantToken: string;
        };
        error?: string;
      };

      if (!grantResponse.ok || !grantPayload.grant) {
        throw new Error(grantPayload.error ?? "Unable to create upload grant.");
      }

      const uploadResponse = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/media/videos/upload`,
        {
          method: "PUT",
          headers: {
            "X-QOS-Upload-Grant": grantPayload.grant.grantToken,
            "Content-Type": file.type,
          },
          body: file,
        },
      );

      const uploadPayload = (await uploadResponse.json()) as {
        error?: string;
      };

      if (!uploadResponse.ok) {
        throw new Error(uploadPayload.error ?? "Unable to upload video.");
      }

      setVideoStatus("Queueing video for processing...");

      const queueResponse = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/media/videos/queue`,
        {
          method: "POST",
          body: JSON.stringify({
            assetPublicId: grantPayload.grant.assetPublicId,
          }),
        },
      );

      const queuePayload = (await queueResponse.json()) as {
        job?: {
          correlationId: string;
          status: string;
        };
        error?: string;
      };

      if (!queueResponse.ok || !queuePayload.job) {
        throw new Error(queuePayload.error ?? "Unable to queue video processing.");
      }

      setVideoJobState(queuePayload.job.status as typeof videoJobState);
      setVideoStatus("Video queued for processing.");
      void pollVideoJobStatus(queuePayload.job.correlationId);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Unable to upload product video.",
      );
      setVideoStatus(null);
    } finally {
      setVideoUploading(false);
    }
  }

  async function pollVideoJobStatus(correlationId: string) {
    if (!productPublicId) {
      return;
    }

    let attempts = 0;
    const maxAttempts = 60;
    const pollInterval = 3000;

    const poll = async () => {
      if (attempts >= maxAttempts) {
        setVideoStatus("Processing took too long. Check back later.");
        return;
      }

      attempts++;

      try {
        const statusResponse = await staffApiFetch(
          `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/media/videos/jobs/${correlationId}`,
        );

        const statusPayload = (await statusResponse.json()) as {
          job?: {
            status: string;
            lastErrorMessage?: string | null;
          };
          error?: string;
        };

        if (!statusResponse.ok || !statusPayload.job) {
          setVideoStatus("Unable to check processing status.");
          return;
        }

        const jobStatus = statusPayload.job.status;
        setVideoJobState(jobStatus as typeof videoJobState);

        if (jobStatus === "queued") {
          setVideoStatus("Video queued for processing...");
          setTimeout(poll, pollInterval);
        } else if (jobStatus === "processing") {
          setVideoStatus("Video is being processed...");
          setTimeout(poll, pollInterval);
        } else if (jobStatus === "ready") {
          setVideoStatus("Video processed successfully.");
          void loadApprovedVideoUrls();
        } else if (jobStatus === "rejected") {
          setVideoRejectionReason(
            statusPayload.job.lastErrorMessage ?? "Video was rejected during validation.",
          );
          setVideoStatus(null);
        } else if (jobStatus === "failed" || jobStatus === "quarantined") {
          setVideoStatus("Video processing failed. Please try again or contact support.");
        }
      } catch {
        setVideoStatus("Unable to check processing status.");
      }
    };

    setTimeout(poll, pollInterval);
  }

  async function saveProduct() {
    setSaving(true);
    setError(null);
    setFieldError(null);
    setSavedMessage(null);

    const amountMinor = majorToMinor(form.priceMajor);
    if (amountMinor == null) {
      setFieldError("defaultVariant.amountMinor");
      setError("Enter a valid AED price.");
      setSaving(false);
      return;
    }

    try {
      if (isEditMode && productPublicId) {
        const response = await staffApiFetch(
          `/api/tenants/${tenantId}/catalogue/products/${productPublicId}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              expectedVersion: form.version,
              internalName: form.internalName,
              sku: form.sku || null,
              barcode: form.barcode || null,
              nutritionCalories:
                form.businessProfile === "hospitality" && form.nutritionCalories
                  ? Number.parseInt(form.nutritionCalories, 10)
                  : null,
              translations: {
                en: {
                  displayName: form.translations.en.displayName,
                  description: form.translations.en.description || null,
                  expectedTranslationVersion:
                    form.translations.en.translationVersion,
                },
                ar: {
                  displayName: form.translations.ar.displayName,
                  description: form.translations.ar.description || null,
                  expectedTranslationVersion:
                    form.translations.ar.translationVersion,
                },
              },
              defaultVariant: form.canEditPrice
                ? { amountMinor }
                : undefined,
            }),
          },
        );

        const payload = (await response.json()) as {
          product?: Parameters<typeof applyProductPayload>[0];
          error?: string;
          field?: string;
        };

        if (!response.ok) {
          setFieldError(payload.field ?? null);
          throw new Error(payload.error ?? "Unable to save product.");
        }

        if (!payload.product) {
          throw new Error("Saved product payload is missing.");
        }

        applyProductPayload(payload.product);
        setSavedMessage("Draft product saved.");
        return;
      }

      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products`,
        {
          method: "POST",
          body: JSON.stringify({
            internalName: form.internalName,
            sku: form.sku || null,
            barcode: form.barcode || null,
            nutritionCalories:
              form.businessProfile === "hospitality" && form.nutritionCalories
                ? Number.parseInt(form.nutritionCalories, 10)
                : null,
            translations: {
              en: {
                displayName: form.translations.en.displayName,
                description: form.translations.en.description || null,
              },
              ar: {
                displayName: form.translations.ar.displayName,
                description: form.translations.ar.description || null,
              },
            },
            defaultVariant: {
              amountMinor,
              currency: "AED",
            },
          }),
        },
      );

      const payload = (await response.json()) as {
        product?: Parameters<typeof applyProductPayload>[0];
        error?: string;
        field?: string;
      };

      if (!response.ok) {
        setFieldError(payload.field ?? null);
        throw new Error(payload.error ?? "Unable to create product.");
      }

      if (!payload.product) {
        throw new Error("Created product payload is missing.");
      }

      applyProductPayload(payload.product);
      setSavedMessage(`Draft product ${payload.product.publicId} created.`);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save product.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (isEditMode && !hasLoadedProduct && !loading) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-zinc-600">
          Load the draft product to begin editing.
        </p>
        <button
          type="button"
          onClick={() =>
            void loadProduct().catch((loadError) => {
              setError(
                loadError instanceof Error
                  ? loadError.message
                  : "Unable to load product.",
              );
            })
          }
          className="qos-btn" data-variant="secondary"
        >
          Load product
        </button>
        {error ? (
          <p className="qos-alert" data-tone="error">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  if (loading) {
    return <p className="text-sm text-zinc-600">Loading product…</p>;
  }

  return (
    <div className="space-y-6">
      {isEditMode ? (
        <button
          type="button"
          onClick={() =>
            void loadProduct().catch((loadError) => {
              setError(
                loadError instanceof Error
                  ? loadError.message
                  : "Unable to reload product.",
              );
            })
          }
          className="qos-btn" data-variant="secondary"
        >
          Reload product
        </button>
      ) : null}

      <section className="qos-card" data-padding="md">
        <h2 className="text-lg font-semibold">General information</h2>
        <div className="mt-4 grid gap-4">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-zinc-700">
              Internal name
            </span>
            <input
              className="qos-input"
              value={form.internalName}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  internalName: event.target.value,
                }))
              }
            />
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-zinc-700">SKU</span>
              <input
                className="qos-input"
                value={form.sku}
                onChange={(event) =>
                  setForm((current) => ({ ...current, sku: event.target.value }))
                }
              />
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-zinc-700">Barcode</span>
              <input
                className="qos-input"
                value={form.barcode}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    barcode: event.target.value,
                  }))
                }
              />
            </label>
          </div>
        </div>
      </section>

      <section className="qos-card" data-padding="md">
        <h2 className="text-lg font-semibold">English copy</h2>
        <div className="mt-4 grid gap-4">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-zinc-700">
              Display name
            </span>
            <input
              className="qos-input"
              value={form.translations.en.displayName}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  translations: {
                    ...current.translations,
                    en: {
                      ...current.translations.en,
                      displayName: event.target.value,
                    },
                  },
                }))
              }
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-zinc-700">
              Description
            </span>
            <textarea
              className="qos-textarea"
              value={form.translations.en.description}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  translations: {
                    ...current.translations,
                    en: {
                      ...current.translations.en,
                      description: event.target.value,
                    },
                  },
                }))
              }
            />
          </label>
          <p className="text-xs text-zinc-500">
            Translation version: {form.translations.en.translationVersion}
          </p>
        </div>
      </section>

      <section className="qos-card" data-padding="md">
        <h2 className="text-lg font-semibold">Arabic copy</h2>
        <div className="mt-4 grid gap-4">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-zinc-700">
              Display name
            </span>
            <input
              dir="rtl"
              className="qos-input"
              value={form.translations.ar.displayName}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  translations: {
                    ...current.translations,
                    ar: {
                      ...current.translations.ar,
                      displayName: event.target.value,
                    },
                  },
                }))
              }
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-zinc-700">
              Description
            </span>
            <textarea
              dir="rtl"
              className="qos-textarea"
              value={form.translations.ar.description}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  translations: {
                    ...current.translations,
                    ar: {
                      ...current.translations.ar,
                      description: event.target.value,
                    },
                  },
                }))
              }
            />
          </label>
          <p className="text-xs text-zinc-500">
            Translation version: {form.translations.ar.translationVersion}
          </p>
        </div>
      </section>

      <section className="qos-card" data-padding="md">
        <h2 className="text-lg font-semibold">Pricing</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-zinc-700">
              Default variant price (AED)
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              disabled={!form.canEditPrice}
              className="qos-select"
              value={form.priceMajor}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  priceMajor: event.target.value,
                }))
              }
            />
            {!form.canEditPrice ? (
              <span className="text-xs text-zinc-500">
                Price changes require an administrator.
              </span>
            ) : null}
          </label>
          {form.businessProfile === "hospitality" ? (
            <label className="block space-y-2">
              <span className="text-sm font-medium text-zinc-700">
                Calories (optional)
              </span>
              <input
                type="number"
                min="0"
                step="1"
                className="qos-input"
                value={form.nutritionCalories}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    nutritionCalories: event.target.value,
                  }))
                }
              />
            </label>
          ) : null}
        </div>
      </section>

      {isEditMode && productPublicId ? (
        <section className="qos-card" data-padding="md">
          <h2 className="text-lg font-semibold">Product image</h2>
          <p className="mt-2 text-sm text-zinc-600">
            Upload a JPEG or PNG image. It is quarantined, validated, and
            converted to approved public derivatives for menu publish.
          </p>
          <div className="mt-4 space-y-3">
            <input
              type="file"
              accept="image/jpeg,image/png"
              disabled={imageUploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void uploadProductImage(file);
                }
                event.target.value = "";
              }}
              className="block w-full text-sm text-zinc-700 file:mr-4 file:rounded-full file:border-0 file:bg-zinc-100 file:px-4 file:py-2 file:text-sm file:font-medium"
            />
            {imageUploading ? (
              <p className="text-sm text-zinc-600">Uploading and processing…</p>
            ) : null}
            {imageStatus ? (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                {imageStatus}
              </p>
            ) : null}
            {thumbnailPublicId ? (
              <p className="text-xs text-zinc-500">
                Thumbnail public id:{" "}
                <code className="rounded bg-zinc-100 px-1.5 py-0.5">
                  {thumbnailPublicId}
                </code>
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {isEditMode && productPublicId ? (
        <section className="qos-card" data-padding="md">
          <h2 className="text-lg font-semibold">Product video</h2>
          <p className="mt-2 text-sm text-zinc-600">
            Upload an MP4 video (max 20 MiB, 25 seconds, 1080p, H.264 or H.265).
            The video is validated and transcoded asynchronously.
          </p>
          <div className="mt-4 space-y-3">
            <input
              type="file"
              accept="video/mp4"
              disabled={videoUploading || videoJobState === "queued" || videoJobState === "processing"}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void uploadProductVideo(file);
                }
                event.target.value = "";
              }}
              className="block w-full text-sm text-zinc-700 file:mr-4 file:rounded-full file:border-0 file:bg-zinc-100 file:px-4 file:py-2 file:text-sm file:font-medium"
            />
            {videoUploading ? (
              <p className="text-sm text-zinc-600">Uploading video…</p>
            ) : null}
            {videoStatus ? (
              <p className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                {videoStatus}
              </p>
            ) : null}
            {videoRejectionReason ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                Video rejected: {videoRejectionReason}
              </p>
            ) : null}
            {approvedVideoUrls ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                <p className="text-sm font-medium text-emerald-800">Video ready</p>
                <p className="mt-1 text-xs text-emerald-700">
                  Playback and poster derivatives are approved for menu publish.
                </p>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {error ? (
        <p className="qos-alert" data-tone="error">
          {error}
          {fieldError ? ` (${fieldError})` : ""}
        </p>
      ) : null}

      {savedMessage ? (
        <ToastStack>
          <Toast
            tone="success"
            title={savedMessage}
            onDismiss={() => setSavedMessage(null)}
          />
        </ToastStack>
      ) : null}

      <ConfirmDialog
        open={discardOpen}
        tone="danger"
        title="Discard unsaved changes to this draft product?"
        description="The current draft will revert to the last saved version."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onClose={() => setDiscardOpen(false)}
        onConfirm={resetForm}
      />

      <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white/95 p-4 shadow-sm backdrop-blur">
        <p className="text-sm text-zinc-600">
          {isDirty ? "Unsaved changes" : "All changes saved locally"}
          {form.publicId ? (
            <>
              {" "}
              · Product <code>{form.publicId}</code> · Version {form.version}
            </>
          ) : null}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={requestResetForm}
            disabled={!isDirty || saving}
            className="qos-btn" data-variant="secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveProduct()}
            className="qos-btn" data-variant="primary"
          >
            {saving ? "Saving…" : "Save draft"}
          </button>
        </div>
      </div>
    </div>
  );
}
