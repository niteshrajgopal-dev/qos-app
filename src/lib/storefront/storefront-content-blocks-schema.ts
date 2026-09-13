export const STOREFRONT_CONTENT_BLOCK_SCHEMA_VERSION = 1;

export const STOREFRONT_CONTENT_BLOCK_TYPES = [
  "hero",
  "featured_items",
  "category_collection",
  "brand_story",
  "locations",
  "faq",
  "contact",
  "footer",
] as const;

export type StorefrontContentBlockType =
  (typeof STOREFRONT_CONTENT_BLOCK_TYPES)[number];

export type StorefrontLocalizedCopy = {
  en: string;
  ar: string;
};

export type StorefrontContentBlockDraft = {
  id: string;
  type: StorefrontContentBlockType;
  schemaVersion: typeof STOREFRONT_CONTENT_BLOCK_SCHEMA_VERSION;
  visible: boolean;
  props: Record<string, unknown>;
};

export class StorefrontContentBlockValidationError extends Error {
  readonly field?: string;
  readonly issues: Array<{ field: string; message: string }>;

  constructor(
    message: string,
    field?: string,
    issues: Array<{ field: string; message: string }> = [],
  ) {
    super(message);
    this.name = "StorefrontContentBlockValidationError";
    this.field = field;
    this.issues = issues.length > 0 ? issues : field ? [{ field, message }] : [];
  }
}

const BLOCK_ID_PATTERN = /^[a-z][a-z0-9_-]{2,63}$/;
const PUBLIC_DERIVATIVE_ID_PATTERN = /^mda_[a-z0-9_]+$/;
const PRODUCT_PUBLIC_ID_PATTERN = /^prd_[a-z0-9_]+$/;
const MENU_PUBLIC_ID_PATTERN = /^mnu_[a-z0-9_]+$/;
const SAFE_LINK_PATTERN = /^(\/[a-z0-9/_-]*)|(https:\/\/[a-z0-9.-]+(?:\/[^\s]*)?)$/i;
const UNSAFE_COPY_PATTERN = /(<script|javascript:|on[a-z]+\s*=|<iframe)/i;

const MAX_SHORT_COPY = 160;
const MAX_MEDIUM_COPY = 500;
const MAX_LONG_COPY = 2000;
const MAX_FAQ_ITEMS = 12;
const MAX_FEATURED_PRODUCTS = 12;

const ALLOWED_BLOCK_KEYS = new Set([
  "id",
  "type",
  "schemaVersion",
  "visible",
  "props",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pushIssue(
  issues: Array<{ field: string; message: string }>,
  field: string,
  message: string,
) {
  issues.push({ field, message });
}

function readLocalizedCopy(
  value: unknown,
  field: string,
  maxLength: number,
  issues: Array<{ field: string; message: string }>,
  requireArabic: boolean,
): StorefrontLocalizedCopy | null {
  if (!isRecord(value)) {
    pushIssue(issues, field, "Localized copy must include English and Arabic text.");
    return null;
  }

  const en = typeof value.en === "string" ? value.en.trim() : "";
  const ar = typeof value.ar === "string" ? value.ar.trim() : "";

  if (!en) {
    pushIssue(issues, `${field}.en`, "English copy is required.");
  } else if (en.length > maxLength) {
    pushIssue(
      issues,
      `${field}.en`,
      `English copy must be ${maxLength} characters or fewer.`,
    );
  } else if (UNSAFE_COPY_PATTERN.test(en)) {
    pushIssue(issues, `${field}.en`, "English copy contains unsupported markup.");
  }

  if (requireArabic && !ar) {
    pushIssue(issues, `${field}.ar`, "Arabic copy is required.");
  } else if (ar.length > maxLength) {
    pushIssue(
      issues,
      `${field}.ar`,
      `Arabic copy must be ${maxLength} characters or fewer.`,
    );
  } else if (ar && UNSAFE_COPY_PATTERN.test(ar)) {
    pushIssue(issues, `${field}.ar`, "Arabic copy contains unsupported markup.");
  }

  if (!en && (requireArabic ? !ar : true)) {
    return null;
  }

  return { en, ar };
}

function readOptionalMediaId(
  value: unknown,
  field: string,
  issues: Array<{ field: string; message: string }>,
) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (
    typeof value !== "string" ||
    !PUBLIC_DERIVATIVE_ID_PATTERN.test(value.trim())
  ) {
    pushIssue(
      issues,
      field,
      "Media reference must be an approved public derivative ID.",
    );
    return undefined;
  }

  return value.trim();
}

function readSafeLink(
  value: unknown,
  field: string,
  issues: Array<{ field: string; message: string }>,
) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string" || !SAFE_LINK_PATTERN.test(value.trim())) {
    pushIssue(
      issues,
      field,
      "Links must be relative paths or https URLs.",
    );
    return undefined;
  }

  return value.trim();
}

function validateBlockProps(
  block: StorefrontContentBlockDraft,
  requireArabic: boolean,
  issues: Array<{ field: string; message: string }>,
) {
  const prefix = `contentBlocks.${block.id}.props`;

  switch (block.type) {
    case "hero": {
      readLocalizedCopy(
        block.props.title,
        `${prefix}.title`,
        MAX_SHORT_COPY,
        issues,
        requireArabic,
      );
      readLocalizedCopy(
        block.props.subtitle,
        `${prefix}.subtitle`,
        MAX_MEDIUM_COPY,
        issues,
        requireArabic,
      );
      readOptionalMediaId(block.props.imagePublicDerivativeId, `${prefix}.imagePublicDerivativeId`, issues);
      readSafeLink(block.props.ctaHref, `${prefix}.ctaHref`, issues);
      break;
    }
    case "featured_items": {
      readLocalizedCopy(
        block.props.title,
        `${prefix}.title`,
        MAX_SHORT_COPY,
        issues,
        requireArabic,
      );

      if (!Array.isArray(block.props.productPublicIds)) {
        pushIssue(
          issues,
          `${prefix}.productPublicIds`,
          "Featured items must reference product IDs.",
        );
      } else {
        if (block.props.productPublicIds.length === 0) {
          pushIssue(
            issues,
            `${prefix}.productPublicIds`,
            "At least one featured product is required.",
          );
        }

        if (block.props.productPublicIds.length > MAX_FEATURED_PRODUCTS) {
          pushIssue(
            issues,
            `${prefix}.productPublicIds`,
            `Featured items supports at most ${MAX_FEATURED_PRODUCTS} products.`,
          );
        }

        block.props.productPublicIds.forEach((value, index) => {
          if (
            typeof value !== "string" ||
            !PRODUCT_PUBLIC_ID_PATTERN.test(value)
          ) {
            pushIssue(
              issues,
              `${prefix}.productPublicIds[${index}]`,
              "Featured product ID must reference a tenant product.",
            );
          }
        });

        if ("price" in block.props || "amountMinor" in block.props) {
          pushIssue(
            issues,
            prefix,
            "Featured items cannot store independent pricing.",
          );
        }
      }
      break;
    }
    case "category_collection": {
      readLocalizedCopy(
        block.props.title,
        `${prefix}.title`,
        MAX_SHORT_COPY,
        issues,
        requireArabic,
      );

      const menuPublicId = block.props.menuPublicId;
      if (
        typeof menuPublicId !== "string" ||
        !MENU_PUBLIC_ID_PATTERN.test(menuPublicId)
      ) {
        pushIssue(
          issues,
          `${prefix}.menuPublicId`,
          "Category collection must reference a tenant menu.",
        );
      }
      break;
    }
    case "brand_story": {
      readLocalizedCopy(
        block.props.title,
        `${prefix}.title`,
        MAX_SHORT_COPY,
        issues,
        requireArabic,
      );
      readLocalizedCopy(
        block.props.body,
        `${prefix}.body`,
        MAX_LONG_COPY,
        issues,
        requireArabic,
      );
      readOptionalMediaId(block.props.imagePublicDerivativeId, `${prefix}.imagePublicDerivativeId`, issues);
      break;
    }
    case "locations": {
      readLocalizedCopy(
        block.props.title,
        `${prefix}.title`,
        MAX_SHORT_COPY,
        issues,
        requireArabic,
      );
      break;
    }
    case "faq": {
      readLocalizedCopy(
        block.props.title,
        `${prefix}.title`,
        MAX_SHORT_COPY,
        issues,
        requireArabic,
      );

      if (!Array.isArray(block.props.items)) {
        pushIssue(issues, `${prefix}.items`, "FAQ items are required.");
        break;
      }

      if (block.props.items.length === 0) {
        pushIssue(issues, `${prefix}.items`, "At least one FAQ item is required.");
      }

      if (block.props.items.length > MAX_FAQ_ITEMS) {
        pushIssue(
          issues,
          `${prefix}.items`,
          `FAQ supports at most ${MAX_FAQ_ITEMS} items.`,
        );
      }

      block.props.items.forEach((item, index) => {
        if (!isRecord(item)) {
          pushIssue(
            issues,
            `${prefix}.items[${index}]`,
            "FAQ item must be an object.",
          );
          return;
        }

        readLocalizedCopy(
          item.question,
          `${prefix}.items[${index}].question`,
          MAX_MEDIUM_COPY,
          issues,
          requireArabic,
        );
        readLocalizedCopy(
          item.answer,
          `${prefix}.items[${index}].answer`,
          MAX_LONG_COPY,
          issues,
          requireArabic,
        );
      });
      break;
    }
    case "contact": {
      readLocalizedCopy(
        block.props.title,
        `${prefix}.title`,
        MAX_SHORT_COPY,
        issues,
        requireArabic,
      );
      readSafeLink(block.props.contactHref, `${prefix}.contactHref`, issues);
      break;
    }
    case "footer": {
      readLocalizedCopy(
        block.props.statement,
        `${prefix}.statement`,
        MAX_MEDIUM_COPY,
        issues,
        requireArabic,
      );
      break;
    }
    default:
      pushIssue(
        issues,
        `contentBlocks.${block.id}.type`,
        "Unsupported content block type.",
      );
  }
}

function validateSingleBlock(
  value: unknown,
  index: number,
  requireArabic: boolean,
  seenIds: Set<string>,
  issues: Array<{ field: string; message: string }>,
): StorefrontContentBlockDraft | null {
  const fieldPrefix = `contentBlocks[${index}]`;

  if (!isRecord(value)) {
    pushIssue(issues, fieldPrefix, "Content block must be an object.");
    return null;
  }

  for (const key of Object.keys(value)) {
    if (!ALLOWED_BLOCK_KEYS.has(key)) {
      pushIssue(
        issues,
        `${fieldPrefix}.${key}`,
        "Unknown content block field is not allowed.",
      );
    }
  }

  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!BLOCK_ID_PATTERN.test(id)) {
    pushIssue(
      issues,
      `${fieldPrefix}.id`,
      "Block ID must be 3-64 lowercase characters.",
    );
  } else if (seenIds.has(id)) {
    pushIssue(issues, `${fieldPrefix}.id`, "Block IDs must be unique.");
  } else {
    seenIds.add(id);
  }

  const type = value.type;
  if (
    typeof type !== "string" ||
    !STOREFRONT_CONTENT_BLOCK_TYPES.includes(type as StorefrontContentBlockType)
  ) {
    pushIssue(
      issues,
      `${fieldPrefix}.type`,
      "Content block type must be a supported baseline block.",
    );
  }

  const schemaVersion =
    value.schemaVersion ?? STOREFRONT_CONTENT_BLOCK_SCHEMA_VERSION;
  if (
    schemaVersion !== STOREFRONT_CONTENT_BLOCK_SCHEMA_VERSION ||
    !Number.isInteger(schemaVersion)
  ) {
    pushIssue(
      issues,
      `${fieldPrefix}.schemaVersion`,
      `Unsupported content block schema version ${String(schemaVersion)}.`,
    );
  }

  if (typeof value.visible !== "boolean") {
    pushIssue(issues, `${fieldPrefix}.visible`, "Block visibility must be true or false.");
  }

  if (!isRecord(value.props)) {
    pushIssue(issues, `${fieldPrefix}.props`, "Block props must be an object.");
    return null;
  }

  const block: StorefrontContentBlockDraft = {
    id,
    type: type as StorefrontContentBlockType,
    schemaVersion: STOREFRONT_CONTENT_BLOCK_SCHEMA_VERSION,
    visible: value.visible as boolean,
    props: value.props,
  };

  validateBlockProps(block, requireArabic, issues);
  return block;
}

export function validateStorefrontContentBlocksInput(
  input: unknown,
  options: { supportedLocales: string[] },
): StorefrontContentBlockDraft[] {
  if (!Array.isArray(input)) {
    throw new StorefrontContentBlockValidationError(
      "Content blocks must be an array.",
      "contentBlocks",
    );
  }

  const requireArabic = options.supportedLocales.includes("ar");
  const issues: Array<{ field: string; message: string }> = [];
  const seenIds = new Set<string>();
  const blocks: StorefrontContentBlockDraft[] = [];

  input.forEach((block, index) => {
    const validated = validateSingleBlock(
      block,
      index,
      requireArabic,
      seenIds,
      issues,
    );
    if (validated) {
      blocks.push(validated);
    }
  });

  if (issues.length > 0) {
    throw new StorefrontContentBlockValidationError(
      "Content block validation failed.",
      issues[0]?.field,
      issues,
    );
  }

  return blocks;
}

export function storefrontContentBlocksToDraftConfig(
  blocks: StorefrontContentBlockDraft[],
) {
  return blocks.map((block) => ({
    id: block.id,
    type: block.type,
    schemaVersion: block.schemaVersion,
    visible: block.visible,
    props: block.props,
  }));
}

export function normalizePersistedContentBlocks(
  value: StorefrontDraftConfigContentBlocks | undefined,
  supportedLocales: string[],
): StorefrontContentBlockDraft[] {
  if (!value || value.length === 0) {
    return [];
  }

  try {
    return validateStorefrontContentBlocksInput(value, { supportedLocales });
  } catch {
    return [];
  }
}

type StorefrontDraftConfigContentBlocks = Array<{
  id: string;
  type: string;
  props: Record<string, unknown>;
  schemaVersion?: number;
  visible?: boolean;
}>;

export function legacyHeroBlockToDraftBlocks(
  blocks: StorefrontDraftConfigContentBlocks,
  supportedLocales: string[],
): StorefrontContentBlockDraft[] {
  const requireArabic = supportedLocales.includes("ar");

  return blocks.map((block) => {
    const props = normalizeLegacyHeroProps(block.props);
    const draftBlock: StorefrontContentBlockDraft = {
      id: block.id,
      type: (STOREFRONT_CONTENT_BLOCK_TYPES.includes(
        block.type as StorefrontContentBlockType,
      )
        ? block.type
        : "hero") as StorefrontContentBlockType,
      schemaVersion: STOREFRONT_CONTENT_BLOCK_SCHEMA_VERSION,
      visible: block.visible ?? true,
      props,
    };

    if (block.type === "hero") {
      return draftBlock;
    }

    const issues: Array<{ field: string; message: string }> = [];
    validateBlockProps(draftBlock, requireArabic, issues);
    return draftBlock;
  });
}

function normalizeLegacyHeroProps(props: Record<string, unknown>) {
  if (isRecord(props.title) || isRecord(props.subtitle)) {
    return props;
  }

  const titleKey =
    typeof props.titleKey === "string" ? props.titleKey : "home.hero.title";
  const subtitleKey =
    typeof props.subtitleKey === "string"
      ? props.subtitleKey
      : "home.hero.subtitle";

  return {
    ...props,
    title: props.title ?? {
      en: titleKey,
      ar: titleKey,
    },
    subtitle: props.subtitle ?? {
      en: subtitleKey,
      ar: subtitleKey,
    },
  };
}
