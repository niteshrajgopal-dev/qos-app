import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { BranchChangeDialogView } from "@/components/staff/branch-change-guard";
import { BranchChangeGuard } from "@/lib/staff/branch-change-guard-state";
import { STAFF_UI_COPY } from "@/lib/staff/locale";

function setup() {
  const applied: string[] = [];
  const guard = new BranchChangeGuard((selection) => applied.push(selection));
  let dirty = true;
  const work = {
    saveDraft: vi.fn(async () => {
      dirty = false;
    }),
    discard: vi.fn(() => {
      dirty = false;
    }),
    isDirty: () => dirty,
  };
  const unregister = guard.register(work);
  return { guard, applied, work, unregister, setDirty: (value: boolean) => (dirty = value) };
}

describe("BranchChangeGuard", () => {
  it("switches immediately when no screen has unsaved work", () => {
    const { guard, applied, setDirty } = setup();
    setDirty(false);

    expect(guard.request("loc_b")).toBe("applied");
    expect(applied).toEqual(["loc_b"]);
    expect(guard.getSnapshot().pending).toBeNull();
  });

  it("asks first when there is unsaved work and changes nothing yet", () => {
    const { guard, applied, work } = setup();

    expect(guard.request("loc_b")).toBe("pending");
    expect(guard.getSnapshot()).toEqual({ pending: "loc_b", saving: false, saveFailed: false });
    expect(applied).toEqual([]);
    expect(work.saveDraft).not.toHaveBeenCalled();
    expect(work.discard).not.toHaveBeenCalled();
  });

  it("Stay keeps the branch and the work", () => {
    const { guard, applied, work } = setup();
    guard.request("loc_b");

    guard.stay();

    expect(applied).toEqual([]);
    expect(guard.getSnapshot().pending).toBeNull();
    expect(work.discard).not.toHaveBeenCalled();
    expect(work.saveDraft).not.toHaveBeenCalled();
    expect(guard.hasUnsavedWork()).toBe(true);
  });

  it("Discard drops the work and then switches", () => {
    const { guard, applied, work } = setup();
    guard.request("loc_b");

    guard.discard();

    expect(work.discard).toHaveBeenCalledOnce();
    expect(work.saveDraft).not.toHaveBeenCalled();
    expect(applied).toEqual(["loc_b"]);
    expect(guard.getSnapshot().pending).toBeNull();
  });

  it("Save draft saves through the screen and switches only after it succeeds", async () => {
    const { guard, applied, work } = setup();
    guard.request("all");

    const saving = guard.saveDraft();
    expect(guard.getSnapshot()).toEqual({ pending: "all", saving: true, saveFailed: false });
    expect(applied).toEqual([]);

    await expect(saving).resolves.toBe(true);
    expect(work.saveDraft).toHaveBeenCalledOnce();
    expect(applied).toEqual(["all"]);
    expect(guard.getSnapshot().pending).toBeNull();
  });

  it("a failed save keeps the dialog open, the work and the current branch", async () => {
    const { guard, applied, work } = setup();
    work.saveDraft.mockRejectedValueOnce(new Error("409 version conflict"));
    guard.request("loc_b");

    await expect(guard.saveDraft()).resolves.toBe(false);

    expect(applied).toEqual([]);
    expect(guard.getSnapshot()).toEqual({ pending: "loc_b", saving: false, saveFailed: true });
    expect(work.discard).not.toHaveBeenCalled();
    expect(guard.hasUnsavedWork()).toBe(true);

    // The user can still choose: retry succeeds and only then switches.
    await expect(guard.saveDraft()).resolves.toBe(true);
    expect(applied).toEqual(["loc_b"]);
  });

  it("ignores Stay, Discard and new requests while a save is in flight", async () => {
    const { guard, applied, work } = setup();
    let finish: () => void = () => undefined;
    work.saveDraft.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    guard.request("loc_b");
    const saving = guard.saveDraft();

    guard.stay();
    guard.discard();
    expect(guard.request("loc_c")).toBe("pending");
    expect(work.discard).not.toHaveBeenCalled();
    expect(guard.getSnapshot()).toEqual({ pending: "loc_b", saving: true, saveFailed: false });

    finish();
    await saving;
    expect(applied).toEqual(["loc_b"]);
  });

  it("stops asking once the screen unregisters", () => {
    const { guard, applied, unregister } = setup();
    unregister();

    expect(guard.request("loc_b")).toBe("applied");
    expect(applied).toEqual(["loc_b"]);
  });

  it("notifies subscribers on every state change", () => {
    const { guard } = setup();
    const listener = vi.fn();
    const unsubscribe = guard.subscribe(listener);

    guard.request("loc_b");
    guard.stay();
    unsubscribe();
    guard.request("loc_c");

    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("BranchChangeDialogView", () => {
  const base = {
    open: true,
    currentBranchName: "HBZ Stadium",
    saving: false,
    saveFailed: false,
    onSaveDraft: () => undefined,
    onDiscard: () => undefined,
    onStay: () => undefined,
  };

  it("offers Save draft, Discard and Stay in English", () => {
    const html = renderToStaticMarkup(createElement(BranchChangeDialogView, { ...base, locale: "en" }));

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain(STAFF_UI_COPY.en.unsavedWorkTitle);
    expect(html).toContain(">Save draft<");
    expect(html).toContain(">Discard<");
    expect(html).toContain(">Stay<");
    expect(html).toContain("HBZ Stadium");
    expect(html).not.toContain('role="alert"');
  });

  it("renders Arabic copy with the branch name isolated", () => {
    const html = renderToStaticMarkup(createElement(BranchChangeDialogView, { ...base, locale: "ar" }));

    expect(html).toContain(STAFF_UI_COPY.ar.saveDraft);
    expect(html).toContain(STAFF_UI_COPY.ar.discard);
    expect(html).toContain(STAFF_UI_COPY.ar.stay);
    expect(html).toContain("⁨HBZ Stadium⁩");
    expect(html).not.toContain(">Save draft<");
  });

  it("shows the failure and disables every action while saving", () => {
    const failed = renderToStaticMarkup(
      createElement(BranchChangeDialogView, { ...base, locale: "en", saveFailed: true }),
    );
    expect(failed).toContain('role="alert"');
    expect(failed).toContain(STAFF_UI_COPY.en.unsavedWorkSaveFailed);

    const saving = renderToStaticMarkup(
      createElement(BranchChangeDialogView, { ...base, locale: "en", saving: true }),
    );
    expect(saving.match(/disabled=""/g)).toHaveLength(3);
    expect(saving).toContain(STAFF_UI_COPY.en.savingDraft);
  });

  it("renders nothing when closed", () => {
    expect(
      renderToStaticMarkup(createElement(BranchChangeDialogView, { ...base, locale: "en", open: false })),
    ).toBe("");
  });
});
