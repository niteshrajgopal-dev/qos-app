export type QuotesLocationFixture = {
  publicId: string;
  name: string;
  slug: string;
  timezone: string;
  externalMenuId: string;
  sourceUrl: string;
};

export const quotesLocationFixtures: QuotesLocationFixture[] = [
  {
    publicId: "loc_quotes_hbz",
    name: "HBZ Stadium",
    slug: "hbz-stadium",
    timezone: "Asia/Dubai",
    externalMenuId: "67484e5e5df4f98ece1ab9ce",
    sourceUrl:
      "https://qr.finedinemenu.com/MawZBMZR_/menu/67484e5e5df4f98ece1ab9ce",
  },
  {
    publicId: "loc_quotes_hct",
    name: "HCT Academic City",
    slug: "hct-academic-city",
    timezone: "Asia/Dubai",
    externalMenuId: "6a8bc60f1f68af6caa145e1a",
    sourceUrl:
      "https://qr.finedinemenu.com/MawZBMZR_/menu/6a8bc60f1f68af6caa145e1a",
  },
  {
    publicId: "loc_quotes_al_ain_zoo",
    name: "Al Ain Zoo",
    slug: "al-ain-zoo",
    timezone: "Asia/Dubai",
    externalMenuId: "6a964bc62c6dddd8bd3c2fa7",
    sourceUrl:
      "https://qr.finedinemenu.com/MawZBMZR_/menu/6a964bc62c6dddd8bd3c2fa7",
  },
];
