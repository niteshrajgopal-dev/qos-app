import type { BranchSelection } from "@/lib/staff/branch-selection";

/* Branch-change guard state (QOS-192). A screen with unsaved work registers
   how to tell whether it is dirty and how to save a draft through its own real
   service. Changing branch then asks first: Save draft, Discard or Stay. The
   branch only changes after a successful save or an explicit discard; a failed
   save keeps the work, the dialog and the current branch. */

export type UnsavedWorkRegistration = {
  isDirty: () => boolean;
  /** Persists the work through the screen's real draft service. Rejects on failure. */
  saveDraft: () => Promise<void>;
  /** Resets the screen's local edits. Optional: unmounting also drops them. */
  discard?: () => void;
};

export type BranchChangeGuardSnapshot = {
  /** Branch the user asked to switch to while work was unsaved. */
  pending: BranchSelection | null;
  saving: boolean;
  saveFailed: boolean;
};

const IDLE: BranchChangeGuardSnapshot = { pending: null, saving: false, saveFailed: false };

export class BranchChangeGuard {
  private registrations = new Set<UnsavedWorkRegistration>();
  private listeners = new Set<() => void>();
  private snapshot: BranchChangeGuardSnapshot = IDLE;

  constructor(private apply: (selection: BranchSelection) => void) {}

  /** The shell's apply function changes as its state does; keep the latest. */
  setApply(apply: (selection: BranchSelection) => void) {
    this.apply = apply;
  }

  register(registration: UnsavedWorkRegistration): () => void {
    this.registrations.add(registration);
    return () => {
      this.registrations.delete(registration);
    };
  }

  hasUnsavedWork(): boolean {
    return this.dirtyRegistrations().length > 0;
  }

  /** Switches immediately when nothing is dirty; otherwise opens the dialog. */
  request(selection: BranchSelection): "applied" | "pending" {
    if (this.snapshot.saving) {
      return "pending";
    }

    if (!this.hasUnsavedWork()) {
      this.apply(selection);
      this.set(IDLE);
      return "applied";
    }

    this.set({ pending: selection, saving: false, saveFailed: false });
    return "pending";
  }

  /** Keep the current branch and the work. */
  stay() {
    if (this.snapshot.saving) {
      return;
    }
    this.set(IDLE);
  }

  /** Drop the unsaved work, then switch. */
  discard() {
    const { pending, saving } = this.snapshot;
    if (pending === null || saving) {
      return;
    }

    for (const registration of this.dirtyRegistrations()) {
      registration.discard?.();
    }
    this.set(IDLE);
    this.apply(pending);
  }

  /** Save every dirty screen; switch only if all saves succeed. */
  async saveDraft(): Promise<boolean> {
    const { pending, saving } = this.snapshot;
    if (pending === null || saving) {
      return false;
    }

    this.set({ pending, saving: true, saveFailed: false });
    try {
      for (const registration of this.dirtyRegistrations()) {
        await registration.saveDraft();
      }
    } catch {
      this.set({ pending, saving: false, saveFailed: true });
      return false;
    }

    this.set(IDLE);
    this.apply(pending);
    return true;
  }

  getSnapshot = (): BranchChangeGuardSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private dirtyRegistrations() {
    return [...this.registrations].filter((registration) => registration.isDirty());
  }

  private set(next: BranchChangeGuardSnapshot) {
    this.snapshot = next;
    for (const listener of this.listeners) {
      listener();
    }
  }
}
