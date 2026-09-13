import { CatalogueValidationError } from "@/lib/catalogue/validation";

export type ModifierOptionRules = {
  publicId: string;
  status: "active" | "archived";
  isDefault: boolean;
  allowsQuantity: boolean;
  maxQuantity: number;
  priceMinor: number;
};

export type ModifierGroupRules = {
  publicId: string;
  minSelections: number;
  maxSelections: number;
  options: ModifierOptionRules[];
};

export type ModifierSelectionInput = {
  optionPublicId: string;
  quantity: number;
};

export type ValidatedModifierSelection = {
  optionPublicId: string;
  quantity: number;
  priceMinor: number;
};

export type ModifierSelectionValidationResult = {
  selections: ValidatedModifierSelection[];
  totalPriceMinor: number;
  appliedDefaults: boolean;
};

function activeOptions(group: ModifierGroupRules) {
  return group.options.filter((option) => option.status === "active");
}

export function resolveDefaultSelections(
  group: ModifierGroupRules,
): ModifierSelectionInput[] {
  return activeOptions(group)
    .filter((option) => option.isDefault)
    .map((option) => ({
      optionPublicId: option.publicId,
      quantity: 1,
    }));
}

export function assertModifierDefaultsAreFeasible(group: ModifierGroupRules) {
  if (group.minSelections > group.maxSelections) {
    throw new CatalogueValidationError(
      "minSelections cannot exceed maxSelections.",
      "minSelections",
    );
  }

  const defaults = resolveDefaultSelections(group);
  const defaultCount = defaults.length;

  if (defaultCount > group.maxSelections) {
    throw new CatalogueValidationError(
      "Default option count exceeds maxSelections.",
      "options",
    );
  }

  if (group.minSelections > 0 && defaultCount < group.minSelections) {
    const activeCount = activeOptions(group).length;
    if (activeCount < group.minSelections) {
      throw new CatalogueValidationError(
        "Active options are insufficient to satisfy minSelections.",
        "options",
      );
    }
  }
}

export function validateModifierGroupSelections(
  group: ModifierGroupRules,
  rawSelections: ModifierSelectionInput[],
  options?: { applyDefaults?: boolean },
): ModifierSelectionValidationResult {
  assertModifierDefaultsAreFeasible(group);

  let selections = rawSelections;
  let appliedDefaults = false;

  if (selections.length === 0 && options?.applyDefaults) {
    selections = resolveDefaultSelections(group);
    appliedDefaults = selections.length > 0;
  }

  const activeByPublicId = new Map(
    activeOptions(group).map((option) => [option.publicId, option]),
  );

  const normalized: ValidatedModifierSelection[] = [];
  const seen = new Set<string>();

  for (const [index, selection] of selections.entries()) {
    const fieldPrefix = `selections[${index}]`;
    const optionPublicId = selection.optionPublicId?.trim();

    if (!optionPublicId) {
      throw new CatalogueValidationError(
        "optionPublicId is required.",
        `${fieldPrefix}.optionPublicId`,
      );
    }

    if (seen.has(optionPublicId)) {
      throw new CatalogueValidationError(
        "Duplicate option selections are not allowed.",
        `${fieldPrefix}.optionPublicId`,
      );
    }

    seen.add(optionPublicId);

    const option = activeByPublicId.get(optionPublicId);
    if (!option) {
      throw new CatalogueValidationError(
        "Modifier option is not available for this group.",
        `${fieldPrefix}.optionPublicId`,
      );
    }

    if (!Number.isInteger(selection.quantity) || selection.quantity < 1) {
      throw new CatalogueValidationError(
        "quantity must be a positive integer.",
        `${fieldPrefix}.quantity`,
      );
    }

    if (!option.allowsQuantity && selection.quantity !== 1) {
      throw new CatalogueValidationError(
        "This modifier option does not allow quantity greater than one.",
        `${fieldPrefix}.quantity`,
      );
    }

    if (selection.quantity > option.maxQuantity) {
      throw new CatalogueValidationError(
        "quantity exceeds the configured maximum for this option.",
        `${fieldPrefix}.quantity`,
      );
    }

    normalized.push({
      optionPublicId,
      quantity: selection.quantity,
      priceMinor: option.priceMinor,
    });
  }

  const selectionCount = normalized.length;

  if (selectionCount < group.minSelections) {
    throw new CatalogueValidationError(
      `At least ${group.minSelections} selection(s) are required for this modifier group.`,
      "selections",
    );
  }

  if (selectionCount > group.maxSelections) {
    throw new CatalogueValidationError(
      `No more than ${group.maxSelections} selection(s) are allowed for this modifier group.`,
      "selections",
    );
  }

  const totalPriceMinor = normalized.reduce(
    (sum, selection) => sum + selection.priceMinor * selection.quantity,
    0,
  );

  return {
    selections: normalized,
    totalPriceMinor,
    appliedDefaults,
  };
}

export function calculateModifierPriceDelta(
  group: ModifierGroupRules,
  selections: ModifierSelectionInput[],
  options?: { applyDefaults?: boolean },
) {
  return validateModifierGroupSelections(group, selections, options)
    .totalPriceMinor;
}
