"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/Modal";
import { shouldShowArchiveDraftProductAction } from "@/lib/catalogue/product-archive-action";
import {
  productEditorIsReadOnly,
  productEditorLoadButtonLabel,
  productEditorLoadPrompt,
  productEditorRestoreLabel,
  productEditorRestoreSuccessNotice,
  productEditorSaveLabel,
  type CatalogueProductEditorStatus,
} from "@/lib/catalogue/product-editor-copy";
import {
  productEditorCanRemovePrimaryPhoto,
  productEditorChildMutationsDisabled,
} from "@/lib/catalogue/product-editor-mutation-ui";
import { Toast, ToastStack } from "@/components/Toast";
import { mapVideoErrorToFriendlyMessage } from "@/lib/media/video-error-messages";
import { AiPhotoProvenanceMeta } from "@/app/tenants/[tenantId]/catalogue/menus/ai-photo-provenance-meta";
import { AiDescriptionReview } from "@/app/tenants/[tenantId]/catalogue/products/ai-description-review";
import { Button } from "@/components/Button";
import {
  productStatusBadge,
  publicProductThumbnailUrl,
} from "@/components/platform/catalogue-products-list";
import {
  PortalBadge,
  PortalField,
  PortalFileInput,
  PortalNotice,
} from "@/components/portal/workspace/PortalWorkspace";
import type {
  StaffMediaProvenanceView,
  StaffRemovedPrimaryPhotoView,
} from "@/lib/media/ai-photos/staff-media-provenance";
import { ProductRemovedPhotoHistory } from "@/app/tenants/[tenantId]/catalogue/products/product-removed-photo-history";
import { ProductEditorSection } from "@/app/tenants/[tenantId]/catalogue/products/product-editor-section";
import { ProductModifierGroupsPanel } from "@/app/tenants/[tenantId]/catalogue/products/product-modifier-groups-panel";
import { ProductVariantsPanel } from "@/app/tenants/[tenantId]/catalogue/products/product-variants-panel";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { staffApiFetch } from "@/lib/staff/dev-fetch";
import { staffUiCopy } from "@/lib/staff/locale";

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
  catalogueProductStatusHint?: CatalogueProductEditorStatus;
  onStatusChange?: (status: CatalogueProductEditorStatus) => void;
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
  catalogueProductStatusHint = null,
  onStatusChange,
}: ProductEditorProps) {
  const router = useRouter();
  const { locale } = useStaffLocale();
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
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [productStatus, setProductStatus] = useState<
    "draft" | "active" | "archived" | null
  >(null);
  const editorStatus = productStatus ?? catalogueProductStatusHint;
  const isReadOnly = productEditorIsReadOnly(productStatus);
  const childMutationsDisabled =
    productEditorChildMutationsDisabled(editorStatus);
  const [isAdministrator, setIsAdministrator] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageStatus, setImageStatus] = useState<string | null>(null);
  const [thumbnailPublicId, setThumbnailPublicId] = useState<string | null>(
    null,
  );
  const [primaryMediaSource, setPrimaryMediaSource] = useState<
    "ai_generated" | "operator_entered" | "imported" | null
  >(null);
  const [mediaProvenance, setMediaProvenance] = useState<StaffMediaProvenanceView | null>(
    null,
  );
  const [removedPhotoHistory, setRemovedPhotoHistory] = useState<
    StaffRemovedPrimaryPhotoView[]
  >([]);
  const [removingPhoto, setRemovingPhoto] = useState(false);
  const [removePhotoConfirmOpen, setRemovePhotoConfirmOpen] = useState(false);
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoStatus, setVideoStatus] = useState<string | null>(null);
  const [videoJobState, setVideoJobState] = useState<"queued" | "processing" | "ready" | "rejected" | "failed" | "quarantined" | null>(null);
  const [videoRejectionReason, setVideoRejectionReason] = useState<string | null>(null);
  const [approvedVideoUrls, setApprovedVideoUrls] = useState<{ playbackUrl: string; posterUrl: string } | null>(null);
  const [selectedVideoFilename, setSelectedVideoFilename] = useState<string | null>(null);
  const [selectedPhotoFilename, setSelectedPhotoFilename] = useState<string | null>(null);
  const photoHelpId = useId();
  const videoHelpId = useId();
  const activeCorrelationIdRef = useRef<string | null>(null);

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

  function applyProductPayload(product: {
      publicId: string;
      internalName: string;
      version: number;
      sku: string | null;
      barcode: string | null;
      nutritionCalories: number | null;
      businessProfile: "hospitality" | "generic_retail";
      canEditPrice: boolean;
      status: "draft" | "active" | "archived";
      thumbnailPublicId?: string | null;
      primaryMediaSource?: "ai_generated" | "operator_entered" | "imported" | null;
      defaultVariant: { amountMinor: number };
      translations: {
        en: TranslationFormState & { approvalStatus?: string };
        ar: TranslationFormState & { approvalStatus?: string };
      };
  }) {
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
      setProductStatus(product.status);
      setIsAdministrator(product.canEditPrice);
      setThumbnailPublicId(product.thumbnailPublicId ?? null);
      setPrimaryMediaSource(product.primaryMediaSource ?? null);
      void loadApprovedVideoUrls();
      void loadMediaProvenance(product.publicId);
      if (product.canEditPrice) {
        void loadRemovedPhotoHistory(product.publicId);
      } else {
        setRemovedPhotoHistory([]);
      }
  }

  async function loadRemovedPhotoHistory(publicId: string) {
    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${publicId}/media/removed-history`,
      );
      const payload = (await response.json()) as {
        removedHistory?: StaffRemovedPrimaryPhotoView[];
      };
      if (response.ok) {
        setRemovedPhotoHistory(payload.removedHistory ?? []);
      }
    } catch {
      setRemovedPhotoHistory([]);
    }
  }

  async function loadMediaProvenance(publicId: string) {
    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${publicId}/media/provenance`,
      );
      const payload = (await response.json()) as {
        provenance?: StaffMediaProvenanceView | null;
      };
      if (response.ok) {
        setMediaProvenance(payload.provenance ?? null);
      }
    } catch {
      setMediaProvenance(null);
    }
  }

  async function removeProductPhoto() {
    if (!productPublicId) {
      return;
    }
    setRemovingPhoto(true);
    setError(null);
    setImageStatus(null);
    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/media/primary/remove`,
        {
          method: "POST",
          body: JSON.stringify({ expectedVersion: form.version }),
        },
      );
      const payload = (await response.json()) as {
        result?: { version: number };
        error?: string;
        field?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to remove product photo.");
      }
      if (payload.result?.version) {
        setForm((current) => ({ ...current, version: payload.result!.version }));
        setBaseline((current) => {
          const parsed = JSON.parse(current) as ProductEditorState;
          return JSON.stringify({ ...parsed, version: payload.result!.version });
        });
      }
      setThumbnailPublicId(null);
      setPrimaryMediaSource(null);
      setMediaProvenance(null);
      setImageStatus(staffUiCopy(locale, "productPhotoRemoved"));
      if (isAdministrator && productPublicId) {
        void loadRemovedPhotoHistory(productPublicId);
      }
    } catch (removeError) {
      setError(
        removeError instanceof Error ? removeError.message : "Unable to remove product photo.",
      );
    } finally {
      setRemovingPhoto(false);
    }
  }

  useEffect(() => {
    onStatusChange?.(productStatus);
  }, [onStatusChange, productStatus]);

  const showArchiveAction = shouldShowArchiveDraftProductAction(
    productStatus ?? "",
    isAdministrator,
  );
  const showRestoreAction = productStatus === "archived" && isAdministrator;

  async function restoreProduct() {
    if (!productPublicId) {
      return;
    }

    setRestoring(true);
    setError(null);
    setFieldError(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/restore`,
        { method: "POST" },
      );
      const payload = (await response.json()) as {
        error?: string;
        field?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to restore product.");
      }

      setSavedMessage(productEditorRestoreSuccessNotice(locale));
      await loadProduct();
    } catch (restoreError) {
      setError(
        restoreError instanceof Error
          ? restoreError.message
          : "Unable to restore product.",
      );
    } finally {
      setRestoring(false);
    }
  }

  async function archiveProduct() {
    if (!productPublicId) {
      return;
    }

    setArchiving(true);
    setError(null);
    setFieldError(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/archive`,
        { method: "POST" },
      );
      const payload = (await response.json()) as {
        error?: string;
        field?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to archive product.");
      }

      router.push(`/tenants/${tenantId}/catalogue?productArchived=1`);
    } catch (archiveError) {
      setError(
        archiveError instanceof Error
          ? archiveError.message
          : "Unable to archive product.",
      );
      setArchiveOpen(false);
    } finally {
      setArchiving(false);
    }
  }

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
      setPrimaryMediaSource("operator_entered");
      void loadMediaProvenance(productPublicId);
      setImageStatus(staffUiCopy(locale, "productEditorPhotoApproved"));
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

    activeCorrelationIdRef.current = null;

    setVideoUploading(true);
    setVideoStatus(staffUiCopy(locale, "videoUploadingStatus"));
    setVideoRejectionReason(null);
    setError(null);
    setSelectedVideoFilename(file.name);

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
        const friendlyMessage = mapVideoErrorToFriendlyMessage(
          grantPayload.error ?? null,
          locale,
        );
        setVideoRejectionReason(friendlyMessage);
        setVideoStatus(null);
        setVideoUploading(false);
        return;
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
        const friendlyMessage = mapVideoErrorToFriendlyMessage(
          uploadPayload.error ?? null,
          locale,
        );
        setVideoRejectionReason(friendlyMessage);
        setVideoStatus(null);
        setVideoUploading(false);
        return;
      }

      setVideoStatus(staffUiCopy(locale, "videoQueueingStatus"));

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
          supersededCount?: number;
        };
        error?: string;
      };

      if (!queueResponse.ok || !queuePayload.job) {
        const friendlyMessage = mapVideoErrorToFriendlyMessage(
          queuePayload.error ?? null,
          locale,
        );
        setVideoRejectionReason(friendlyMessage);
        setVideoStatus(null);
        setVideoUploading(false);
        return;
      }

      activeCorrelationIdRef.current = queuePayload.job.correlationId;
      setVideoJobState(queuePayload.job.status as typeof videoJobState);
      setVideoStatus(staffUiCopy(locale, "videoQueuedStatus"));
      
      if (queuePayload.job.supersededCount && queuePayload.job.supersededCount > 0) {
        setVideoRejectionReason(staffUiCopy(locale, "videoSuperseded"));
      }
      
      void pollVideoJobStatus(queuePayload.job.correlationId);
    } catch (uploadError) {
      const friendlyMessage = mapVideoErrorToFriendlyMessage(
        uploadError instanceof Error ? uploadError.message : null,
        locale,
      );
      setVideoRejectionReason(friendlyMessage);
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
      if (activeCorrelationIdRef.current !== correlationId) {
        return;
      }

      if (attempts >= maxAttempts) {
        if (activeCorrelationIdRef.current === correlationId) {
          setVideoStatus(staffUiCopy(locale, "productEditorVideoProcessingTimeout"));
        }
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
          if (activeCorrelationIdRef.current === correlationId) {
            setVideoStatus(staffUiCopy(locale, "videoCheckStatusError"));
          }
          return;
        }

        if (activeCorrelationIdRef.current !== correlationId) {
          return;
        }

        const jobStatus = statusPayload.job.status;
        setVideoJobState(jobStatus as typeof videoJobState);

        if (jobStatus === "queued") {
          setVideoStatus(staffUiCopy(locale, "videoQueuedStatus"));
          setTimeout(poll, pollInterval);
        } else if (jobStatus === "processing") {
          setVideoStatus(staffUiCopy(locale, "videoProcessingStatus"));
          setTimeout(poll, pollInterval);
        } else if (jobStatus === "ready") {
          setVideoStatus(null);
          void loadApprovedVideoUrls();
        } else if (jobStatus === "rejected" || jobStatus === "quarantined") {
          const friendlyMessage = mapVideoErrorToFriendlyMessage(
            statusPayload.job.lastErrorMessage ?? null,
            locale,
          );
          setVideoRejectionReason(friendlyMessage);
          setVideoStatus(null);
        } else if (jobStatus === "failed") {
          setVideoRejectionReason(mapVideoErrorToFriendlyMessage(null, locale));
          setVideoStatus(null);
        }
      } catch {
        if (activeCorrelationIdRef.current === correlationId) {
          setVideoStatus(staffUiCopy(locale, "videoCheckStatusError"));
        }
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
      setError(staffUiCopy(locale, "productEditorInvalidPrice"));
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
        setSavedMessage(staffUiCopy(locale, "productEditorSavedDraftNotice"));
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
      setSavedMessage(
        `${staffUiCopy(locale, "productEditorCreatedDraftNotice")} ${payload.product.publicId}`,
      );
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
      <div className="qosp-stack">
        <p className="qosp-meta-line">
          {productEditorLoadPrompt(editorStatus, locale)}
        </p>
        <div>
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
            {productEditorLoadButtonLabel(locale, false)}
          </button>
        </div>
        {error ? <PortalNotice tone="error">{error}</PortalNotice> : null}
      </div>
    );
  }

  if (loading) {
    return (
      <p className="qosp-meta-line" role="status">
        {staffUiCopy(locale, "productEditorLoading")}
      </p>
    );
  }

  const statusBadge = productStatus
    ? productStatusBadge(locale, productStatus)
    : null;

  return (
    <div className="qosp-editor">
      {isEditMode ? (
        <div className="qosp-button-row" data-align="end">
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
            className="qos-btn"
            data-variant="secondary"
            data-size="sm"
          >
            {productEditorLoadButtonLabel(locale, true)}
          </button>
        </div>
      ) : null}

      <fieldset disabled={isReadOnly}>
        <ProductEditorSection
          id="identity"
          titleKey="productEditorSectionIdentityTitle"
          helperKey="productEditorSectionIdentityHelp"
          locale={locale}
        >
          <div className="qosp-form-grid">
            <PortalField
              label={staffUiCopy(locale, "productEditorInternalNameLabel")}
              help={staffUiCopy(locale, "productEditorInternalNameHelp")}
            >
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
            </PortalField>
            <div className="qosp-form-grid" data-columns="2">
              <PortalField
                label={staffUiCopy(locale, "productEditorSkuLabel")}
                help={staffUiCopy(locale, "productEditorSkuHelp")}
              >
                <input
                  className="qos-input"
                  value={form.sku}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, sku: event.target.value }))
                  }
                />
              </PortalField>
              <PortalField
                label={staffUiCopy(locale, "productEditorBarcodeLabel")}
                help={staffUiCopy(locale, "productEditorBarcodeHelp")}
              >
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
              </PortalField>
            </div>
          </div>
        </ProductEditorSection>

        <ProductEditorSection
          id="english"
          titleKey="productEditorSectionEnglishTitle"
          helperKey="productEditorSectionEnglishHelp"
          locale={locale}
        >
          <div className="qosp-form-grid">
            <PortalField label={staffUiCopy(locale, "productEditorDisplayNameLabel")}>
              <input
                dir="ltr"
                lang="en"
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
            </PortalField>
            <PortalField label={staffUiCopy(locale, "productEditorDescriptionLabel")}>
              <textarea
                dir="ltr"
                lang="en"
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
            </PortalField>
            <p className="qosp-meta-line">
              {staffUiCopy(locale, "productEditorTranslationVersionLabel")}:{" "}
              {form.translations.en.translationVersion}
            </p>
            {isEditMode && productPublicId ? (
              <AiDescriptionReview
                tenantId={tenantId}
                productPublicId={productPublicId}
                uiLocale={locale}
                mutationsDisabled={childMutationsDisabled}
                onAccepted={() => {
                  void loadProduct().catch((loadError) => {
                    setError(
                      loadError instanceof Error
                        ? loadError.message
                        : "Unable to reload product after accepting the description.",
                    );
                  });
                }}
              />
            ) : null}
          </div>
        </ProductEditorSection>

        <ProductEditorSection
          id="arabic"
          titleKey="productEditorSectionArabicTitle"
          helperKey="productEditorSectionArabicHelp"
          locale={locale}
        >
          <div className="qosp-form-grid">
            <PortalField label={staffUiCopy(locale, "productEditorDisplayNameLabel")}>
              <input
                dir="rtl"
                lang="ar"
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
            </PortalField>
            <PortalField label={staffUiCopy(locale, "productEditorDescriptionLabel")}>
              <textarea
                dir="rtl"
                lang="ar"
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
            </PortalField>
            <p className="qosp-meta-line">
              {staffUiCopy(locale, "productEditorTranslationVersionLabel")}:{" "}
              {form.translations.ar.translationVersion}
            </p>
          </div>
        </ProductEditorSection>

        <ProductEditorSection
          id="pricing"
          titleKey="productEditorSectionPricingTitle"
          helperKey="productEditorSectionPricingHelp"
          locale={locale}
        >
          <div className="qosp-form-grid" data-columns="2">
            <PortalField
              label={staffUiCopy(locale, "productEditorDefaultPriceLabel")}
              help={
                form.canEditPrice
                  ? staffUiCopy(locale, "productEditorDefaultPriceHelp")
                  : `${staffUiCopy(locale, "productEditorDefaultPriceHelp")} ${staffUiCopy(locale, "productEditorPriceAdminNotice")}`
              }
            >
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                dir="ltr"
                disabled={!form.canEditPrice}
                className="qos-input"
                value={form.priceMajor}
                aria-invalid={fieldError === "defaultVariant.amountMinor" || undefined}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    priceMajor: event.target.value,
                  }))
                }
              />
            </PortalField>
            {form.businessProfile === "hospitality" ? (
              <PortalField label={staffUiCopy(locale, "productEditorCaloriesLabel")}>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  dir="ltr"
                  className="qos-input"
                  value={form.nutritionCalories}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      nutritionCalories: event.target.value,
                    }))
                  }
                />
              </PortalField>
            ) : null}
          </div>
        </ProductEditorSection>

        {isEditMode && productPublicId ? (
          <ProductEditorSection
            id="media"
            titleKey="productEditorSectionMediaTitle"
            helperKey="productEditorSectionMediaHelp"
            locale={locale}
          >
            <div className="qosp-stack">
              <h3 className="qosp-subcard-title">
                {staffUiCopy(locale, "productEditorPhotoLabel")}
              </h3>
              <p className="qosp-meta-line" id={photoHelpId}>
                {staffUiCopy(locale, "productEditorPhotoHelp")}
              </p>
              {thumbnailPublicId ? (
                <div className="qosp-photo-row">
                  <span className="qosp-photo">
                    {/* eslint-disable-next-line @next/next/no-img-element -- catalogue thumbnail */}
                    <img src={publicProductThumbnailUrl(thumbnailPublicId)} alt="" />
                    {primaryMediaSource === "ai_generated" ? (
                      <span
                        className="qosp-photo-tag"
                        title={staffUiCopy(locale, "aiGeneratedImageTitle")}
                      >
                        AI
                      </span>
                    ) : null}
                  </span>
                  <div className="qosp-stack" style={{ flex: "1 1 200px", gap: 10 }}>
                    <AiPhotoProvenanceMeta
                      locale={locale}
                      generation={mediaProvenance?.generation ?? null}
                    />
                    {productEditorCanRemovePrimaryPhoto(editorStatus) &&
                    !childMutationsDisabled ? (
                      <div>
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={removingPhoto}
                          disabled={imageUploading}
                          onClick={() => setRemovePhotoConfirmOpen(true)}
                        >
                          {removingPhoto
                            ? staffUiCopy(locale, "removingProductPhoto")
                            : staffUiCopy(locale, "removeProductPhoto")}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <PortalFileInput
                accept="image/jpeg,image/png"
                disabled={imageUploading || childMutationsDisabled}
                fileName={selectedPhotoFilename}
                describedBy={photoHelpId}
                onFile={(file) => {
                  setSelectedPhotoFilename(file.name);
                  void uploadProductImage(file);
                }}
              />
              {imageUploading ? (
                <p className="qosp-meta-line" role="status">
                  {staffUiCopy(locale, "productEditorUploadingPhoto")}
                </p>
              ) : null}
              {imageStatus ? <PortalNotice tone="success">{imageStatus}</PortalNotice> : null}
              {isAdministrator ? (
                <ProductRemovedPhotoHistory
                  locale={locale}
                  entries={removedPhotoHistory}
                />
              ) : null}
            </div>

            <hr className="qosp-divider" />

            <div className="qosp-stack">
              <h3 className="qosp-subcard-title">
                {staffUiCopy(locale, "productVideoLabel")}
              </h3>
              <p className="qosp-meta-line" id={videoHelpId}>
                {staffUiCopy(locale, "videoDescription")}
              </p>
              {approvedVideoUrls ? (
                <div className="qosp-stack" style={{ gap: 10 }}>
                  <video controls poster={approvedVideoUrls.posterUrl}>
                    <source src={approvedVideoUrls.playbackUrl} type="video/mp4" />
                    {staffUiCopy(locale, "videoPlayerFallback")}
                  </video>
                  <p className="qosp-meta-line">
                    {staffUiCopy(locale, "videoReadyForPublish")}
                  </p>
                </div>
              ) : null}
              {videoRejectionReason ? (
                <PortalNotice tone="error">{videoRejectionReason}</PortalNotice>
              ) : null}
              {videoStatus ? <PortalNotice tone="info">{videoStatus}</PortalNotice> : null}
              <PortalFileInput
                accept="video/mp4"
                disabled={videoUploading || childMutationsDisabled}
                fileName={selectedVideoFilename}
                describedBy={videoHelpId}
                onFile={(file) => {
                  setVideoRejectionReason(null);
                  void uploadProductVideo(file);
                }}
              />
              {videoUploading ? (
                <p className="qosp-meta-line" role="status">
                  {staffUiCopy(locale, "videoUploadingStatus")}
                </p>
              ) : null}
            </div>
          </ProductEditorSection>
        ) : null}

        {isEditMode && productPublicId ? (
          <ProductEditorSection
            id="variants"
            titleKey="productEditorSectionVariantsTitle"
            helperKey="productEditorSectionVariantsHelp"
            locale={locale}
          >
            <ProductVariantsPanel
              tenantId={tenantId}
              productPublicId={productPublicId}
              productStatus={editorStatus}
            />
          </ProductEditorSection>
        ) : null}

        {isEditMode && productPublicId ? (
          <ProductEditorSection
            id="modifier-groups"
            titleKey="productEditorSectionModifierGroupsTitle"
            helperKey="productEditorSectionModifierGroupsHelp"
            locale={locale}
          >
            <ProductModifierGroupsPanel
              tenantId={tenantId}
              productPublicId={productPublicId}
              productStatus={editorStatus}
            />
          </ProductEditorSection>
        ) : null}

        {isEditMode && productPublicId ? (
          <ProductEditorSection
            id="status"
            titleKey="productEditorSectionStatusTitle"
            helperKey="productEditorSectionStatusHelp"
            locale={locale}
          >
            <div className="qosp-stack">
              <p className="qosp-meta-line" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                <span>{staffUiCopy(locale, "productEditorCurrentStatus")}</span>
                {statusBadge ? (
                  <PortalBadge tone={statusBadge.tone}>{statusBadge.label}</PortalBadge>
                ) : (
                  <span>—</span>
                )}
              </p>

              {showRestoreAction ? (
                <div className="qosp-subcard qosp-stack" style={{ gap: 12 }}>
                  <p className="qosp-meta-line">
                    {staffUiCopy(locale, "productEditorRestoreHelp")}
                  </p>
                  <div>
                    <button
                      type="button"
                      className="qos-btn"
                      data-variant="secondary"
                      disabled={restoring}
                      onClick={() => void restoreProduct()}
                    >
                      {productEditorRestoreLabel(locale, restoring)}
                    </button>
                  </div>
                </div>
              ) : null}

              {showArchiveAction ? (
                <div className="qosp-subcard qosp-stack" style={{ gap: 12 }}>
                  <p className="qosp-meta-line">
                    {staffUiCopy(locale, "archiveDraftProductDescription")}
                  </p>
                  <div>
                    <button
                      type="button"
                      className="qos-btn"
                      data-variant="secondary"
                      disabled={archiving || saving}
                      onClick={() => setArchiveOpen(true)}
                    >
                      {archiving
                        ? staffUiCopy(locale, "archiveDraftProductArchiving")
                        : staffUiCopy(locale, "archiveDraftProduct")}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </ProductEditorSection>
        ) : null}
      </fieldset>

      {error ? (
        <PortalNotice tone="error">
          {error}
          {fieldError ? ` (${fieldError})` : ""}
        </PortalNotice>
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
        title={staffUiCopy(locale, "discardUnsavedProductTitle")}
        description={staffUiCopy(locale, "discardUnsavedProductDescription")}
        confirmLabel={staffUiCopy(locale, "discard")}
        cancelLabel={staffUiCopy(locale, "keepEditing")}
        onClose={() => setDiscardOpen(false)}
        onConfirm={resetForm}
      />

      <ConfirmDialog
        open={archiveOpen}
        tone="danger"
        title={staffUiCopy(locale, "archiveDraftProductConfirmTitle")}
        description={staffUiCopy(locale, "archiveDraftProductConfirmDescription")}
        confirmLabel={staffUiCopy(locale, "archiveDraftProductConfirmLabel")}
        cancelLabel={staffUiCopy(locale, "cancel")}
        onClose={() => setArchiveOpen(false)}
        onConfirm={() => void archiveProduct()}
      />

      <ConfirmDialog
        open={removePhotoConfirmOpen}
        tone="danger"
        title={staffUiCopy(locale, "removeProductPhotoConfirmTitle")}
        description={staffUiCopy(locale, "removeProductPhotoConfirmDescription")}
        confirmLabel={staffUiCopy(locale, "removeProductPhotoConfirmLabel")}
        cancelLabel={staffUiCopy(locale, "cancel")}
        onClose={() => setRemovePhotoConfirmOpen(false)}
        onConfirm={() => {
          setRemovePhotoConfirmOpen(false);
          void removeProductPhoto();
        }}
      />

      {!isReadOnly ? (
        <div className="qosp-savebar">
          <p>
            {isDirty
              ? staffUiCopy(locale, "productEditorUnsavedChanges")
              : staffUiCopy(locale, "productEditorAllSavedLocally")}
            {form.publicId ? (
              <>
                {" "}
                · {staffUiCopy(locale, "productEditorProductLabel")}{" "}
                <code className="qosp-code" dir="ltr">{form.publicId}</code> ·{" "}
                {staffUiCopy(locale, "productEditorVersionLabel")} {form.version}
              </>
            ) : null}
          </p>
          <div className="qosp-button-row">
            <button
              type="button"
              onClick={requestResetForm}
              disabled={!isDirty || saving}
              className="qos-btn"
              data-variant="secondary"
            >
              {staffUiCopy(locale, "cancel")}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveProduct()}
              className="qos-btn"
              data-variant="primary"
            >
              {productEditorSaveLabel(productStatus, locale, saving)}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
