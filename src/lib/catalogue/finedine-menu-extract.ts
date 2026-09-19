import { readFile } from "node:fs/promises";
import path from "node:path";

export type FineDineLocalizedText = {
  en?: string | null;
  ar?: string | null;
  [locale: string]: string | null | undefined;
};

export type FineDineFlatEntity = {
  _id: string;
  name: FineDineLocalizedText;
  description?: FineDineLocalizedText;
  note?: FineDineLocalizedText;
  menuId: string;
  parentId: string;
  type: "section" | "item" | string;
  order?: number;
  index?: number;
  path?: string;
  image?: string | null;
  images?: Array<{ image: string; order: number }>;
  published?: boolean;
  prices?: Array<{
    value: number;
    baseValue?: number | null;
    definition?: FineDineLocalizedText;
    currencies?: unknown[];
  }>;
  properties?: string[];
  ingredientWarnings?: string[];
  customProperties?: unknown[];
  customIngredients?: unknown[];
  soldout?: boolean;
  highlighted?: boolean;
  is_available?: boolean;
  available_ttl?: number;
};

export type FineDineCatalogueImportRow = {
  sourceId: string;
  internalName: string;
  displayNameEn: string;
  displayNameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  amountMinor: number;
  currency: string;
  categoryPath: string;
  categorySectionId: string;
  imageUrl: string | null;
  published: boolean;
  isAvailable: boolean;
  soldOut: boolean;
  properties: string;
};

export type ParsedFineDineMenu = {
  menuId: string;
  sections: Array<{
    sourceId: string;
    internalName: string;
    displayNameEn: string;
    displayNameAr: string;
    sortOrder: number;
    categoryPath: string;
    itemSourceIds: string[];
  }>;
  items: FineDineCatalogueImportRow[];
};

const FINEDINE_API_ORIGIN = "https://api.finedinemenu.com";
const FINEDINE_QR_ORIGIN = "https://qr.finedinemenu.com";
const FINEDINE_MEDIA_ORIGIN = "https://media.finedinemenu.com";

export function slugifyFineDineInternalName(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "item"
  );
}

export function localizedFineDineText(
  field: FineDineLocalizedText | null | undefined,
  locale: "en" | "ar",
  fallback = "",
) {
  const localized = field?.[locale]?.trim();
  if (localized) {
    return localized;
  }

  if (locale === "ar") {
    const english = field?.en?.trim();
    if (english) {
      return english;
    }
  }

  return fallback;
}

export function normalizeFineDineFlatList(
  raw: Record<string, FineDineFlatEntity> | FineDineFlatEntity[],
): FineDineFlatEntity[] {
  if (Array.isArray(raw)) {
    return raw;
  }

  return Object.values(raw);
}

export function fineDinePriceToMinor(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid FineDine price value: ${value}`);
  }

  return Math.round(value * 100);
}

export function buildFineDineImageUrl(imagePath: string | null | undefined) {
  if (!imagePath?.trim()) {
    return null;
  }

  return `${FINEDINE_MEDIA_ORIGIN}/${imagePath.replace(/^\//, "")}`;
}

export function parseFineDineFlatList(
  raw: Record<string, FineDineFlatEntity> | FineDineFlatEntity[],
  menuId: string,
): ParsedFineDineMenu {
  const entities = normalizeFineDineFlatList(raw);
  const byId = new Map(entities.map((entity) => [entity._id, entity]));

  function sectionPath(sectionId: string) {
    const parts: string[] = [];
    let current = byId.get(sectionId);

    while (current && current._id !== menuId) {
      parts.unshift(localizedFineDineText(current.name, "en", "Untitled"));
      current = byId.get(current.parentId);
    }

    return parts.join(" / ");
  }

  const sections = entities
    .filter((entity) => entity.type === "section")
    .map((section) => {
      const itemSourceIds = entities
        .filter(
          (entity) =>
            entity.type === "item" && entity.parentId === section._id,
        )
        .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
        .map((entity) => entity._id);

      return {
        sourceId: section._id,
        internalName: slugifyFineDineInternalName(
          localizedFineDineText(section.name, "en", section._id),
        ),
        displayNameEn: localizedFineDineText(section.name, "en", section._id),
        displayNameAr: localizedFineDineText(section.name, "ar", section._id),
        sortOrder: section.order ?? 0,
        categoryPath: sectionPath(section._id),
        itemSourceIds,
      };
    })
    .filter((section) => section.itemSourceIds.length > 0)
    .sort((left, right) => left.sortOrder - right.sortOrder);

  const sectionByItemId = new Map<string, (typeof sections)[number]>();
  for (const section of sections) {
    for (const itemSourceId of section.itemSourceIds) {
      sectionByItemId.set(itemSourceId, section);
    }
  }

  const items = entities
    .filter((entity) => entity.type === "item")
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
    .map((entity) => {
      const section = sectionByItemId.get(entity._id);
      const displayNameEn = localizedFineDineText(entity.name, "en", entity._id);
      const price = entity.prices?.[0];

      if (!price || !Number.isFinite(price.value)) {
        throw new Error(
          `FineDine item ${entity._id} (${displayNameEn}) is missing a price.`,
        );
      }

      return {
        sourceId: entity._id,
        internalName: slugifyFineDineInternalName(displayNameEn),
        displayNameEn,
        displayNameAr: localizedFineDineText(entity.name, "ar", displayNameEn),
        descriptionEn: localizedFineDineText(entity.description, "en"),
        descriptionAr: localizedFineDineText(entity.description, "ar"),
        amountMinor: fineDinePriceToMinor(price.value),
        currency: "AED",
        categoryPath: section?.categoryPath ?? "",
        categorySectionId: section?.sourceId ?? "",
        imageUrl: buildFineDineImageUrl(
          entity.image ?? entity.images?.[0]?.image ?? null,
        ),
        published: entity.published ?? true,
        isAvailable: entity.is_available !== false && entity.soldout !== true,
        soldOut: entity.soldout === true,
        properties: (entity.properties ?? []).join("|"),
      };
    });

  return {
    menuId,
    sections,
    items,
  };
}

function escapeCsvCell(value: string) {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

export function buildFineDineCatalogueImportCsv(parsed: ParsedFineDineMenu) {
  const headers = [
    "source_id",
    "internal_name",
    "display_name_en",
    "display_name_ar",
    "description_en",
    "description_ar",
    "amount_minor",
    "currency",
    "category_path",
    "category_section_id",
    "image_url",
    "published",
    "is_available",
    "sold_out",
    "properties",
  ];

  const lines = [headers.join(",")];

  for (const row of parsed.items) {
    lines.push(
      [
        row.sourceId,
        row.internalName,
        row.displayNameEn,
        row.displayNameAr,
        row.descriptionEn,
        row.descriptionAr,
        String(row.amountMinor),
        row.currency,
        row.categoryPath,
        row.categorySectionId,
        row.imageUrl ?? "",
        row.published ? "true" : "false",
        row.isAvailable ? "true" : "false",
        row.soldOut ? "true" : "false",
        row.properties,
      ]
        .map((value) => escapeCsvCell(value))
        .join(","),
    );
  }

  return `${lines.join("\n")}\n`;
}

export async function authenticateFineDinePublicMenu(input: {
  slug: string;
  visitorId?: string;
}) {
  const response = await fetch(`${FINEDINE_API_ORIGIN}/v2/mobile-menu/auth`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: FINEDINE_QR_ORIGIN,
      referer: `${FINEDINE_QR_ORIGIN}/`,
    },
    body: JSON.stringify({
      slug: input.slug,
      visitor_id: input.visitorId ?? "qos-catalogue-import",
    }),
  });

  if (!response.ok) {
    throw new Error(
      `FineDine auth failed with HTTP ${response.status}: ${await response.text()}`,
    );
  }

  const payload = (await response.json()) as { token?: string };
  if (!payload.token) {
    throw new Error("FineDine auth response did not include a token.");
  }

  return payload.token;
}

export async function fetchFineDineFlatList(input: {
  menuId: string;
  token: string;
}) {
  const response = await fetch(
    `${FINEDINE_API_ORIGIN}/v1/entities/${input.menuId}/flat-list`,
    {
      headers: {
        authorization: `Bearer ${input.token}`,
        origin: FINEDINE_QR_ORIGIN,
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `FineDine flat-list failed with HTTP ${response.status}: ${await response.text()}`,
    );
  }

  return (await response.json()) as Record<string, FineDineFlatEntity>;
}

export async function loadFineDineFlatListFixture(relativePath: string) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const raw = await readFile(absolutePath, "utf8");
  return JSON.parse(raw) as Record<string, FineDineFlatEntity>;
}

export async function fetchFineDinePublicMenuFlatList(input: {
  slug: string;
  menuId: string;
  visitorId?: string;
}) {
  const token = await authenticateFineDinePublicMenu({
    slug: input.slug,
    visitorId: input.visitorId,
  });

  return fetchFineDineFlatList({
    menuId: input.menuId,
    token,
  });
}
