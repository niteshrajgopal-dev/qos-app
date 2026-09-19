import { describe, expect, it } from "vitest";

import { QUOTES_HBZ_FINEDINE_IMPORT } from "@/lib/catalogue/finedine-hbz-constants";
import {
  buildFineDineCatalogueImportCsv,
  buildFineDineImageUrl,
  fineDinePriceToMinor,
  localizedFineDineText,
  parseFineDineFlatList,
} from "@/lib/catalogue/finedine-menu-extract";
import hbzFlatList from "../../../fixtures/finedine/quotes-hbz-stadium-flat-list.json";

describe("finedine menu extract", () => {
  const parsed = parseFineDineFlatList(
    hbzFlatList,
    QUOTES_HBZ_FINEDINE_IMPORT.menuId,
  );

  it("parses the HBZ Stadium fixture into 147 items and leaf sections", () => {
    expect(parsed.menuId).toBe("67484e5e5df4f98ece1ab9ce");
    expect(parsed.items).toHaveLength(147);
    expect(parsed.sections.length).toBeGreaterThan(0);
    expect(
      parsed.sections.every((section) => section.itemSourceIds.length > 0),
    ).toBe(true);

    const assignedItems = parsed.sections.flatMap(
      (section) => section.itemSourceIds,
    );
    expect(new Set(assignedItems).size).toBe(147);
  });

  it("maps FineDine major-unit prices to minor units", () => {
    expect(fineDinePriceToMinor(27)).toBe(2700);
    expect(fineDinePriceToMinor(38)).toBe(3800);
  });

  it("falls back to English when Arabic labels are missing", () => {
    expect(
      localizedFineDineText({ en: "Flatwhite", ar: "" }, "ar"),
    ).toBe("Flatwhite");
  });

  it("falls back to the first images[] entry when entity.image is missing", () => {
    const parsedWithGallery = parseFineDineFlatList(
      {
        menu: {
          _id: "menu-1",
          menuId: "menu-1",
          parentId: "",
          type: "section",
          name: { en: "Menu" },
        },
        section: {
          _id: "section-1",
          menuId: "menu-1",
          parentId: "menu-1",
          type: "section",
          name: { en: "Mains" },
          order: 0,
        },
        item: {
          _id: "item-1",
          menuId: "menu-1",
          parentId: "section-1",
          type: "item",
          name: { en: "Gallery Item", ar: "Gallery Item" },
          prices: [{ value: 12 }],
          images: [{ image: "gallery/example.jpg", order: 0 }],
        },
      },
      "menu-1",
    );

    expect(parsedWithGallery.items[0]?.imageUrl).toBe(
      buildFineDineImageUrl("gallery/example.jpg"),
    );
  });

  it("builds a catalogue-import CSV with stable FineDine source ids", () => {
    const csv = buildFineDineCatalogueImportCsv(parsed);
    const lines = csv.trim().split("\n");

    expect(lines[0]).toContain("source_id");
    expect(lines.length - 1).toBe(147);
    expect(csv).toContain("6a6f91adb40112c97850ae76");
    expect(csv).toContain("2700");
    expect(csv).toContain("New V60 Beans");
  });
});
