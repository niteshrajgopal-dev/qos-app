import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  catalogueModifierOptionChannelPriceResetAudits,
  catalogueVariantChannelPriceResetAudits,
  catalogueVariantChannelPrices,
  catalogueVariantLocationPriceOverrides,
  locations,
  salesChannels,
  staffIdentities,
  staffMemberships,
  tenantAuditEvents,
} from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { resolveBranchAndChannelPrice } from "@/lib/catalogue/channel-price-resolver";
import { setProductLocationPriceOverride } from "@/lib/catalogue/location-price-overrides";
import { createModifierGroup, createModifierOption } from "@/lib/catalogue/modifiers";
import { createDraftProduct } from "@/lib/catalogue/products";
import { flowerTenantFixture } from "@/lib/tenant/fixtures";
import { createQuotesTwoLocationTenant } from "@/lib/tenant/fixtures-two-locations";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import { loadCurrentRecordExport } from "@/lib/workbook/export";

import { GET as getGroupChannelPrices } from "./modifier-groups/[groupPublicId]/channel-prices/route";
import { PUT as putOptionChannelPrice } from "./modifier-groups/[groupPublicId]/options/[optionPublicId]/channel-prices/[channelPublicId]/route";
import { POST as resetOptionChannelPrice } from "./modifier-groups/[groupPublicId]/options/[optionPublicId]/channel-prices/[channelPublicId]/reset/route";
import { GET as getProductChannelPrices } from "./products/[productPublicId]/channel-prices/route";
import { GET as getLocationPrices } from "./products/[productPublicId]/location-prices/route";
import { PUT as putVariantChannelPrice } from "./products/[productPublicId]/variants/[variantPublicId]/channel-prices/[channelPublicId]/route";
import { POST as resetVariantChannelPrice } from "./products/[productPublicId]/variants/[variantPublicId]/channel-prices/[channelPublicId]/reset/route";
import { PATCH as patchSalesChannel } from "./sales-channels/[channelPublicId]/route";
import { GET as listSalesChannels, POST as postSalesChannel } from "./sales-channels/route";

const staffMocks = vi.hoisted(() => ({
  requireStaffIdentity: vi.fn(),
}));

vi.mock("@/lib/staff/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/staff/auth")>();
  return {
    ...actual,
    requireStaffIdentity: staffMocks.requireStaffIdentity,
  };
});

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const ADMIN = "admin.channel-prices@test";
const USER = "user.channel-prices@test";
const FLOWER_ADMIN = "admin.flower-channel-prices@test";

type ChannelRow = {
  channelPublicId: string;
  channelDisplayName: string;
  workbookSlot: string | null;
  baseAmountMinor: number;
  overrideAmountMinor: number | null;
  effectiveAmountMinor: number;
  currency: string;
  inheritanceMode: "inherited" | "override";
  supportedScope: string;
  version: number | null;
  canReset: boolean;
};

type ProductBundle = {
  canEditPrice: boolean;
  channels: Array<{ publicId: string; displayName: string; workbookSlot: string | null }>;
  variants: Array<{ variantPublicId: string; centralAmountMinor: number; rows: ChannelRow[] }>;
};

type GroupBundle = {
  channels: Array<{ publicId: string }>;
  options: Array<{ optionPublicId: string; baseAmountMinor: number; rows: ChannelRow[] }>;
};

function as(subject: string) {
  staffMocks.requireStaffIdentity.mockResolvedValue({ subject, email: subject });
}

function request(method: string, body?: unknown) {
  return new Request("http://localhost/test", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function params<T extends Record<string, string>>(value: T) {
  return { params: Promise.resolve(value) };
}

function byChannel(rows: ChannelRow[]) {
  return Object.fromEntries(rows.map((row) => [row.workbookSlot ?? row.channelPublicId, row]));
}

integrationDescribe("sales channel prices (DB routes)", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
    await grantRoleMembership(sqlClient, "qos", "qos_app");
  }, 120_000);

  afterAll(async () => {
    await sqlClient.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.tenant_audit_events, qos.catalogue_option_channel_price_reset_audits, qos.catalogue_variant_channel_price_reset_audits, qos.catalogue_modifier_option_channel_prices, qos.catalogue_variant_channel_prices, qos.sales_channels, qos.catalogue_variant_location_price_reset_audits, qos.catalogue_variant_location_price_overrides, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_groups, qos.catalogue_variant_translations, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
    staffMocks.requireStaffIdentity.mockReset();
  });

  async function member(tenantId: string, subject: string, role: "administrator" | "user") {
    const [identity] = await db.insert(staffIdentities).values({ providerSubject: subject, email: subject }).returning();
    const [membership] = await db.insert(staffMemberships).values({ tenantId, staffIdentityId: identity.id, role }).returning();
    return { membershipId: membership.id, role, staffIdentityId: identity.id };
  }

  async function seed() {
    const quotes = await createQuotesTwoLocationTenant(db);
    const tenantId = quotes.tenant.id;
    const admin = await member(tenantId, ADMIN, "administrator");
    const user = await member(tenantId, USER, "user");

    const product = await createDraftProduct(db, tenantId, admin, {
      internalName: "flat-white",
      translations: {
        en: { displayName: "Flat White", description: null },
        ar: { displayName: "فلات وايت", description: null },
      },
      defaultVariant: { amountMinor: 2000, currency: "AED" },
    });

    const group = await createModifierGroup(
      db,
      tenantId,
      {
        internalName: "milk",
        translations: { en: { displayName: "Milk" }, ar: { displayName: "الحليب" } },
        minSelections: 0,
        maxSelections: 1,
      },
      ADMIN,
      admin,
    );
    const withOption = await createModifierOption(
      db,
      tenantId,
      group.publicId,
      {
        expectedGroupVersion: group.version,
        priceMinor: 300,
        currency: "AED",
        translations: { en: { displayName: "Oat milk" }, ar: { displayName: "حليب الشوفان" } },
      },
      ADMIN,
      admin,
    );

    // An existing branch override that channel prices must never touch.
    await setProductLocationPriceOverride(db, tenantId, admin, ADMIN, product.publicId, quotes.locationB.publicId, {
      amountMinor: 2400,
    });

    as(ADMIN);
    const channels: Array<{ publicId: string; displayName: string; workbookSlot: string; version: number }> = [];
    for (const slot of ["aggregator_1", "aggregator_2", "aggregator_3"]) {
      const response = await postSalesChannel(request("POST", { workbookSlot: slot }), params({ tenantId }));
      expect(response.status).toBe(201);
      channels.push(((await response.json()) as { channel: (typeof channels)[number] }).channel);
    }

    return {
      quotes,
      tenantId,
      admin,
      user,
      productPublicId: product.publicId,
      variantPublicId: product.defaultVariant.publicId,
      groupPublicId: group.publicId,
      optionPublicId: withOption.options[0]!.publicId,
      channels,
    };
  }

  async function setVariant(ctx: Awaited<ReturnType<typeof seed>>, channelIndex: number, body: unknown) {
    return putVariantChannelPrice(
      request("PUT", body),
      params({
        tenantId: ctx.tenantId,
        productPublicId: ctx.productPublicId,
        variantPublicId: ctx.variantPublicId,
        channelPublicId: ctx.channels[channelIndex]!.publicId,
      }),
    );
  }

  async function setOption(ctx: Awaited<ReturnType<typeof seed>>, channelIndex: number, body: unknown) {
    return putOptionChannelPrice(
      request("PUT", body),
      params({
        tenantId: ctx.tenantId,
        groupPublicId: ctx.groupPublicId,
        optionPublicId: ctx.optionPublicId,
        channelPublicId: ctx.channels[channelIndex]!.publicId,
      }),
    );
  }

  async function reloadProduct(ctx: Awaited<ReturnType<typeof seed>>) {
    const response = await getProductChannelPrices(request("GET"), params({ tenantId: ctx.tenantId, productPublicId: ctx.productPublicId }));
    expect(response.status).toBe(200);
    return ((await response.json()) as { channelPrices: ProductBundle }).channelPrices;
  }

  async function reloadGroup(ctx: Awaited<ReturnType<typeof seed>>) {
    const response = await getGroupChannelPrices(request("GET"), params({ tenantId: ctx.tenantId, groupPublicId: ctx.groupPublicId }));
    expect(response.status).toBe(200);
    return ((await response.json()) as { channelPrices: GroupBundle }).channelPrices;
  }

  it("creates three slot channels named only Aggregator 1/2/3, and none of them is a location", async () => {
    const ctx = await seed();
    expect(ctx.channels.map((channel) => [channel.displayName, channel.workbookSlot])).toEqual([
      ["Aggregator 1", "aggregator_1"],
      ["Aggregator 2", "aggregator_2"],
      ["Aggregator 3", "aggregator_3"],
    ]);
    for (const channel of ctx.channels) {
      expect(channel.publicId).toMatch(/^schan_aggregator-\d_[0-9a-f]{8}$/);
    }

    const locationRows = await db.select({ publicId: locations.publicId }).from(locations).where(eq(locations.tenantId, ctx.tenantId));
    expect(locationRows.map((row) => row.publicId).sort()).toEqual(["loc_quotes_hbz", "loc_quotes_hct"]);

    const locationPrices = await getLocationPrices(request("GET"), params({ tenantId: ctx.tenantId, productPublicId: ctx.productPublicId }));
    const locationBundle = (await locationPrices.json()) as { locationPrices: { locations: Array<{ locationPublicId: string }> } };
    expect(locationBundle.locationPrices.locations.map((row) => row.locationPublicId).sort()).toEqual(["loc_quotes_hbz", "loc_quotes_hct"]);

    const export_ = await loadCurrentRecordExport(db, ctx.tenantId, ctx.admin);
    expect(export_.records.Branches.map((row) => row.branch_key).sort()).toEqual(["loc_quotes_hbz", "loc_quotes_hct"]);

    const slotConflict = await postSalesChannel(
      request("POST", { displayName: "Another", code: "another", workbookSlot: "aggregator_2" }),
      params({ tenantId: ctx.tenantId }),
    );
    expect(slotConflict.status).toBe(409);
    expect(await slotConflict.json()).toMatchObject({ code: "workbook_slot_taken", field: "workbookSlot" });
  });

  it("keeps a central price and three different channel prices on a variant and an option through save, reload and export", async () => {
    const ctx = await seed();

    for (const [index, amountMinor] of [2100, 2200, 2300].entries()) {
      expect((await setVariant(ctx, index, { amountMinor })).status).toBe(200);
    }
    for (const [index, amountMinor] of [350, 400, 450].entries()) {
      expect((await setOption(ctx, index, { amountMinor })).status).toBe(200);
    }

    const product = await reloadProduct(ctx);
    const variant = product.variants.find((entry) => entry.variantPublicId === ctx.variantPublicId)!;
    expect(variant.centralAmountMinor).toBe(2000);
    expect(
      Object.entries(byChannel(variant.rows)).map(([slot, row]) => [slot, row.baseAmountMinor, row.overrideAmountMinor, row.effectiveAmountMinor, row.currency, row.inheritanceMode, row.supportedScope, row.version]),
    ).toEqual([
      ["aggregator_1", 2000, 2100, 2100, "AED", "override", "channel_list", 1],
      ["aggregator_2", 2000, 2200, 2200, "AED", "override", "channel_list", 1],
      ["aggregator_3", 2000, 2300, 2300, "AED", "override", "channel_list", 1],
    ]);

    const group = await reloadGroup(ctx);
    const option = group.options.find((entry) => entry.optionPublicId === ctx.optionPublicId)!;
    expect(option.baseAmountMinor).toBe(300);
    expect(option.rows.map((row) => [row.workbookSlot, row.effectiveAmountMinor, row.inheritanceMode])).toEqual([
      ["aggregator_1", 350, "override"],
      ["aggregator_2", 400, "override"],
      ["aggregator_3", 450, "override"],
    ]);

    const exported = await loadCurrentRecordExport(db, ctx.tenantId, ctx.admin);
    expect(exported.records.Variants.find((row) => row.qos_variant_id === ctx.variantPublicId)).toMatchObject({
      amount_minor: "2000",
      currency: "AED",
    });
    expect(exported.records["Sales Channels"].map((row) => [row.channel_code, row.display_name, row.workbook_slot, row.status])).toEqual([
      ["aggregator_1", "Aggregator 1", "aggregator_1", "active"],
      ["aggregator_2", "Aggregator 2", "aggregator_2", "active"],
      ["aggregator_3", "Aggregator 3", "aggregator_3", "active"],
    ]);
    expect(
      exported.records["Variant Channel Prices"].map((row) => [row.qos_variant_id, row.workbook_slot, row.amount_minor, row.currency, row.action]),
    ).toEqual(
      [
        [ctx.variantPublicId, "aggregator_1", "2100", "AED", ""],
        [ctx.variantPublicId, "aggregator_2", "2200", "AED", ""],
        [ctx.variantPublicId, "aggregator_3", "2300", "AED", ""],
      ].sort((a, b) => (a[1]! < b[1]! ? -1 : 1)),
    );
    expect(exported.records["Modifier Option Channel Prices"].map((row) => [row.qos_modifier_option_id, row.workbook_slot, row.amount_minor])).toEqual(
      expect.arrayContaining([
        [ctx.optionPublicId, "aggregator_1", "350"],
        [ctx.optionPublicId, "aggregator_2", "400"],
        [ctx.optionPublicId, "aggregator_3", "450"],
      ]),
    );
    expect(exported.records["Modifier Option Channel Prices"]).toHaveLength(3);
    expect(exported.records["Branch Prices"].map((row) => [row.branch_key, row.amount_minor])).toEqual([["loc_quotes_hct", "2400"]]);

    // The branch override is untouched and still independent of every channel price.
    const overrides = await db
      .select()
      .from(catalogueVariantLocationPriceOverrides)
      .where(eq(catalogueVariantLocationPriceOverrides.tenantId, ctx.tenantId));
    expect(overrides.map((row) => row.amountMinor)).toEqual([2400]);
    expect(resolveBranchAndChannelPrice({ locationPublicId: "loc_quotes_hct", channelPublicId: ctx.channels[0]!.publicId })).toEqual({
      supported: false,
      reason: "branch_channel_intersection_unsupported",
    });
  });

  it("resets one channel only, keeps a zero price, and rejects blank amounts", async () => {
    const ctx = await seed();
    await setVariant(ctx, 0, { amountMinor: 2100 });
    await setVariant(ctx, 1, { amountMinor: 0 });
    await setVariant(ctx, 2, { amountMinor: 2300 });
    await setOption(ctx, 0, { amountMinor: 0 });
    await setOption(ctx, 1, { amountMinor: 400 });

    const blank = await setVariant(ctx, 2, { amountMinor: "" });
    expect(blank.status).toBe(400);
    expect(await blank.json()).toMatchObject({ field: "amountMinor" });
    expect((await setVariant(ctx, 2, {})).status).toBe(400);
    expect((await setVariant(ctx, 2, { amountMinor: null })).status).toBe(400);
    expect((await setVariant(ctx, 2, { amountMinor: -1 })).status).toBe(400);
    expect((await setVariant(ctx, 2, { amountMinor: 12.5 })).status).toBe(400);

    const reset = await resetVariantChannelPrice(
      request("POST"),
      params({
        tenantId: ctx.tenantId,
        productPublicId: ctx.productPublicId,
        variantPublicId: ctx.variantPublicId,
        channelPublicId: ctx.channels[0]!.publicId,
      }),
    );
    expect(reset.status).toBe(200);

    const rows = byChannel((await reloadProduct(ctx)).variants[0]!.rows);
    expect(rows.aggregator_1).toMatchObject({ overrideAmountMinor: null, effectiveAmountMinor: 2000, inheritanceMode: "inherited", canReset: false, version: null });
    expect(rows.aggregator_2).toMatchObject({ overrideAmountMinor: 0, effectiveAmountMinor: 0, inheritanceMode: "override", canReset: true });
    expect(rows.aggregator_3).toMatchObject({ overrideAmountMinor: 2300, effectiveAmountMinor: 2300 });

    const resetAudits = await db.select().from(catalogueVariantChannelPriceResetAudits);
    expect(resetAudits.map((row) => [row.previousAmountMinor, row.resetBySubject])).toEqual([[2100, ADMIN]]);

    const optionReset = await resetOptionChannelPrice(
      request("POST"),
      params({
        tenantId: ctx.tenantId,
        groupPublicId: ctx.groupPublicId,
        optionPublicId: ctx.optionPublicId,
        channelPublicId: ctx.channels[1]!.publicId,
      }),
    );
    expect(optionReset.status).toBe(200);
    const optionRows = byChannel((await reloadGroup(ctx)).options[0]!.rows);
    expect(optionRows.aggregator_1).toMatchObject({ overrideAmountMinor: 0, effectiveAmountMinor: 0, inheritanceMode: "override" });
    expect(optionRows.aggregator_2).toMatchObject({ overrideAmountMinor: null, effectiveAmountMinor: 300, inheritanceMode: "inherited" });
    expect(optionRows.aggregator_3).toMatchObject({ effectiveAmountMinor: 300, inheritanceMode: "inherited" });
    expect((await db.select().from(catalogueModifierOptionChannelPriceResetAudits)).map((row) => row.previousAmountMinor)).toEqual([400]);

    // Reset again: the channel already inherits.
    const again = await resetVariantChannelPrice(
      request("POST"),
      params({
        tenantId: ctx.tenantId,
        productPublicId: ctx.productPublicId,
        variantPublicId: ctx.variantPublicId,
        channelPublicId: ctx.channels[0]!.publicId,
      }),
    );
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ code: "already_inherited" });

    const exported = await loadCurrentRecordExport(db, ctx.tenantId, ctx.admin);
    expect(exported.records["Variant Channel Prices"].map((row) => [row.workbook_slot, row.amount_minor])).toEqual([
      ["aggregator_2", "0"],
      ["aggregator_3", "2300"],
    ]);

    const actions = await db
      .select({ action: tenantAuditEvents.action, entity: tenantAuditEvents.entityPublicId })
      .from(tenantAuditEvents)
      .where(eq(tenantAuditEvents.tenantId, ctx.tenantId));
    const counts = actions.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.action]: (acc[row.action] ?? 0) + 1 }), {});
    expect(counts).toMatchObject({
      "catalogue.sales_channel.create": 3,
      "catalogue.variant.channel_price.set": 3,
      "catalogue.variant.channel_price.reset": 1,
      "catalogue.modifier_option.channel_price.set": 2,
      "catalogue.modifier_option.channel_price.reset": 1,
      "catalogue.location_price.set": 1,
    });
    expect(counts["catalogue.location_price.reset"]).toBeUndefined();

    const overrides = await db.select().from(catalogueVariantLocationPriceOverrides);
    expect(overrides.map((row) => row.amountMinor)).toEqual([2400]);
  });

  it("returns 409 for a stale version and for a currency other than the central one", async () => {
    const ctx = await seed();
    expect((await setVariant(ctx, 0, { amountMinor: 2100, expectedVersion: null })).status).toBe(200);
    expect((await setVariant(ctx, 0, { amountMinor: 2150, expectedVersion: 1 })).status).toBe(200);

    const stale = await setVariant(ctx, 0, { amountMinor: 2200, expectedVersion: 1 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "stale_version", field: "expectedVersion" });

    const expectedNone = await setVariant(ctx, 0, { amountMinor: 2200, expectedVersion: null });
    expect(expectedNone.status).toBe(409);

    const staleReset = await resetVariantChannelPrice(
      request("POST", { expectedVersion: 1 }),
      params({
        tenantId: ctx.tenantId,
        productPublicId: ctx.productPublicId,
        variantPublicId: ctx.variantPublicId,
        channelPublicId: ctx.channels[0]!.publicId,
      }),
    );
    expect(staleReset.status).toBe(409);

    expect((await setOption(ctx, 0, { amountMinor: 1 })).status).toBe(200);
    expect((await setOption(ctx, 0, { amountMinor: 2, expectedVersion: 5 })).status).toBe(409);

    const currency = await setVariant(ctx, 1, { amountMinor: 900, currency: "USD" });
    expect(currency.status).toBe(400);
    expect(await currency.json()).toMatchObject({ code: "currency_mismatch", field: "currency" });

    const [row] = await db
      .select()
      .from(catalogueVariantChannelPrices)
      .where(and(eq(catalogueVariantChannelPrices.tenantId, ctx.tenantId)));
    expect([row?.amountMinor, row?.version, row?.currency]).toEqual([2150, 2, "AED"]);

    const channel = ctx.channels[0]!;
    const staleChannel = await patchSalesChannel(
      request("PATCH", { expectedVersion: channel.version + 1, displayName: "Renamed" }),
      params({ tenantId: ctx.tenantId, channelPublicId: channel.publicId }),
    );
    expect(staleChannel.status).toBe(409);
  });

  it("hides another tenant's records (404) and refuses non-members (403)", async () => {
    const ctx = await seed();
    const flower = await createTenantHierarchy(db, flowerTenantFixture());
    const flowerAdmin = await member(flower.tenant.id, FLOWER_ADMIN, "administrator");
    const flowerProduct = await createDraftProduct(db, flower.tenant.id, flowerAdmin, {
      internalName: "rose",
      translations: { en: { displayName: "Rose", description: null }, ar: { displayName: "وردة", description: null } },
      defaultVariant: { amountMinor: 500, currency: "AED" },
    });
    as(FLOWER_ADMIN);
    const flowerChannelResponse = await postSalesChannel(request("POST", { workbookSlot: "aggregator_1" }), params({ tenantId: flower.tenant.id }));
    const flowerChannel = ((await flowerChannelResponse.json()) as { channel: { publicId: string; version: number } }).channel;

    // Quotes admin addresses Flower records through the Quotes tenant.
    as(ADMIN);
    const foreignProduct = await putVariantChannelPrice(
      request("PUT", { amountMinor: 100 }),
      params({
        tenantId: ctx.tenantId,
        productPublicId: flowerProduct.publicId,
        variantPublicId: flowerProduct.defaultVariant.publicId,
        channelPublicId: ctx.channels[0]!.publicId,
      }),
    );
    expect(foreignProduct.status).toBe(404);
    const foreignChannel = await setVariant(ctx, 0, { amountMinor: 100 }).then(() =>
      putVariantChannelPrice(
        request("PUT", { amountMinor: 100 }),
        params({
          tenantId: ctx.tenantId,
          productPublicId: ctx.productPublicId,
          variantPublicId: ctx.variantPublicId,
          channelPublicId: flowerChannel.publicId,
        }),
      ),
    );
    expect(foreignChannel.status).toBe(404);
    const foreignPatch = await patchSalesChannel(
      request("PATCH", { expectedVersion: flowerChannel.version, displayName: "Taken" }),
      params({ tenantId: ctx.tenantId, channelPublicId: flowerChannel.publicId }),
    );
    expect(foreignPatch.status).toBe(404);
    const foreignRead = await getProductChannelPrices(request("GET"), params({ tenantId: ctx.tenantId, productPublicId: flowerProduct.publicId }));
    expect(foreignRead.status).toBe(404);

    // Quotes admin is not a Flower member.
    const notMember = await listSalesChannels(request("GET"), params({ tenantId: flower.tenant.id }));
    expect(notMember.status).toBe(403);

    // Flower's channel is untouched and Flower sees only its own channel.
    as(FLOWER_ADMIN);
    const flowerList = (await (await listSalesChannels(request("GET"), params({ tenantId: flower.tenant.id }))).json()) as {
      salesChannels: { channels: Array<{ publicId: string; displayName: string }> };
    };
    expect(flowerList.salesChannels.channels).toEqual([expect.objectContaining({ publicId: flowerChannel.publicId, displayName: "Aggregator 1" })]);
  });

  it("lets any member read but only an administrator write channels and channel prices", async () => {
    const ctx = await seed();
    as(USER);

    const read = await getProductChannelPrices(request("GET"), params({ tenantId: ctx.tenantId, productPublicId: ctx.productPublicId }));
    expect(read.status).toBe(200);
    expect(((await read.json()) as { channelPrices: ProductBundle }).channelPrices.canEditPrice).toBe(false);
    expect((await listSalesChannels(request("GET"), params({ tenantId: ctx.tenantId }))).status).toBe(200);

    expect((await setVariant(ctx, 0, { amountMinor: 1 })).status).toBe(403);
    expect((await setOption(ctx, 0, { amountMinor: 1 })).status).toBe(403);
    expect(
      (
        await resetVariantChannelPrice(
          request("POST"),
          params({
            tenantId: ctx.tenantId,
            productPublicId: ctx.productPublicId,
            variantPublicId: ctx.variantPublicId,
            channelPublicId: ctx.channels[0]!.publicId,
          }),
        )
      ).status,
    ).toBe(403);
    expect((await postSalesChannel(request("POST", { displayName: "Mine", code: "mine" }), params({ tenantId: ctx.tenantId }))).status).toBe(403);
    expect(
      (
        await patchSalesChannel(
          request("PATCH", { expectedVersion: 1, status: "archived" }),
          params({ tenantId: ctx.tenantId, channelPublicId: ctx.channels[0]!.publicId }),
        )
      ).status,
    ).toBe(403);
    // Same rule as branch prices: a user cannot change a location price either.
    await expect(
      setProductLocationPriceOverride(db, ctx.tenantId, ctx.user, USER, ctx.productPublicId, "loc_quotes_hbz", {
        amountMinor: 1,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(await db.select().from(catalogueVariantChannelPrices)).toEqual([]);
  });

  it("archives a channel without deleting it or its prices and frees its workbook slot", async () => {
    const ctx = await seed();
    await setVariant(ctx, 2, { amountMinor: 2300 });
    as(ADMIN);

    const channel = ctx.channels[2]!;
    const archived = await patchSalesChannel(
      request("PATCH", { expectedVersion: channel.version, status: "archived" }),
      params({ tenantId: ctx.tenantId, channelPublicId: channel.publicId }),
    );
    expect(archived.status).toBe(200);
    expect(((await archived.json()) as { channel: { status: string; workbookSlot: string | null } }).channel).toMatchObject({
      status: "archived",
      workbookSlot: null,
    });

    expect((await setVariant(ctx, 2, { amountMinor: 1 })).status).toBe(409);
    const bundle = await reloadProduct(ctx);
    expect(bundle.channels.map((entry) => entry.workbookSlot)).toEqual(["aggregator_1", "aggregator_2"]);
    expect(await db.select().from(catalogueVariantChannelPrices)).toHaveLength(1);
    expect(await db.select().from(salesChannels)).toHaveLength(3);

    const replacement = await postSalesChannel(
      request("POST", { displayName: "Aggregator 3", code: "aggregator_3_new", workbookSlot: "aggregator_3" }),
      params({ tenantId: ctx.tenantId }),
    );
    expect(replacement.status).toBe(201);

    const [audit] = await db
      .select()
      .from(tenantAuditEvents)
      .where(and(eq(tenantAuditEvents.tenantId, ctx.tenantId), eq(tenantAuditEvents.action, "catalogue.sales_channel.archive")));
    expect(audit?.entityPublicId).toBe(channel.publicId);
  });
});
