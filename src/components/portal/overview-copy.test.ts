import { describe, expect, it } from "vitest";

import {
  overviewActivityTime,
  overviewCopy,
  overviewCount,
  overviewCurrencyLabel,
  overviewDateLine,
  overviewGreeting,
  overviewLocationStatus,
  type OverviewCopyKey,
} from "@/components/portal/overview-copy";

const KEYS: OverviewCopyKey[] = [
  "heroTitleLead",
  "heroTitleEmphasis",
  "heroDescriptionLead",
  "manageOrders",
  "viewPerformance",
  "businessPulse",
  "paymentsCaptured",
  "revenueToday",
  "paymentsToday",
  "locationsActive",
  "menusLive",
  "captionLead",
  "dockOrdersLine",
  "dockStoreTitle",
  "liveBusinessData",
  "motionOn",
  "bigPicture",
  "everythingConnected",
  "recentActivity",
  "acrossLocations",
  "readyWhenYouAre",
  "freshMenuLead",
  "freshMenuTail",
  "allMenusPublished",
  "openMenus",
];

describe("overview copy", () => {
  it("has Arabic for every Overview string the QA pass found in English", () => {
    for (const key of KEYS) {
      const ar = overviewCopy("ar", key);
      expect(ar, key).toMatch(/[\u0600-\u06FF]/);
      expect(ar, key).not.toBe(overviewCopy("en", key));
    }
  });

  it("uses sentence case rather than all caps", () => {
    for (const key of ["businessPulse", "bigPicture", "readyWhenYouAre", "captionLead", "liveBusinessData"] as const) {
      const en = overviewCopy("en", key);
      expect(en, key).not.toBe(en.toUpperCase());
    }
  });

  it("keeps the full stop at the end of Arabic sentences, after an English name", () => {
    expect(overviewGreeting("ar", 9, "Staff Demo")).toBe("صباح الخير، Staff Demo.");
    expect(overviewGreeting("ar", 20, "Staff Demo")).toBe("مساء الخير، Staff Demo.");
    expect(overviewGreeting("en", 14, "Staff Demo")).toBe("Good afternoon, Staff Demo.");
    expect(overviewCopy("ar", "heroTitleLead").endsWith(".")).toBe(true);
    expect(overviewCopy("ar", "heroTitleLead").startsWith(".")).toBe(false);
  });

  it("chooses Arabic plural forms by count", () => {
    expect(overviewCount("ar", "menusNotLive", 1)).toBe("قائمة واحدة لم تُنشر بعد");
    expect(overviewCount("ar", "menusNotLive", 2)).toBe("قائمتان لم تُنشرا بعد");
    expect(overviewCount("ar", "menusNotLive", 3)).toBe("3 قوائم لم تُنشر بعد");
    expect(overviewCount("ar", "menusNotLive", 11)).toBe("11 قائمةً لم تُنشر بعد");
    expect(overviewCount("ar", "menusNotLive", 100)).toBe("100 قائمة لم تُنشر بعد");
    expect(overviewCount("ar", "storefrontsInDraft", 2)).toBe(
      "واجهتا متجر لا تزالان في وضع المسودة",
    );
    expect(overviewCount("en", "menusInDraft", 1)).toBe(
      "1 menu is still in draft, ready to publish when you are.",
    );
    expect(overviewCount("en", "menusInDraft", 4)).toBe(
      "4 menus are still in draft, ready to publish when you are.",
    );
  });

  it("formats the date line in the staff language with Western digits and no capitals", () => {
    const date = new Date(2026, 10, 4, 9, 30);
    expect(overviewDateLine("en", date)).toBe("Wednesday 4 November");
    const ar = overviewDateLine("ar", date);
    expect(ar).toContain("الأربعاء");
    expect(ar).toContain("نوفمبر");
    expect(ar).toContain("4");
    expect(ar).not.toMatch(/[٠-٩]/);
    expect(overviewActivityTime("ar", date)).not.toMatch(/[٠-٩]/);
  });

  it("shows the currency symbol for the staff language", () => {
    expect(overviewCurrencyLabel("en", "AED")).toBe("AED");
    expect(overviewCurrencyLabel("ar", "AED")).toContain("\u062f.\u0625");
    expect(overviewCurrencyLabel("en", "not-a-currency")).toBe("not-a-currency");
  });

  it("localizes location statuses", () => {
    expect(overviewLocationStatus("ar", "active")).toBe("نشط");
    expect(overviewLocationStatus("ar", "inactive")).toBe("غير نشط");
    expect(overviewLocationStatus("en", "archived")).toBe("Archived");
  });
});
