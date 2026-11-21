import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ChannelPriceGrid,
  ChannelPricesBlock,
  SalesChannelAddForm,
  salesChannelCreateBody,
} from "@/components/staff/catalogue/channel-price-grid";
import {
  channelPriceDraftText,
  parseChannelPriceDraft,
  type ChannelPriceRowView,
} from "@/components/staff/catalogue/channel-price-state";
import { STAFF_UI_COPY, type StaffLocale } from "@/lib/staff/locale";

function row(overrides: Partial<ChannelPriceRowView>): ChannelPriceRowView {
  return {
    channelPublicId: "schan_aggregator-1_aaaa1111",
    channelCode: "aggregator_1",
    channelDisplayName: "Aggregator 1",
    workbookSlot: "aggregator_1",
    baseAmountMinor: 2000,
    overrideAmountMinor: null,
    effectiveAmountMinor: 2000,
    currency: "AED",
    inheritanceMode: "inherited",
    supportedScope: "channel_list",
    version: null,
    canReset: false,
    ...overrides,
  };
}

const ROWS = [
  row({}),
  row({
    channelPublicId: "schan_aggregator-2_bbbb2222",
    channelCode: "aggregator_2",
    channelDisplayName: "Aggregator 2",
    workbookSlot: "aggregator_2",
    overrideAmountMinor: 0,
    effectiveAmountMinor: 0,
    inheritanceMode: "override",
    version: 3,
    canReset: true,
  }),
];

const noop = async () => true;

function grid(locale: StaffLocale, canEdit = true) {
  return renderToStaticMarkup(
    createElement(ChannelPriceGrid, { locale, rows: ROWS, canEdit, disabled: false, onSave: noop, onReset: noop }),
  );
}

function items(html: string) {
  return html.split("<li ").slice(1);
}

describe("channel price draft parsing", () => {
  it("keeps blank and zero apart and parses decimals exactly", () => {
    expect(parseChannelPriceDraft("")).toEqual({ kind: "blank" });
    expect(parseChannelPriceDraft("   ")).toEqual({ kind: "blank" });
    expect(parseChannelPriceDraft("0")).toEqual({ kind: "amount", amountMinor: 0 });
    expect(parseChannelPriceDraft("0.00")).toEqual({ kind: "amount", amountMinor: 0 });
    expect(parseChannelPriceDraft("0.29")).toEqual({ kind: "amount", amountMinor: 29 });
    expect(parseChannelPriceDraft("21.5")).toEqual({ kind: "amount", amountMinor: 2150 });
    for (const bad of ["-1", "1.234", "abc", "1,5", "1e3"]) {
      expect(parseChannelPriceDraft(bad), bad).toEqual({ kind: "invalid" });
    }
  });

  it("shows a stored zero as 0.00 and an inherited price as an empty input", () => {
    expect(channelPriceDraftText({ overrideAmountMinor: 0 })).toBe("0.00");
    expect(channelPriceDraftText({ overrideAmountMinor: null })).toBe("");
  });
});

describe("ChannelPriceGrid", () => {
  it("renders base, explicit price, effective price, currency and scope per channel (EN)", () => {
    const html = grid("en");
    const [inherited, zero] = items(html);

    expect(inherited).toContain("Aggregator 1");
    expect(inherited).toContain("Uses base price");
    expect(inherited).toContain("<dt>Channel price</dt><dd>None</dd>");
    expect(inherited).toContain('<dt>Effective</dt><dd><bdi dir="ltr">20.00</bdi></dd>');
    expect(inherited).toContain('value=""');
    expect(inherited).not.toContain("Use base price</button>");

    expect(zero).toContain("Own price");
    expect(zero).toContain('<dt>Base</dt><dd><bdi dir="ltr">20.00</bdi></dd>');
    expect(zero).toContain('<dt>Channel price</dt><dd><bdi dir="ltr">0.00</bdi></dd>');
    expect(zero).toContain('<dt>Effective</dt><dd><bdi dir="ltr">0.00</bdi></dd>');
    expect(zero).toContain('value="0.00"');
    expect(zero).toContain("Use base price</button>");
    expect(zero).toContain("Save price</button>");

    for (const item of [inherited, zero]) {
      expect(item).toContain('<dt>Currency</dt><dd><bdi dir="ltr">AED</bdi></dd>');
      expect(item).toContain("<dt>Scope</dt><dd>Channel list</dd>");
    }
  });

  it("renders the same grid in Arabic with numbers kept left to right", () => {
    const html = grid("ar");
    const ar = STAFF_UI_COPY.ar;
    for (const text of [
      ar.channelPriceBase,
      ar.channelPriceOverride,
      ar.channelPriceEffective,
      ar.channelPriceCurrency,
      ar.channelPriceScope,
      ar.channelPriceScopeChannelList,
      ar.channelPriceInherited,
      ar.channelPriceOverridden,
      ar.channelPriceNone,
      ar.channelPriceSave,
      ar.channelPriceReset,
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('<bdi dir="ltr">0.00</bdi>');
    expect(html).not.toContain("Channel price");
    expect(html).not.toContain("Use base price");
  });

  it("hides edit and reset controls from members who cannot change prices", () => {
    const html = grid("en", false);
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<button");
    expect(html).toContain('<bdi dir="ltr">0.00</bdi>');
  });
});

describe("ChannelPricesBlock", () => {
  function block(locale: StaffLocale, props: Partial<Parameters<typeof ChannelPricesBlock>[0]>) {
    return renderToStaticMarkup(
      createElement(ChannelPricesBlock, {
        locale,
        channelCount: 2,
        rows: ROWS,
        canEdit: true,
        disabled: false,
        onSave: noop,
        onReset: noop,
        ...props,
      }),
    );
  }

  it("shows a short empty state when no channel is configured", () => {
    for (const locale of ["en", "ar"] as const) {
      const html = block(locale, { channelCount: 0, rows: [] });
      expect(html).toContain(STAFF_UI_COPY[locale].channelPricesTitle);
      expect(html).toContain(STAFF_UI_COPY[locale].channelPricesEmpty);
      expect(html).not.toContain("<li");
    }
  });

  it("asks for a base price before channel prices", () => {
    expect(block("en", { rows: null })).toContain(STAFF_UI_COPY.en.channelPricesNoBase);
  });

  it("tells members without the price role that the grid is view only", () => {
    expect(block("ar", { canEdit: false })).toContain(STAFF_UI_COPY.ar.channelPriceViewOnly);
  });
});

describe("SalesChannelAddForm", () => {
  it("offers only free workbook slots and suggests no channel name", () => {
    const html = renderToStaticMarkup(
      createElement(SalesChannelAddForm, { locale: "en", disabled: false, takenSlots: ["aggregator_1"], onAdd: noop }),
    );
    expect(html).toContain("Add a sales channel");
    expect(html).not.toContain('value="aggregator_1"');
    expect(html).toContain('value="aggregator_2"');
    expect(html).toContain('value="aggregator_3"');
    expect(html).toMatch(/<input class="qos-input" value=""/);

    const ar = renderToStaticMarkup(
      createElement(SalesChannelAddForm, { locale: "ar", disabled: false, takenSlots: [], onAdd: noop }),
    );
    expect(ar).toContain(STAFF_UI_COPY.ar.salesChannelAddTitle);
    expect(ar).toContain(STAFF_UI_COPY.ar.salesChannelSlot3);
  });

  it("sends only what the person typed", () => {
    expect(salesChannelCreateBody({ displayName: "  ", workbookSlot: "aggregator_2", code: "" })).toEqual({
      workbookSlot: "aggregator_2",
    });
    expect(salesChannelCreateBody({ displayName: "Late night", workbookSlot: "", code: "late_night" })).toEqual({
      displayName: "Late night",
      code: "late_night",
    });
  });
});
