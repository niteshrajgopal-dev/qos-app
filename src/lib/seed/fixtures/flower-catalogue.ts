export type FlowerVariantFixture = {
  publicId: string;
  sortOrder: number;
  isDefault: boolean;
  amountMinor: number;
  translations: Record<string, string>;
};

export type FlowerModifierOptionFixture = {
  publicId: string;
  sortOrder: number;
  priceMinor: number;
  translations: Record<string, string>;
};

export const flowerRoseBouquetFixture = {
  productPublicId: "prd_flowers_rose_bouquet",
  internalName: "rose-bouquet",
  translations: {
    en: {
      displayName: "Classic Rose Bouquet",
      description:
        "Synthetic bouquet fixture for Phase 1 retail portability testing.",
    },
    ar: {
      displayName: "باقة ورد كلاسيكية",
      description: "بيانات تجريبية اصطناعية — ليست أسعار قائمة حية.",
    },
  },
  variants: [
    {
      publicId: "var_flowers_rose_small",
      sortOrder: 0,
      isDefault: true,
      amountMinor: 15000,
      translations: { en: "Small", ar: "صغير" },
    },
    {
      publicId: "var_flowers_rose_medium",
      sortOrder: 1,
      isDefault: false,
      amountMinor: 20000,
      translations: { en: "Medium", ar: "متوسط" },
    },
    {
      publicId: "var_flowers_rose_large",
      sortOrder: 2,
      isDefault: false,
      amountMinor: 25000,
      translations: { en: "Large", ar: "كبير" },
    },
  ] satisfies FlowerVariantFixture[],
  modifierGroup: {
    publicId: "modgrp_flowers_gift_wrapping",
    internalName: "gift-wrapping",
    minSelections: 0,
    maxSelections: 1,
    translations: {
      en: "Gift Wrapping",
      ar: "تغليف هدايا",
    },
    options: [
      {
        publicId: "modopt_flowers_wrap_standard",
        sortOrder: 0,
        priceMinor: 0,
        translations: { en: "Standard", ar: "قياسي" },
      },
      {
        publicId: "modopt_flowers_wrap_premium",
        sortOrder: 1,
        priceMinor: 2500,
        translations: { en: "Premium", ar: "فاخر" },
      },
    ] satisfies FlowerModifierOptionFixture[],
  },
};
