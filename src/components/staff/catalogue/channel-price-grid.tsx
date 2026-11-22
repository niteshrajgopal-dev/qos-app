"use client";

import { useState } from "react";

import {
  channelPriceDraftText,
  formatChannelMinor,
  parseChannelPriceDraft,
  type ChannelPriceRowView,
} from "@/components/staff/catalogue/channel-price-state";
import { PortalBadge, PortalField, PortalNotice } from "@/components/portal/workspace/PortalWorkspace";
import { staffUiCopy, type StaffLocale } from "@/lib/staff/locale";

/* Channel-price grid for the variant and modifier-option editors (QOS-213).
   One compact block per active channel: base, explicit channel price (or
   none), effective price, currency and the supported scope. Saving needs a
   typed amount (0 is allowed); "Use base price" removes the channel price. */

type ChannelPriceGridProps = {
  locale: StaffLocale;
  rows: ChannelPriceRowView[];
  canEdit: boolean;
  disabled: boolean;
  onSave: (row: ChannelPriceRowView, amountMinor: number) => Promise<boolean>;
  onReset: (row: ChannelPriceRowView) => Promise<boolean>;
};

function Money({ amountMinor }: { amountMinor: number }) {
  return <bdi dir="ltr">{formatChannelMinor(amountMinor)}</bdi>;
}

export function ChannelPriceGrid({ locale, rows, canEdit, disabled, onSave, onReset }: ChannelPriceGridProps) {
  const copy = (key: Parameters<typeof staffUiCopy>[1]) => staffUiCopy(locale, key);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function save(row: ChannelPriceRowView) {
    const draft = parseChannelPriceDraft(edits[row.channelPublicId] ?? channelPriceDraftText(row));
    if (draft.kind !== "amount") {
      setErrors({
        ...errors,
        [row.channelPublicId]: copy(draft.kind === "blank" ? "channelPriceBlankError" : "channelPriceInvalidError"),
      });
      return;
    }
    setErrors({ ...errors, [row.channelPublicId]: "" });
    if (await onSave(row, draft.amountMinor)) {
      const { [row.channelPublicId]: _saved, ...rest } = edits;
      void _saved;
      setEdits(rest);
    }
  }

  async function reset(row: ChannelPriceRowView) {
    if (await onReset(row)) {
      const { [row.channelPublicId]: _reset, ...rest } = edits;
      void _reset;
      setEdits(rest);
    }
  }

  return (
    <ul className="qosp-channel-price-list">
      {rows.map((row) => {
        const inputId = `channel-price-${row.channelPublicId}`;
        const error = errors[row.channelPublicId];
        return (
          <li key={row.channelPublicId} className="qosp-channel-price-row">
            <div className="qosp-meta-row">
              <span className="qosp-subcard-title">{row.channelDisplayName}</span>
              <PortalBadge tone={row.inheritanceMode === "override" ? "warm" : "neutral"}>
                {copy(row.inheritanceMode === "override" ? "channelPriceOverridden" : "channelPriceInherited")}
              </PortalBadge>
            </div>
            <dl className="qosp-channel-price-facts">
              <div>
                <dt>{copy("channelPriceBase")}</dt>
                <dd>
                  <Money amountMinor={row.baseAmountMinor} />
                </dd>
              </div>
              <div>
                <dt>{copy("channelPriceOverride")}</dt>
                <dd>{row.overrideAmountMinor == null ? copy("channelPriceNone") : <Money amountMinor={row.overrideAmountMinor} />}</dd>
              </div>
              <div>
                <dt>{copy("channelPriceEffective")}</dt>
                <dd>
                  <Money amountMinor={row.effectiveAmountMinor} />
                </dd>
              </div>
              <div>
                <dt>{copy("channelPriceCurrency")}</dt>
                <dd>
                  <bdi dir="ltr">{row.currency}</bdi>
                </dd>
              </div>
              <div>
                <dt>{copy("channelPriceScope")}</dt>
                <dd>{copy("channelPriceScopeChannelList")}</dd>
              </div>
            </dl>
            {canEdit ? (
              <div className="qosp-attach-row">
                <PortalField label={copy("channelPriceInputLabel")}>
                  <input
                    id={inputId}
                    className="qos-input"
                    inputMode="decimal"
                    dir="ltr"
                    value={edits[row.channelPublicId] ?? channelPriceDraftText(row)}
                    disabled={disabled}
                    aria-invalid={error ? true : undefined}
                    onChange={(event) => setEdits({ ...edits, [row.channelPublicId]: event.target.value })}
                  />
                </PortalField>
                <div className="qosp-button-row">
                  <button
                    type="button"
                    className="qos-btn"
                    data-variant="primary"
                    data-size="sm"
                    disabled={disabled}
                    onClick={() => void save(row)}
                  >
                    {copy("channelPriceSave")}
                  </button>
                  {row.canReset ? (
                    <button
                      type="button"
                      className="qos-btn"
                      data-variant="secondary"
                      data-size="sm"
                      disabled={disabled}
                      onClick={() => void reset(row)}
                    >
                      {copy("channelPriceReset")}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            {error ? <PortalNotice tone="error">{error}</PortalNotice> : null}
          </li>
        );
      })}
    </ul>
  );
}

export type SalesChannelDraft = {
  displayName: string;
  workbookSlot: "" | "aggregator_1" | "aggregator_2" | "aggregator_3";
  code: string;
};

const SLOT_OPTIONS = [
  ["aggregator_1", "salesChannelSlot1"],
  ["aggregator_2", "salesChannelSlot2"],
  ["aggregator_3", "salesChannelSlot3"],
] as const;

/** Adds a tenant sales channel. The name is the person's own; QOS suggests none. */
export function SalesChannelAddForm({
  locale,
  disabled,
  takenSlots,
  onAdd,
}: {
  locale: StaffLocale;
  disabled: boolean;
  takenSlots: string[];
  onAdd: (draft: SalesChannelDraft) => Promise<boolean>;
}) {
  const copy = (key: Parameters<typeof staffUiCopy>[1]) => staffUiCopy(locale, key);
  const [draft, setDraft] = useState<SalesChannelDraft>({ displayName: "", workbookSlot: "", code: "" });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (await onAdd(draft)) {
      setDraft({ displayName: "", workbookSlot: "", code: "" });
    }
  }

  return (
    <form className="qosp-subcard qosp-stack" data-dashed="true" onSubmit={(event) => void submit(event)}>
      <h4 className="qosp-subcard-title">{copy("salesChannelAddTitle")}</h4>
      <div className="qosp-form-grid" data-columns="2">
        <PortalField label={copy("salesChannelNameLabel")}>
          <input
            className="qos-input"
            value={draft.displayName}
            disabled={disabled}
            onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
          />
        </PortalField>
        <PortalField label={copy("salesChannelSlotLabel")}>
          <select
            className="qos-input"
            value={draft.workbookSlot}
            disabled={disabled}
            onChange={(event) =>
              setDraft({ ...draft, workbookSlot: event.target.value as SalesChannelDraft["workbookSlot"] })
            }
          >
            <option value="">{copy("salesChannelSlotNone")}</option>
            {SLOT_OPTIONS.filter(([slot]) => !takenSlots.includes(slot)).map(([slot, key]) => (
              <option key={slot} value={slot}>
                {copy(key)}
              </option>
            ))}
          </select>
        </PortalField>
        <PortalField label={copy("salesChannelCodeLabel")} help={copy("salesChannelCodeHelp")}>
          <input
            className="qos-input"
            dir="ltr"
            value={draft.code}
            disabled={disabled}
            onChange={(event) => setDraft({ ...draft, code: event.target.value })}
          />
        </PortalField>
      </div>
      <div className="qosp-button-row">
        <button type="submit" className="qos-btn" data-variant="secondary" data-size="sm" disabled={disabled}>
          {copy("salesChannelAdd")}
        </button>
      </div>
    </form>
  );
}

/** Request body for POST /catalogue/sales-channels. Blank fields are omitted, never invented. */
export function salesChannelCreateBody(draft: SalesChannelDraft) {
  return {
    ...(draft.displayName.trim() ? { displayName: draft.displayName.trim() } : {}),
    ...(draft.workbookSlot ? { workbookSlot: draft.workbookSlot } : {}),
    ...(draft.code.trim() ? { code: draft.code.trim() } : {}),
  };
}

type ChannelPricesBlockProps = {
  locale: StaffLocale;
  channelCount: number;
  rows: ChannelPriceRowView[] | null;
  canEdit: boolean;
  disabled: boolean;
  onSave: ChannelPriceGridProps["onSave"];
  onReset: ChannelPriceGridProps["onReset"];
};

/** The channel-price section of one variant or option. */
export function ChannelPricesBlock({ locale, channelCount, rows, canEdit, disabled, onSave, onReset }: ChannelPricesBlockProps) {
  const copy = (key: Parameters<typeof staffUiCopy>[1]) => staffUiCopy(locale, key);
  return (
    <section className="qosp-channel-prices" aria-label={copy("channelPricesTitle")}>
      <h4 className="qosp-subcard-title">{copy("channelPricesTitle")}</h4>
      {channelCount === 0 ? (
        <p className="qosp-meta-line">{copy("channelPricesEmpty")}</p>
      ) : rows === null ? (
        <p className="qosp-meta-line">{copy("channelPricesNoBase")}</p>
      ) : (
        <>
          <p className="qosp-meta-line">{copy(canEdit ? "channelPricesIntro" : "channelPriceViewOnly")}</p>
          <ChannelPriceGrid
            locale={locale}
            rows={rows}
            canEdit={canEdit}
            disabled={disabled}
            onSave={onSave}
            onReset={onReset}
          />
        </>
      )}
    </section>
  );
}
