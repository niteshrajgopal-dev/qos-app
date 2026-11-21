"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

import { Modal } from "@/components/Modal";
import { usePortalShell } from "@/components/portal/portal-shell-context";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import type {
  BranchChangeGuard,
  UnsavedWorkRegistration,
} from "@/lib/staff/branch-change-guard-state";
import { isolateText } from "@/lib/staff/branch-copy";
import { staffCopyWith, staffUiCopy, type StaffLocale } from "@/lib/staff/locale";

/**
 * Registers a screen's unsaved work with the shell so a branch change asks
 * first. `saveDraft` must call the screen's real draft service and reject on
 * failure; never resolve it without saving.
 */
export function useUnsavedWork({ isDirty, saveDraft, discard }: UnsavedWorkRegistration) {
  const { registerUnsavedWork } = usePortalShell();
  const latest = useRef<UnsavedWorkRegistration>({ isDirty, saveDraft, discard });

  useEffect(() => {
    latest.current = { isDirty, saveDraft, discard };
  });

  useEffect(
    () =>
      registerUnsavedWork({
        isDirty: () => latest.current.isDirty(),
        saveDraft: () => latest.current.saveDraft(),
        discard: () => latest.current.discard?.(),
      }),
    [registerUnsavedWork],
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

type BranchChangeDialogViewProps = {
  locale: StaffLocale;
  open: boolean;
  /** Name of the branch the unsaved work belongs to (the current one). */
  currentBranchName: string;
  saving: boolean;
  saveFailed: boolean;
  onSaveDraft: () => void;
  onDiscard: () => void;
  onStay: () => void;
};

/** Presentational dialog: Save draft, Discard, Stay. Focus starts on Stay and is kept inside. */
export function BranchChangeDialogView({
  locale,
  open,
  currentBranchName,
  saving,
  saveFailed,
  onSaveDraft,
  onDiscard,
  onStay,
}: BranchChangeDialogViewProps) {
  const footerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previous = document.activeElement as HTMLElement | null;
    const modal = footerRef.current?.closest<HTMLElement>(".qos-modal");
    modal?.querySelector<HTMLElement>('[data-guard-action="stay"]')?.focus();

    function trapFocus(event: KeyboardEvent) {
      if (event.key !== "Tab" || !modal) {
        return;
      }
      const focusable = [...modal.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!modal.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", trapFocus);
    return () => {
      document.removeEventListener("keydown", trapFocus);
      previous?.focus?.();
    };
  }, [open]);

  return (
    <Modal
      open={open}
      size="sm"
      title={staffUiCopy(locale, "unsavedWorkTitle")}
      description={staffCopyWith(locale, "unsavedWorkBody", {
        branch: isolateText(currentBranchName),
      })}
      onClose={saving ? undefined : onStay}
      footer={
        <div ref={footerRef} className="qosp-guard-actions">
          <button
            type="button"
            className="qos-btn"
            data-variant="secondary"
            data-guard-action="stay"
            disabled={saving}
            onClick={onStay}
          >
            {staffUiCopy(locale, "stay")}
          </button>
          <button
            type="button"
            className="qos-btn"
            data-variant="danger"
            data-guard-action="discard"
            disabled={saving}
            onClick={onDiscard}
          >
            {staffUiCopy(locale, "discard")}
          </button>
          <button
            type="button"
            className="qos-btn"
            data-variant="primary"
            data-guard-action="save"
            data-loading={saving || undefined}
            disabled={saving}
            onClick={onSaveDraft}
          >
            {staffUiCopy(locale, saving ? "savingDraft" : "saveDraft")}
          </button>
        </div>
      }
    >
      {saveFailed ? (
        <p className="qosp-notice" data-tone="error" role="alert">
          {staffUiCopy(locale, "unsavedWorkSaveFailed")}
        </p>
      ) : null}
    </Modal>
  );
}

/** Shell-mounted dialog bound to the shell's guard. */
export function BranchChangeDialog({
  guard,
  currentBranchName,
}: {
  guard: BranchChangeGuard;
  currentBranchName: string;
}) {
  const { locale } = useStaffLocale();
  const snapshot = useSyncExternalStore(guard.subscribe, guard.getSnapshot, guard.getSnapshot);

  return (
    <BranchChangeDialogView
      locale={locale}
      open={snapshot.pending !== null}
      currentBranchName={currentBranchName}
      saving={snapshot.saving}
      saveFailed={snapshot.saveFailed}
      onSaveDraft={() => {
        void guard.saveDraft();
      }}
      onDiscard={() => guard.discard()}
      onStay={() => guard.stay()}
    />
  );
}
