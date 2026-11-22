/* Pure helpers for the channel-price grid (QOS-213). A blank draft is never
   read as zero: it is "blank", and the grid asks for a price instead of
   saving. Typed 0 is a real price. Amounts are parsed from text so 0.29 is
   29 minor units, never a floating-point rounding. */

export type ChannelPriceRowView = {
  channelPublicId: string;
  channelCode: string;
  channelDisplayName: string;
  workbookSlot: "aggregator_1" | "aggregator_2" | "aggregator_3" | null;
  baseAmountMinor: number;
  overrideAmountMinor: number | null;
  effectiveAmountMinor: number;
  currency: string;
  inheritanceMode: "inherited" | "override";
  supportedScope: "channel_list";
  version: number | null;
  canReset: boolean;
};

export type ChannelPriceDraft =
  | { kind: "amount"; amountMinor: number }
  | { kind: "blank" }
  | { kind: "invalid" };

const MAX_AMOUNT_MINOR = 2_147_483_647;

export function parseChannelPriceDraft(text: string): ChannelPriceDraft {
  const trimmed = text.trim();
  if (!trimmed) {
    return { kind: "blank" };
  }
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) {
    return { kind: "invalid" };
  }
  const amountMinor = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(amountMinor) || amountMinor > MAX_AMOUNT_MINOR) {
    return { kind: "invalid" };
  }
  return { kind: "amount", amountMinor };
}

export function formatChannelMinor(amountMinor: number) {
  return (amountMinor / 100).toFixed(2);
}

/** What the input shows for a row: the explicit price, or blank when the channel inherits. */
export function channelPriceDraftText(row: Pick<ChannelPriceRowView, "overrideAmountMinor">) {
  return row.overrideAmountMinor == null ? "" : formatChannelMinor(row.overrideAmountMinor);
}
