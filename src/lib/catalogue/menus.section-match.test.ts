import { describe, expect, it } from "vitest";

import { menuDraftSectionsMatch, type MenuSectionView } from "@/lib/catalogue/menus";
import type { MenuSectionInput } from "@/lib/catalogue/menus.validation";

const sectionView: MenuSectionView = {
  publicId: "sec_coffee",
  internalName: "coffee",
  sortOrder: 0,
  archived: false,
  translations: {
    en: { displayName: "Coffee", description: null, translationVersion: 1 },
    ar: { displayName: "قهوة", description: null, translationVersion: 1 },
  },
  products: [
    {
      productPublicId: "prd_latte",
      internalName: "latte",
      displayName: "Latte",
      sortOrder: 0,
      archived: false,
    },
  ],
};

describe("menuDraftSectionsMatch", () => {
  it("treats the menu editor sections payload as unchanged when only labels are trimmed", () => {
    const incoming: MenuSectionInput[] = [
      {
        publicId: "sec_coffee",
        internalName: "coffee",
        sortOrder: 0,
        archived: false,
        translations: {
          en: { displayName: "Coffee", description: null },
          ar: { displayName: "قهوة", description: null },
        },
        products: [{ productPublicId: "prd_latte", sortOrder: 0, archived: false }],
      },
    ];
    expect(menuDraftSectionsMatch([sectionView], incoming)).toBe(true);
  });
});
