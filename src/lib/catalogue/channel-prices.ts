import { and, asc, eq, inArray } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  catalogueModifierGroups,
  catalogueModifierOptionChannelPriceResetAudits,
  catalogueModifierOptionChannelPrices,
  catalogueModifierOptions,
  catalogueProducts,
  catalogueVariantChannelPriceResetAudits,
  catalogueVariantChannelPrices,
  catalogueVariantPrices,
  catalogueVariants,
} from "@/db/schema";
import {
  auditActorClassFromStaffRole,
  recordTenantAuditEventInTx,
} from "@/lib/audit/tenant-audit";
import {
  assertChannelPriceCurrency,
  ChannelPriceCurrencyMismatchError,
  isValidChannelAmountMinor,
  normalizeCurrency,
  resolveChannelPrice,
  type ResolvedChannelPrice,
} from "@/lib/catalogue/channel-price-resolver";
import { requirePriceEditCapability } from "@/lib/catalogue/location-price-overrides";
import { loadCatalogueProductForMutationInTx } from "@/lib/catalogue/product-mutation-policy";
import {
  isUniqueViolation,
  loadSalesChannelByPublicIdInTx,
  loadSalesChannelsInTx,
  SalesChannelError,
  toSalesChannelView,
  type SalesChannelView,
} from "@/lib/catalogue/sales-channels";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import type { TenantDbExecutor } from "@/lib/tenant/context";
import { withTenantContext } from "@/lib/tenant/context";

/* Channel price lists for variants and modifier options (QOS-213). Writes
   change the current catalogue only: no published menu revision, storefront
   price or branch override is read or rewritten here. Every write needs the
   administrator price-write role, the same as central and branch prices. */

export type ChannelPriceRowView = ResolvedChannelPrice & {
  channelPublicId: string;
  channelCode: string;
  channelDisplayName: string;
  workbookSlot: SalesChannelView["workbookSlot"];
  canReset: boolean;
};

export type VariantChannelPricesView = {
  variantPublicId: string;
  isDefault: boolean;
  status: "active" | "archived";
  currency: string | null;
  centralAmountMinor: number | null;
  centralPriceVersion: number | null;
  rows: ChannelPriceRowView[];
};

export type ProductChannelPricesBundle = {
  productPublicId: string;
  canEditPrice: boolean;
  channels: SalesChannelView[];
  variants: VariantChannelPricesView[];
};

export type ModifierOptionChannelPricesView = {
  optionPublicId: string;
  status: "active" | "archived";
  currency: string;
  baseAmountMinor: number;
  rows: ChannelPriceRowView[];
};

export type ModifierGroupChannelPricesBundle = {
  groupPublicId: string;
  canEditPrice: boolean;
  channels: SalesChannelView[];
  options: ModifierOptionChannelPricesView[];
};

export type SetChannelPriceInput = {
  amountMinor?: unknown;
  /** Optional; when given it must equal the central (or option) currency. */
  currency?: unknown;
  /** Omit to skip the check; null means "I expect no explicit price yet". */
  expectedVersion?: unknown;
};

export type ResetChannelPriceInput = {
  expectedVersion?: unknown;
};

function parseAmountMinor(value: unknown) {
  // Blank, null and strings are refused: only a typed integer is a price, and 0 is a real one.
  if (!isValidChannelAmountMinor(value)) {
    throw new SalesChannelError(
      "amountMinor must be a whole number of minor units, 0 or more.",
      400,
      "amountMinor",
    );
  }
  return value;
}

function assertInputCurrency(input: SetChannelPriceInput, currency: string) {
  if (input.currency === undefined) {
    return;
  }
  if (typeof input.currency !== "string") {
    throw new SalesChannelError("currency must be a three-letter code.", 400, "currency");
  }
  assertChannelPriceCurrency({ amountMinor: 0, currency }, input.currency);
}

function parseExpectedVersion(value: unknown): number | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new SalesChannelError("expectedVersion must be a positive integer.", 400, "expectedVersion");
  }
  return value as number;
}

function assertExpectedVersion(
  expected: number | null | undefined,
  current: { version: number } | undefined,
) {
  if (expected === undefined) {
    return;
  }
  const actual = current?.version ?? null;
  if (expected !== actual) {
    throw new SalesChannelError(
      "This channel price was changed elsewhere. Reload and try again.",
      409,
      "expectedVersion",
      "stale_version",
    );
  }
}

function resolveRows(
  channels: SalesChannelView[],
  base: { amountMinor: number; currency: string },
  overrides: Map<string, { amountMinor: number; currency: string; version: number }>,
  channelIdByPublicId: Map<string, string>,
): ChannelPriceRowView[] {
  return channels.map((channel) => {
    const override = overrides.get(channelIdByPublicId.get(channel.publicId) ?? "") ?? null;
    const resolved = resolveChannelPrice(base, override);
    return {
      ...resolved,
      channelPublicId: channel.publicId,
      channelCode: channel.code,
      channelDisplayName: channel.displayName,
      workbookSlot: channel.workbookSlot,
      canReset: resolved.inheritanceMode === "override",
    };
  });
}

async function loadActiveChannels(tx: TenantDbExecutor, tenantId: string) {
  const rows = (await loadSalesChannelsInTx(tx, tenantId)).filter((row) => row.status === "active");
  return {
    rows,
    views: rows.map(toSalesChannelView),
    idByPublicId: new Map(rows.map((row) => [row.publicId, row.id])),
  };
}

async function loadProductOrThrow(tx: TenantDbExecutor, tenantId: string, productPublicId: string) {
  const [product] = await tx
    .select({ id: catalogueProducts.id, publicId: catalogueProducts.publicId })
    .from(catalogueProducts)
    .where(and(eq(catalogueProducts.tenantId, tenantId), eq(catalogueProducts.publicId, productPublicId)))
    .limit(1);
  if (!product) {
    throw new SalesChannelError("Product not found.", 404);
  }
  return product;
}

async function buildProductChannelPricesInTx(
  tx: TenantDbExecutor,
  tenantId: string,
  membership: ActiveStaffMembership,
  productPublicId: string,
): Promise<ProductChannelPricesBundle> {
  const product = await loadProductOrThrow(tx, tenantId, productPublicId);
  const channels = await loadActiveChannels(tx, tenantId);

  const joinedRows = await tx
    .select({
      id: catalogueVariants.id,
      publicId: catalogueVariants.publicId,
      isDefault: catalogueVariants.isDefault,
      status: catalogueVariants.status,
      currency: catalogueVariantPrices.currency,
      amountMinor: catalogueVariantPrices.amountMinor,
      priceVersion: catalogueVariantPrices.version,
    })
    .from(catalogueVariants)
    .leftJoin(
      catalogueVariantPrices,
      and(
        eq(catalogueVariantPrices.tenantId, tenantId),
        eq(catalogueVariantPrices.variantId, catalogueVariants.id),
      ),
    )
    .where(and(eq(catalogueVariants.tenantId, tenantId), eq(catalogueVariants.productId, product.id)))
    .orderBy(
      asc(catalogueVariants.sortOrder),
      asc(catalogueVariants.publicId),
      asc(catalogueVariantPrices.currency),
    );
  // One central price per variant (the same first-currency rule as the write path).
  const seenVariantIds = new Set<string>();
  const variantRows = joinedRows.filter((row) => {
    if (seenVariantIds.has(row.id)) {
      return false;
    }
    seenVariantIds.add(row.id);
    return true;
  });

  const variantIds = variantRows.map((row) => row.id);
  const priceRows =
    variantIds.length === 0
      ? []
      : await tx
          .select()
          .from(catalogueVariantChannelPrices)
          .where(
            and(
              eq(catalogueVariantChannelPrices.tenantId, tenantId),
              inArray(catalogueVariantChannelPrices.variantId, variantIds),
            ),
          );

  const variants = variantRows.map((variant): VariantChannelPricesView => {
    const base =
      variant.currency != null && variant.amountMinor != null
        ? { amountMinor: variant.amountMinor, currency: normalizeCurrency(variant.currency) }
        : null;
    const overrides = new Map(
      priceRows
        .filter(
          (row) =>
            row.variantId === variant.id &&
            base !== null &&
            normalizeCurrency(row.currency) === base.currency,
        )
        .map((row) => [
          row.channelId,
          { amountMinor: row.amountMinor, currency: row.currency, version: row.version },
        ]),
    );
    return {
      variantPublicId: variant.publicId,
      isDefault: variant.isDefault,
      status: variant.status === "archived" ? "archived" : "active",
      currency: base?.currency ?? null,
      centralAmountMinor: base?.amountMinor ?? null,
      centralPriceVersion: variant.priceVersion ?? null,
      rows: base ? resolveRows(channels.views, base, overrides, channels.idByPublicId) : [],
    };
  });

  return {
    productPublicId: product.publicId,
    canEditPrice: membership.role === "administrator",
    channels: channels.views,
    variants,
  };
}

export async function getProductChannelPrices(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  productPublicId: string,
) {
  return withTenantContext(db, tenantId, (tx) =>
    buildProductChannelPricesInTx(tx, tenantId, membership, productPublicId),
  );
}

async function loadVariantPriceContext(
  tx: TenantDbExecutor,
  tenantId: string,
  productPublicId: string,
  variantPublicId: string,
  channelPublicId: string,
) {
  const product = await loadCatalogueProductForMutationInTx(tx, tenantId, productPublicId);
  const [variant] = await tx
    .select()
    .from(catalogueVariants)
    .where(
      and(
        eq(catalogueVariants.tenantId, tenantId),
        eq(catalogueVariants.productId, product.id),
        eq(catalogueVariants.publicId, variantPublicId),
      ),
    )
    .limit(1);
  if (!variant) {
    throw new SalesChannelError("Variant not found.", 404, "variantPublicId");
  }
  if (variant.status === "archived") {
    throw new SalesChannelError("Archived variants cannot be priced.", 409, "variantPublicId", "variant_archived");
  }

  const [central] = await tx
    .select()
    .from(catalogueVariantPrices)
    .where(and(eq(catalogueVariantPrices.tenantId, tenantId), eq(catalogueVariantPrices.variantId, variant.id)))
    .orderBy(asc(catalogueVariantPrices.currency))
    .limit(1);
  if (!central) {
    throw new SalesChannelError(
      "Set the central price before adding channel prices.",
      409,
      "variantPublicId",
      "central_price_missing",
    );
  }

  const channel = await loadSalesChannelByPublicIdInTx(tx, tenantId, channelPublicId);
  if (channel.status !== "active") {
    throw new SalesChannelError("Archived channels cannot be priced.", 409, "channelPublicId", "channel_archived");
  }

  const currency = normalizeCurrency(central.currency);
  const [existing] = await tx
    .select()
    .from(catalogueVariantChannelPrices)
    .where(
      and(
        eq(catalogueVariantChannelPrices.tenantId, tenantId),
        eq(catalogueVariantChannelPrices.variantId, variant.id),
        eq(catalogueVariantChannelPrices.channelId, channel.id),
        eq(catalogueVariantChannelPrices.currency, currency),
      ),
    )
    .limit(1)
    .for("update");

  return { product, variant, central, currency, channel, existing };
}

export async function setVariantChannelPrice(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  staffSubject: string,
  productPublicId: string,
  variantPublicId: string,
  channelPublicId: string,
  input: SetChannelPriceInput,
): Promise<ProductChannelPricesBundle> {
  requirePriceEditCapability(membership, "Administrator membership is required to change channel prices.");
  const amountMinor = parseAmountMinor(input.amountMinor);
  const expectedVersion = parseExpectedVersion(input.expectedVersion);

  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const context = await loadVariantPriceContext(tx, tenantId, productPublicId, variantPublicId, channelPublicId);
      assertInputCurrency(input, context.currency);
      assertExpectedVersion(expectedVersion, context.existing);

      const now = new Date();
      let version: number;
      if (context.existing) {
        version = context.existing.version + 1;
        const [updated] = await tx
          .update(catalogueVariantChannelPrices)
          .set({
            amountMinor,
            version,
            centralPriceVersionAtOverride: context.central.version,
            updatedBySubject: staffSubject,
            updatedAt: now,
          })
          .where(
            and(
              eq(catalogueVariantChannelPrices.id, context.existing.id),
              eq(catalogueVariantChannelPrices.version, context.existing.version),
            ),
          )
          .returning({ id: catalogueVariantChannelPrices.id });
        if (!updated) {
          assertExpectedVersion(context.existing.version, undefined);
        }
      } else {
        version = 1;
        await tx.insert(catalogueVariantChannelPrices).values({
          tenantId,
          variantId: context.variant.id,
          channelId: context.channel.id,
          currency: context.currency,
          amountMinor,
          version,
          centralPriceVersionAtOverride: context.central.version,
          createdBySubject: staffSubject,
          updatedBySubject: staffSubject,
        });
      }

      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject: staffSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action: "catalogue.variant.channel_price.set",
        entityType: "variant_channel_price",
        entityPublicId: `${variantPublicId}@${channelPublicId}`,
        entityVersion: version,
        changeSummary: {
          productPublicId,
          variantPublicId,
          channelPublicId,
          currency: context.currency,
          centralPriceVersion: context.central.version,
          before: { amountMinor: context.existing?.amountMinor ?? null },
          after: { amountMinor },
        },
      });

      return buildProductChannelPricesInTx(tx, tenantId, membership, productPublicId);
    });
  } catch (error) {
    throw mapWriteError(error);
  }
}

export async function resetVariantChannelPrice(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  staffSubject: string,
  productPublicId: string,
  variantPublicId: string,
  channelPublicId: string,
  input: ResetChannelPriceInput = {},
): Promise<ProductChannelPricesBundle> {
  requirePriceEditCapability(membership, "Administrator membership is required to change channel prices.");
  const expectedVersion = parseExpectedVersion(input.expectedVersion);

  return withTenantContext(db, tenantId, async (tx) => {
    const context = await loadVariantPriceContext(tx, tenantId, productPublicId, variantPublicId, channelPublicId);
    assertExpectedVersion(expectedVersion, context.existing);
    if (!context.existing) {
      throw new SalesChannelError(
        "This channel already uses the central price.",
        400,
        "channelPublicId",
        "already_inherited",
      );
    }

    await tx.insert(catalogueVariantChannelPriceResetAudits).values({
      tenantId,
      variantId: context.variant.id,
      channelId: context.channel.id,
      currency: context.existing.currency,
      previousAmountMinor: context.existing.amountMinor,
      resetBySubject: staffSubject,
    });
    await tx
      .delete(catalogueVariantChannelPrices)
      .where(eq(catalogueVariantChannelPrices.id, context.existing.id));

    await recordTenantAuditEventInTx(tx, {
      tenantId,
      actorSubject: staffSubject,
      actorClass: auditActorClassFromStaffRole(membership.role),
      action: "catalogue.variant.channel_price.reset",
      entityType: "variant_channel_price",
      entityPublicId: `${variantPublicId}@${channelPublicId}`,
      entityVersion: context.existing.version,
      changeSummary: {
        productPublicId,
        variantPublicId,
        channelPublicId,
        currency: context.currency,
        before: { amountMinor: context.existing.amountMinor },
        after: { amountMinor: context.central.amountMinor, inherited: true },
      },
    });

    return buildProductChannelPricesInTx(tx, tenantId, membership, productPublicId);
  });
}

async function loadGroupOrThrow(tx: TenantDbExecutor, tenantId: string, groupPublicId: string) {
  const [group] = await tx
    .select()
    .from(catalogueModifierGroups)
    .where(and(eq(catalogueModifierGroups.tenantId, tenantId), eq(catalogueModifierGroups.publicId, groupPublicId)))
    .limit(1);
  if (!group) {
    throw new SalesChannelError("Modifier group not found.", 404);
  }
  return group;
}

async function buildModifierGroupChannelPricesInTx(
  tx: TenantDbExecutor,
  tenantId: string,
  membership: ActiveStaffMembership,
  groupPublicId: string,
): Promise<ModifierGroupChannelPricesBundle> {
  const group = await loadGroupOrThrow(tx, tenantId, groupPublicId);
  const channels = await loadActiveChannels(tx, tenantId);
  const optionRows = await tx
    .select()
    .from(catalogueModifierOptions)
    .where(and(eq(catalogueModifierOptions.tenantId, tenantId), eq(catalogueModifierOptions.modifierGroupId, group.id)))
    .orderBy(asc(catalogueModifierOptions.sortOrder), asc(catalogueModifierOptions.publicId));
  const optionIds = optionRows.map((row) => row.id);
  const priceRows =
    optionIds.length === 0
      ? []
      : await tx
          .select()
          .from(catalogueModifierOptionChannelPrices)
          .where(
            and(
              eq(catalogueModifierOptionChannelPrices.tenantId, tenantId),
              inArray(catalogueModifierOptionChannelPrices.modifierOptionId, optionIds),
            ),
          );

  return {
    groupPublicId: group.publicId,
    canEditPrice: membership.role === "administrator",
    channels: channels.views,
    options: optionRows.map((option) => {
      const base = { amountMinor: option.priceMinor, currency: normalizeCurrency(option.currency) };
      const overrides = new Map(
        priceRows
          .filter((row) => row.modifierOptionId === option.id && normalizeCurrency(row.currency) === base.currency)
          .map((row) => [row.channelId, { amountMinor: row.amountMinor, currency: row.currency, version: row.version }]),
      );
      return {
        optionPublicId: option.publicId,
        status: option.status === "archived" ? "archived" : "active",
        currency: base.currency,
        baseAmountMinor: base.amountMinor,
        rows: resolveRows(channels.views, base, overrides, channels.idByPublicId),
      };
    }),
  };
}

export async function getModifierGroupChannelPrices(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  groupPublicId: string,
) {
  return withTenantContext(db, tenantId, (tx) =>
    buildModifierGroupChannelPricesInTx(tx, tenantId, membership, groupPublicId),
  );
}

async function loadOptionPriceContext(
  tx: TenantDbExecutor,
  tenantId: string,
  groupPublicId: string,
  optionPublicId: string,
  channelPublicId: string,
) {
  const group = await loadGroupOrThrow(tx, tenantId, groupPublicId);
  const [option] = await tx
    .select()
    .from(catalogueModifierOptions)
    .where(
      and(
        eq(catalogueModifierOptions.tenantId, tenantId),
        eq(catalogueModifierOptions.modifierGroupId, group.id),
        eq(catalogueModifierOptions.publicId, optionPublicId),
      ),
    )
    .limit(1);
  if (!option) {
    throw new SalesChannelError("Modifier option not found.", 404, "optionPublicId");
  }
  if (option.status === "archived") {
    throw new SalesChannelError("Archived options cannot be priced.", 409, "optionPublicId", "option_archived");
  }

  const channel = await loadSalesChannelByPublicIdInTx(tx, tenantId, channelPublicId);
  if (channel.status !== "active") {
    throw new SalesChannelError("Archived channels cannot be priced.", 409, "channelPublicId", "channel_archived");
  }

  const currency = normalizeCurrency(option.currency);
  const [existing] = await tx
    .select()
    .from(catalogueModifierOptionChannelPrices)
    .where(
      and(
        eq(catalogueModifierOptionChannelPrices.tenantId, tenantId),
        eq(catalogueModifierOptionChannelPrices.modifierOptionId, option.id),
        eq(catalogueModifierOptionChannelPrices.channelId, channel.id),
        eq(catalogueModifierOptionChannelPrices.currency, currency),
      ),
    )
    .limit(1)
    .for("update");

  return { group, option, currency, channel, existing };
}

export async function setModifierOptionChannelPrice(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  staffSubject: string,
  groupPublicId: string,
  optionPublicId: string,
  channelPublicId: string,
  input: SetChannelPriceInput,
): Promise<ModifierGroupChannelPricesBundle> {
  requirePriceEditCapability(membership, "Administrator membership is required to change channel prices.");
  const amountMinor = parseAmountMinor(input.amountMinor);
  const expectedVersion = parseExpectedVersion(input.expectedVersion);

  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const context = await loadOptionPriceContext(tx, tenantId, groupPublicId, optionPublicId, channelPublicId);
      assertInputCurrency(input, context.currency);
      assertExpectedVersion(expectedVersion, context.existing);

      let version: number;
      if (context.existing) {
        version = context.existing.version + 1;
        const [updated] = await tx
          .update(catalogueModifierOptionChannelPrices)
          .set({ amountMinor, version, updatedBySubject: staffSubject, updatedAt: new Date() })
          .where(
            and(
              eq(catalogueModifierOptionChannelPrices.id, context.existing.id),
              eq(catalogueModifierOptionChannelPrices.version, context.existing.version),
            ),
          )
          .returning({ id: catalogueModifierOptionChannelPrices.id });
        if (!updated) {
          assertExpectedVersion(context.existing.version, undefined);
        }
      } else {
        version = 1;
        await tx.insert(catalogueModifierOptionChannelPrices).values({
          tenantId,
          modifierOptionId: context.option.id,
          channelId: context.channel.id,
          currency: context.currency,
          amountMinor,
          version,
          createdBySubject: staffSubject,
          updatedBySubject: staffSubject,
        });
      }

      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject: staffSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action: "catalogue.modifier_option.channel_price.set",
        entityType: "modifier_option_channel_price",
        entityPublicId: `${optionPublicId}@${channelPublicId}`,
        entityVersion: version,
        changeSummary: {
          groupPublicId,
          optionPublicId,
          channelPublicId,
          currency: context.currency,
          before: { amountMinor: context.existing?.amountMinor ?? null },
          after: { amountMinor },
        },
      });

      return buildModifierGroupChannelPricesInTx(tx, tenantId, membership, groupPublicId);
    });
  } catch (error) {
    throw mapWriteError(error);
  }
}

export async function resetModifierOptionChannelPrice(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  staffSubject: string,
  groupPublicId: string,
  optionPublicId: string,
  channelPublicId: string,
  input: ResetChannelPriceInput = {},
): Promise<ModifierGroupChannelPricesBundle> {
  requirePriceEditCapability(membership, "Administrator membership is required to change channel prices.");
  const expectedVersion = parseExpectedVersion(input.expectedVersion);

  return withTenantContext(db, tenantId, async (tx) => {
    const context = await loadOptionPriceContext(tx, tenantId, groupPublicId, optionPublicId, channelPublicId);
    assertExpectedVersion(expectedVersion, context.existing);
    if (!context.existing) {
      throw new SalesChannelError(
        "This channel already uses the central price.",
        400,
        "channelPublicId",
        "already_inherited",
      );
    }

    await tx.insert(catalogueModifierOptionChannelPriceResetAudits).values({
      tenantId,
      modifierOptionId: context.option.id,
      channelId: context.channel.id,
      currency: context.existing.currency,
      previousAmountMinor: context.existing.amountMinor,
      resetBySubject: staffSubject,
    });
    await tx
      .delete(catalogueModifierOptionChannelPrices)
      .where(eq(catalogueModifierOptionChannelPrices.id, context.existing.id));

    await recordTenantAuditEventInTx(tx, {
      tenantId,
      actorSubject: staffSubject,
      actorClass: auditActorClassFromStaffRole(membership.role),
      action: "catalogue.modifier_option.channel_price.reset",
      entityType: "modifier_option_channel_price",
      entityPublicId: `${optionPublicId}@${channelPublicId}`,
      entityVersion: context.existing.version,
      changeSummary: {
        groupPublicId,
        optionPublicId,
        channelPublicId,
        currency: context.currency,
        before: { amountMinor: context.existing.amountMinor },
        after: { amountMinor: context.option.priceMinor, inherited: true },
      },
    });

    return buildModifierGroupChannelPricesInTx(tx, tenantId, membership, groupPublicId);
  });
}

function mapWriteError(error: unknown) {
  if (isUniqueViolation(error)) {
    // Two writers created the same channel price at once; the loser reloads.
    return new SalesChannelError(
      "This channel price was changed elsewhere. Reload and try again.",
      409,
      "expectedVersion",
      "stale_version",
    );
  }
  if (error instanceof ChannelPriceCurrencyMismatchError) {
    return new SalesChannelError(error.message, 400, "currency", "currency_mismatch");
  }
  return error;
}
