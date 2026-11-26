import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { staffIdentities, staffMemberships } from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { truncateInventory } from "@/lib/inventory/integration-helpers";
import { createSalesChannel } from "@/lib/catalogue/sales-channels";
import { setVariantChannelPrice } from "@/lib/catalogue/channel-prices";
import { seedEffectFixtures, seedRecipeFixtures, type RecipeFixtures } from "@/lib/recipes/integration-helpers";
import { StaffAuthError } from "@/lib/staff/session";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

import { GET as getRecipe, PATCH as patchRecipe } from "./[recipePublicId]/route";
import { POST as approve } from "./[recipePublicId]/versions/[versionPublicId]/approve/route";
import { PUT as putEffects } from "./[recipePublicId]/versions/[versionPublicId]/effects/route";
import { PUT as putLines } from "./[recipePublicId]/versions/[versionPublicId]/lines/route";
import { GET as getVersion, PATCH as patchVersion } from "./[recipePublicId]/versions/[versionPublicId]/route";
import { PUT as putSteps } from "./[recipePublicId]/versions/[versionPublicId]/steps/route";
import { POST as postVersion } from "./[recipePublicId]/versions/route";
import { GET as preview } from "./consumption-preview/route";
import { GET as listRecipes, POST as postRecipe } from "./route";
import { PATCH as patchLink } from "./sellable-links/[linkPublicId]/route";
import { GET as listLinks, POST as postLink } from "./sellable-links/route";

const staffMocks = vi.hoisted(() => ({ requireStaffIdentity: vi.fn() }));

vi.mock("@/lib/staff/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/staff/auth")>();
  return { ...actual, requireStaffIdentity: staffMocks.requireStaffIdentity };
});

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;
const ADMIN_MEMBERSHIP = { membershipId: "seed-admin", role: "administrator" as const, staffIdentityId: "seed-admin" };

const ADMIN = "admin.qos198.quotes@test";
const USER = "user.qos198.quotes@test";
const OUTSIDER = "admin.qos198.flower@test";

type Json = Record<string, unknown>;
type Detail = {
  recipe: { publicId: string; version: number };
  versions: Array<{ publicId: string; version: number; status: string; lines: Array<{ publicId: string }>; steps: unknown[] }>;
};

integrationDescribe("recipe routes", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];
  let tenantId: string;
  let otherTenantId: string;
  let fx: RecipeFixtures;
  let other: RecipeFixtures;

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
    await grantRoleMembership(sqlClient, "qos", "qos_app");
  }, 120_000);

  afterAll(async () => {
    await sqlClient.end({ timeout: 5 });
  });

  async function seedMember(target: string, subject: string, role: "administrator" | "user") {
    const [identity] = await db.insert(staffIdentities).values({ providerSubject: subject, email: subject }).returning();
    await db.insert(staffMemberships).values({ tenantId: target, staffIdentityId: identity!.id, role });
  }

  beforeEach(async () => {
    await truncateInventory(sqlClient);
    staffMocks.requireStaffIdentity.mockReset();
    tenantId = (await createTenantHierarchy(db, quotesTenantFixture())).tenant.id;
    otherTenantId = (await createTenantHierarchy(db, flowerTenantFixture())).tenant.id;
    await seedMember(tenantId, ADMIN, "administrator");
    await seedMember(tenantId, USER, "user");
    await seedMember(otherTenantId, OUTSIDER, "administrator");
    fx = await seedRecipeFixtures(db, tenantId);
    other = await seedRecipeFixtures(db, otherTenantId);
  });

  function signIn(subject: string) {
    staffMocks.requireStaffIdentity.mockResolvedValue({ subject, email: subject });
  }

  const ctx = <T extends Json>(params: T, tenant = tenantId) => ({ params: Promise.resolve({ tenantId: tenant, ...params }) });
  const request = (method: string, body?: unknown, url = "http://localhost/api/recipes") =>
    new Request(url, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    });
  async function call(response: Promise<Response>) {
    const resolved = await response;
    return { status: resolved.status, body: (await resolved.json()) as Json };
  }

  async function createLatte() {
    signIn(ADMIN);
    const created = await call(postRecipe(request("POST", { nameEn: "Latte", nameAr: "لاتيه", kind: "sellable", yieldQuantity: "4", yieldUnitPublicId: fx.units.portion }), ctx({})));
    expect(created.status).toBe(201);
    const detail = created.body as unknown as Detail;
    return { recipe: detail.recipe.publicId, draft: detail.versions[0]!.publicId };
  }

  async function approvedLatte() {
    const { recipe, draft } = await createLatte();
    const ids = { recipePublicId: recipe, versionPublicId: draft };
    const lines = await call(putLines(request("PUT", {
      expectedVersion: 1,
      lines: [{ itemPublicId: fx.items.milk, quantity: "1000", unitPublicId: fx.units.ml, labelEn: "Steam" }],
    }), ctx(ids)));
    expect(lines.status).toBe(200);
    const approved = await call(approve(request("POST", { expectedVersion: 2, effectiveFrom: "2026-11-01" }), ctx(ids)));
    expect(approved.status).toBe(200);
    return { recipe, v1: draft };
  }

  it("answers 401 without a staff session on every handler", async () => {
    staffMocks.requireStaffIdentity.mockRejectedValue(new StaffAuthError("Sign in required."));
    const ids = { recipePublicId: "rec_x", versionPublicId: "recv_x" };
    const responses = await Promise.all([
      listRecipes(request("GET"), ctx({})),
      postRecipe(request("POST", {}), ctx({})),
      getRecipe(request("GET"), ctx({ recipePublicId: "rec_x" })),
      patchRecipe(request("PATCH", {}), ctx({ recipePublicId: "rec_x" })),
      postVersion(request("POST", {}), ctx({ recipePublicId: "rec_x" })),
      getVersion(request("GET"), ctx(ids)),
      patchVersion(request("PATCH", {}), ctx(ids)),
      putLines(request("PUT", {}), ctx(ids)),
      putSteps(request("PUT", {}), ctx(ids)),
      putEffects(request("PUT", {}), ctx(ids)),
      approve(request("POST", {}), ctx(ids)),
      listLinks(request("GET"), ctx({})),
      postLink(request("POST", {}), ctx({})),
      patchLink(request("PATCH", {}), ctx({ linkPublicId: "link_x" })),
      preview(request("GET", undefined, "http://localhost/api/recipes/consumption-preview?variantPublicId=var_x"), ctx({})),
    ]);
    expect(responses.map((response) => response.status)).toEqual(Array(15).fill(401));
  });

  it("answers 403 to a staff member of another business, for reads and writes", async () => {
    const { recipe } = await createLatte();
    signIn(OUTSIDER);
    expect((await call(listRecipes(request("GET"), ctx({})))).status).toBe(403);
    expect((await call(getRecipe(request("GET"), ctx({ recipePublicId: recipe })))).status).toBe(403);
    expect((await call(listLinks(request("GET"), ctx({})))).status).toBe(403);
    expect((await call(postRecipe(request("POST", { nameEn: "Hijack", kind: "sellable" }), ctx({})))).status).toBe(403);
    expect(
      (await call(preview(request("GET", undefined, `http://localhost/x?variantPublicId=${fx.latte.regular}`), ctx({})))).status,
    ).toBe(403);
  });

  it("lets a user-role member read recipes, links and previews but answers 403 administrator_required on every write", async () => {
    const { recipe, v1 } = await approvedLatte();
    signIn(USER);
    expect((await call(listRecipes(request("GET"), ctx({})))).status).toBe(200);
    expect((await call(getRecipe(request("GET"), ctx({ recipePublicId: recipe })))).status).toBe(200);
    expect((await call(getVersion(request("GET"), ctx({ recipePublicId: recipe, versionPublicId: v1 })))).status).toBe(200);
    expect((await call(listLinks(request("GET"), ctx({})))).status).toBe(200);
    expect(
      (await call(preview(request("GET", undefined, `http://localhost/x?variantPublicId=${fx.latte.regular}`), ctx({})))).status,
    ).toBe(200);
    const ids = { recipePublicId: recipe, versionPublicId: v1 };
    const writes = await Promise.all([
      call(postRecipe(request("POST", { nameEn: "Tea", kind: "sellable" }), ctx({}))),
      call(patchRecipe(request("PATCH", { expectedVersion: 1, nameEn: "X" }), ctx({ recipePublicId: recipe }))),
      call(postVersion(request("POST", { fromVersionPublicId: v1 }), ctx({ recipePublicId: recipe }))),
      call(patchVersion(request("PATCH", { expectedVersion: 1, notes: "x" }), ctx(ids))),
      call(putLines(request("PUT", { expectedVersion: 1, lines: [] }), ctx(ids))),
      call(putSteps(request("PUT", { expectedVersion: 1, steps: [] }), ctx(ids))),
      call(putEffects(request("PUT", { expectedVersion: 1, effects: [] }), ctx(ids))),
      call(approve(request("POST", { expectedVersion: 1, effectiveFrom: "2026-12-01" }), ctx(ids))),
      call(postLink(request("POST", { variantPublicId: fx.latte.regular, kind: "recipe", recipePublicId: recipe }), ctx({}))),
      call(patchLink(request("PATCH", { operation: "end" }), ctx({ linkPublicId: "link_x" }))),
    ]);
    expect(writes.map((write) => [write.status, write.body.code])).toEqual(Array(10).fill([403, "administrator_required"]));
  });

  it("round-trips a recipe, its draft, lines, steps, approval, history, links and preview through the routes", async () => {
    const { recipe, draft } = await createLatte();
    signIn(ADMIN);
    const ids = { recipePublicId: recipe, versionPublicId: draft };
    expect((await call(patchVersion(request("PATCH", { expectedVersion: 1, notes: "Hot" }), ctx(ids)))).status).toBe(200);
    const lines = await call(putLines(request("PUT", {
      expectedVersion: 2,
      lines: [
        { itemPublicId: fx.items.beans, quantity: "72", unitPublicId: fx.units.g },
        { itemPublicId: fx.items.milk, quantity: "1000", unitPublicId: fx.units.ml, labelEn: "Steam", labelAr: "بخّر" },
      ],
    }), ctx(ids)));
    expect(lines.status).toBe(200);
    const steps = await call(putSteps(request("PUT", { expectedVersion: 3, steps: [{ textEn: "Pull.", textAr: "استخرج." }, { textEn: "Pour." }] }), ctx(ids)));
    expect(steps.status).toBe(200);
    const reloaded = await call(getRecipe(request("GET"), ctx({ recipePublicId: recipe })));
    const version = (reloaded.body as unknown as { versions: Array<Json & { lines: Json[]; steps: Json[] }> }).versions[0]!;
    expect(version).toMatchObject({ notes: "Hot", yieldQuantity: "4", yieldUnit: { code: "portion" }, version: 4 });
    expect(version.lines.map((line) => [line.position, line.quantity, line.labelAr])).toEqual([[0, "72", null], [1, "1000", "بخّر"]]);
    expect(version.steps.map((step) => [step.position, step.textEn, step.textAr])).toEqual([[0, "Pull.", "استخرج."], [1, "Pour.", null]]);

    const approved = await call(approve(request("POST", { expectedVersion: 4, effectiveFrom: "2026-11-01" }), ctx(ids)));
    expect(approved.body).toMatchObject({ effect: { versionNumber: 1, supersededVersion: null, postedUsageAffected: 0 } });
    const history = await call(getVersion(request("GET"), ctx(ids)));
    expect(history.body).toMatchObject({ recipe: { publicId: recipe }, version: { status: "approved", effectiveFrom: "2026-11-01" } });
    const nextDraft = await call(postVersion(request("POST", { fromVersionPublicId: draft }), ctx({ recipePublicId: recipe })));
    expect(nextDraft.status).toBe(201);
    expect((nextDraft.body as unknown as Detail).versions.map((entry) => entry.status)).toEqual(["draft", "approved"]);

    const linked = await call(postLink(request("POST", { variantPublicId: fx.latte.regular, kind: "recipe", recipePublicId: recipe }), ctx({})));
    expect(linked.status).toBe(201);
    const variants = (linked.body as unknown as { variants: Array<{ variantPublicId: string; link: { publicId: string } | null }> }).variants;
    const linkPublicId = variants.find((row) => row.variantPublicId === fx.latte.regular)!.link!.publicId;
    const shown = await call(preview(request("GET", undefined, `http://localhost/x?variantPublicId=${fx.latte.regular}&quantity=2`), ctx({})));
    expect(shown.status).toBe(200);
    expect(shown.body).toMatchObject({ status: "resolved", kind: "recipe", soldQuantity: 2, version: { versionNumber: 1 } });
    const ended = await call(patchLink(request("PATCH", { operation: "end" }), ctx({ linkPublicId })));
    expect(ended.status).toBe(200);
  });

  it("answers 404 for unknown or another business's recipe, version, item, variant and link ids", async () => {
    const { recipe, draft } = await createLatte();
    signIn(OUTSIDER);
    const foreign = <T extends Json>(params: T) => ctx(params, otherTenantId);
    expect((await call(getRecipe(request("GET"), foreign({ recipePublicId: recipe })))).body.code).toBe("recipe_not_found");
    expect((await call(getRecipe(request("GET"), foreign({ recipePublicId: recipe })))).status).toBe(404);
    expect(
      (await call(patchVersion(request("PATCH", { expectedVersion: 1, notes: "x" }), foreign({ recipePublicId: recipe, versionPublicId: draft })))).status,
    ).toBe(404);
    expect(
      (await call(postLink(request("POST", { variantPublicId: fx.latte.regular, kind: "recipe", recipePublicId: recipe }), foreign({})))).body.code,
    ).toBe("variant_not_found");
    signIn(ADMIN);
    const ids = { recipePublicId: recipe, versionPublicId: draft };
    const foreignItem = await call(putLines(request("PUT", {
      expectedVersion: 1,
      lines: [{ itemPublicId: other.items.milk, quantity: "1", unitPublicId: fx.units.ml }],
    }), ctx(ids)));
    expect([foreignItem.status, foreignItem.body.code]).toEqual([404, "item_not_found"]);
    expect((await call(getVersion(request("GET"), ctx({ recipePublicId: recipe, versionPublicId: "recv_missing" })))).status).toBe(404);
    expect((await call(patchLink(request("PATCH", { operation: "end" }), ctx({ linkPublicId: "link_missing" })))).status).toBe(404);
    expect(
      (await call(preview(request("GET", undefined, `http://localhost/x?variantPublicId=${other.latte.regular}`), ctx({})))).status,
    ).toBe(404);
  });

  it("answers 409 for stale, duplicate, read-only, in-use and cyclic writes and 400 for invalid input", async () => {
    const { recipe, v1 } = await approvedLatte();
    signIn(ADMIN);
    const ids = { recipePublicId: recipe, versionPublicId: v1 };
    const readOnly = await call(putLines(request("PUT", { expectedVersion: 3, lines: [] }), ctx(ids)));
    expect([readOnly.status, readOnly.body.code]).toEqual([409, "version_not_draft"]);
    const draft = await call(postVersion(request("POST", { fromVersionPublicId: v1 }), ctx({ recipePublicId: recipe })));
    const second = await call(postVersion(request("POST", { fromVersionPublicId: v1 }), ctx({ recipePublicId: recipe })));
    expect([second.status, second.body.code]).toEqual([409, "draft_exists"]);
    const draftId = (draft.body as unknown as Detail).versions[0]!.publicId;
    const stale = await call(putSteps(request("PUT", { expectedVersion: 9, steps: [] }), ctx({ recipePublicId: recipe, versionPublicId: draftId })));
    expect([stale.status, stale.body.code]).toEqual([409, "expected_version_mismatch"]);
    const early = await call(approve(request("POST", { expectedVersion: 1, effectiveFrom: "2026-10-01" }), ctx({ recipePublicId: recipe, versionPublicId: draftId })));
    expect([early.status, early.body.code]).toEqual([409, "effective_from_before_current"]);

    await call(postLink(request("POST", { variantPublicId: fx.latte.regular, kind: "recipe", recipePublicId: recipe }), ctx({})));
    const duplicate = await call(postLink(request("POST", {
      variantPublicId: fx.latte.regular,
      kind: "direct_stock",
      itemPublicId: fx.items.milk,
      quantity: "250",
      unitPublicId: fx.units.ml,
    }), ctx({})));
    expect([duplicate.status, duplicate.body.code]).toEqual([409, "link_exists"]);
    const recipeVersion = ((await call(getRecipe(request("GET"), ctx({ recipePublicId: recipe })))).body as unknown as Detail).recipe.version;
    const inUse = await call(patchRecipe(request("PATCH", { expectedVersion: recipeVersion, status: "archived" }), ctx({ recipePublicId: recipe })));
    expect(inUse).toEqual({
      status: 409,
      body: expect.objectContaining({ code: "recipe_in_use", dependencies: [{ kind: "sellable_links", count: 1 }] }),
    });

    const syrup = await call(postRecipe(request("POST", { nameEn: "Syrup", kind: "prepared", outputItemPublicId: fx.items.syrup }), ctx({})));
    const syrupDetail = syrup.body as unknown as Detail;
    const cyclic = await call(putLines(request("PUT", {
      expectedVersion: 1,
      lines: [{ itemPublicId: fx.items.syrup, quantity: "1", unitPublicId: fx.units.ml }],
    }), ctx({ recipePublicId: syrupDetail.recipe.publicId, versionPublicId: syrupDetail.versions[0]!.publicId })));
    expect(cyclic.status).toBe(409);
    expect(cyclic.body).toMatchObject({ code: "recipe_cycle", detail: { path: [{ itemPublicId: fx.items.syrup }, { itemPublicId: fx.items.syrup }] } });

    const invalid = await call(postRecipe(request("POST", { nameEn: " ", kind: "sellable" }), ctx({})));
    expect([invalid.status, invalid.body.code, invalid.body.field]).toEqual([400, "name_required", "nameEn"]);
    const badQuantity = await call(preview(request("GET", undefined, `http://localhost/x?variantPublicId=${fx.latte.regular}&quantity=abc`), ctx({})));
    expect([badQuantity.status, badQuantity.body.code]).toEqual([400, "quantity_invalid"]);
    const prepared = await call(postLink(request("POST", { variantPublicId: fx.latte.large, kind: "recipe", recipePublicId: syrupDetail.recipe.publicId }), ctx({})));
    expect([prepared.status, prepared.body.code]).toEqual([400, "recipe_kind_not_sellable"]);
  });

  it("saves modifier effects and previews configurations with options, defaults and a sales channel through the routes", async () => {
    const NOW = new Date();
    const ef = await seedEffectFixtures(db, tenantId, fx, NOW);
    signIn(ADMIN);
    const ids = { recipePublicId: ef.recipePublicId, versionPublicId: ef.versionPublicId };
    const current = (await call(getRecipe(request("GET"), ctx({ recipePublicId: ef.recipePublicId })))).body as unknown as Detail;
    const version = current.versions[0]!.version;
    const effects = [
      { optionPublicId: ef.options.shot, effectType: "add", itemPublicId: fx.items.beans, unitPublicId: fx.units.g, quantity: "9" },
      { optionPublicId: ef.options.noMilk, effectType: "remove", targetLinePublicId: ef.milkLine },
    ];
    const stale = await call(putEffects(request("PUT", { expectedVersion: version + 1, effects }), ctx(ids)));
    expect([stale.status, stale.body.code]).toEqual([409, "expected_version_mismatch"]);
    const saved = await call(putEffects(request("PUT", { expectedVersion: version, effects }), ctx(ids)));
    expect(saved.status).toBe(200);
    const savedEffects = (saved.body as unknown as { versions: Array<{ effects: Array<{ effectType: string; option: { publicId: string } }> }> }).versions[0]!.effects;
    expect(savedEffects.map((effect) => [effect.option.publicId, effect.effectType])).toEqual([
      [ef.options.shot, "add"],
      [ef.options.noMilk, "remove"],
    ]);
    const invalid = await call(putEffects(request("PUT", { expectedVersion: version + 1, effects: [{ optionPublicId: ef.options.shot, effectType: "add" }] }), ctx(ids)));
    expect([invalid.status, invalid.body.code, invalid.body.field]).toEqual([400, "effect_item_required", "effects.0.itemPublicId"]);

    // Another business's administrator cannot reach this recipe; this business's ids are not found from theirs.
    signIn(OUTSIDER);
    expect((await call(putEffects(request("PUT", { expectedVersion: version + 1, effects: [] }), ctx(ids)))).status).toBe(403);
    expect((await call(putEffects(request("PUT", { expectedVersion: version + 1, effects: [] }), ctx(ids, otherTenantId)))).body.code).toBe("recipe_not_found");

    signIn(ADMIN);
    const detail = (await call(getRecipe(request("GET"), ctx({ recipePublicId: ef.recipePublicId })))).body as unknown as Detail;
    const approved = await call(approve(request("POST", { expectedVersion: detail.versions[0]!.version, effectiveFrom: "2026-11-01" }), ctx(ids)));
    expect(approved.status).toBe(200);
    const readOnly = await call(putEffects(request("PUT", { expectedVersion: (approved.body as unknown as Detail).versions[0]!.version, effects: [] }), ctx(ids)));
    expect([readOnly.status, readOnly.body.code]).toEqual([409, "version_not_draft"]);

    const url = (query: string) => `http://localhost/api/recipes/consumption-preview?variantPublicId=${fx.latte.regular}&date=2026-11-20&${query}`;
    signIn(USER);
    const withOptions = await call(preview(request("GET", undefined, url(`quantity=2&option=${ef.options.shot}:2&option=${ef.options.noMilk}`)), ctx({})));
    expect(withOptions.status).toBe(200);
    expect(withOptions.body).toMatchObject({ configurationStatus: "resolved", soldQuantity: 2, defaults: "auto" });
    const perItem = (withOptions.body.perItem as Array<{ item: { publicId: string }; perSale: { text: string }; total: { text: string } }>).map((entry) => [
      entry.item.publicId,
      entry.perSale.text,
      entry.total.text,
    ]);
    expect(perItem).toEqual([
      [fx.items.milk, "0.000", "0.000"],
      [fx.items.beans, "0.036", "0.072"],
    ]);
    // Without options the base usage is the QOS-198 answer.
    const plain = await call(preview(request("GET", undefined, url("defaults=none")), ctx({})));
    expect((plain.body.lines as Array<{ perSale: { text: string } }>).map((line) => line.perSale.text)).toEqual(["0.200", "0.018"]);
    expect(plain.body).toMatchObject({ status: "resolved", complete: true, defaults: "none", selections: [], rejections: [] });
    const repeated = await call(preview(request("GET", undefined, url(`option=${ef.options.shot}:4`)), ctx({})));
    expect((repeated.body.rejections as Array<{ code: string }>).map((entry) => entry.code)).toEqual(["option_quantity_exceeds_cap"]);
    const badOption = await call(preview(request("GET", undefined, url("option=a:b")), ctx({})));
    expect([badOption.status, badOption.body.code]).toEqual([400, "option_param_invalid"]);
    const badChannel = await call(preview(request("GET", undefined, url("channelPublicId=schan_missing")), ctx({})));
    expect([badChannel.status, badChannel.body.code]).toEqual([404, "channel_not_found"]);

    // A channel with no row inherits the central price; a channel row is used as the explicit price.
    const channel = await createSalesChannel(db, tenantId, ADMIN_MEMBERSHIP, ADMIN, { displayName: "Aggregator 1" });
    const inherited = await call(preview(request("GET", undefined, url(`channelPublicId=${channel.publicId}`)), ctx({})));
    expect(inherited.body.price).toMatchObject({ status: "available", base: "18.00", baseInheritance: "inherited", channel: { publicId: channel.publicId } });
    await setVariantChannelPrice(db, tenantId, ADMIN_MEMBERSHIP, ADMIN, fx.latte.productPublicId, fx.latte.regular, channel.publicId, { amountMinor: 2000, expectedVersion: null });
    const override = await call(preview(request("GET", undefined, url(`channelPublicId=${channel.publicId}`)), ctx({})));
    expect(override.body.price).toMatchObject({ status: "available", base: "20.00", baseInheritance: "override", total: "20.00" });
    // No tax basis is recorded on the variant: the margin says so and never borrows the checkout tax.
    expect(override.body.margin).toEqual({ status: "unavailable", reason: "missing_selling_tax_basis" });
  });
});
