import type { StaffCountForms, StaffLocale } from "@/lib/staff/locale";

/* Staff copy for the business Overview. Each sentence keeps its own
   punctuation so Arabic places the full stop at the end of the RTL line. */

const EN = {
  greetingMorning: "Good morning",
  greetingAfternoon: "Good afternoon",
  greetingEvening: "Good evening",
  greeting: "{greeting}, {name}.",
  heroTitleLead: "Your business.",
  heroTitleBefore: "In ",
  heroTitleEmphasis: "perspective.",
  heroDescriptionLead: "Every order, every location, every detail.",
  heroDescriptionTail: "A clear view of what’s next.",
  manageOrders: "Manage orders",
  viewPerformance: "View performance",
  businessPulse: "Business pulse",
  noPaymentsYet: "no payments yet",
  paymentsCaptured: "of payments captured",
  revenueToday: "Revenue today",
  paymentsToday: "Payments today",
  locationsActive: "Locations active",
  menusLive: "Menus live",
  captionLead: "One workspace",
  captionTail: "Every possibility",
  modules: "Modules",
  dockOrdersTitle: "Orders",
  dockOrdersLine: "Keep every order moving.",
  dockCatalogueTitle: "Catalogue",
  dockCatalogueLine: "Curate your offering.",
  dockMenusTitle: "Menus",
  dockMenusLine: "Make every menu yours.",
  dockStoreTitle: "Storefronts",
  dockStoreLine: "Bring your brand to life.",
  liveBusinessData: "Live business data",
  motionOn: "Ambient motion",
  motionPaused: "Motion paused",
  bigPicture: "The big picture",
  everythingConnected: "Everything, connected.",
  loadError: "Unable to load this business overview.",
  recentActivity: "Recent activity",
  activityEmpty: "The audit trail is visible to administrators. Nothing to show here yet.",
  acrossLocations: "Across your locations",
  noLocations: "No locations yet.",
  locationActive: "Active",
  locationInactive: "Inactive",
  locationArchived: "Archived",
  readyWhenYouAre: "Ready when you are",
  freshMenuLead: "A fresh menu.",
  freshMenuTail: "One release away.",
  allMenusPublished: "Every menu in this business is published.",
  openMenus: "Open menus",
} as const;

export type OverviewCopyKey = keyof typeof EN;

const AR: Record<OverviewCopyKey, string> = {
  greetingMorning: "صباح الخير",
  greetingAfternoon: "طاب يومك",
  greetingEvening: "مساء الخير",
  greeting: "{greeting}، {name}.",
  heroTitleLead: "أعمالك كلّها.",
  heroTitleBefore: "في ",
  heroTitleEmphasis: "رؤية واحدة.",
  heroDescriptionLead: "كل طلب، وكل فرع، وكل تفصيل.",
  heroDescriptionTail: "ورؤية واضحة لما هو قادم.",
  manageOrders: "إدارة الطلبات",
  viewPerformance: "عرض الأداء",
  businessPulse: "نبض الأعمال",
  noPaymentsYet: "لا توجد مدفوعات بعد",
  paymentsCaptured: "من المدفوعات تم تحصيلها",
  revenueToday: "إيرادات اليوم",
  paymentsToday: "مدفوعات اليوم",
  locationsActive: "الفروع النشطة",
  menusLive: "القوائم المنشورة",
  captionLead: "مساحة عمل واحدة",
  captionTail: "وإمكانات بلا حدود",
  modules: "الأقسام",
  dockOrdersTitle: "الطلبات",
  dockOrdersLine: "تابِع كل طلب حتى يكتمل.",
  dockCatalogueTitle: "الكتالوج",
  dockCatalogueLine: "نظّم تشكيلة منتجاتك.",
  dockMenusTitle: "القوائم",
  dockMenusLine: "اجعل كل قائمة تعبّر عنك.",
  dockStoreTitle: "واجهات المتجر",
  dockStoreLine: "امنح علامتك التجارية حضورًا مميزًا.",
  liveBusinessData: "بيانات الأعمال المباشرة",
  motionOn: "حركة الخلفية",
  motionPaused: "الحركة متوقفة",
  bigPicture: "الصورة الكاملة",
  everythingConnected: "كل شيء مترابط.",
  loadError: "تعذّر تحميل النظرة العامة لهذا النشاط التجاري.",
  recentActivity: "أحدث النشاطات",
  activityEmpty: "سجل التدقيق متاح للمسؤولين. لا يوجد ما يُعرض هنا بعد.",
  acrossLocations: "في جميع فروعك",
  noLocations: "لا توجد فروع بعد.",
  locationActive: "نشط",
  locationInactive: "غير نشط",
  locationArchived: "مؤرشف",
  readyWhenYouAre: "جاهزة متى شئت",
  freshMenuLead: "قائمة جديدة،",
  freshMenuTail: "لا يفصلك عنها سوى النشر.",
  allMenusPublished: "جميع قوائم هذا النشاط التجاري منشورة.",
  openMenus: "فتح القوائم",
};

const COPY: Record<StaffLocale, Record<OverviewCopyKey, string>> = { en: EN, ar: AR };

export function overviewCopy(
  locale: StaffLocale,
  key: OverviewCopyKey,
  values: Record<string, string | number> = {},
) {
  return Object.entries(values).reduce<string>(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    COPY[locale][key],
  );
}

const COUNT_COPY = {
  en: {
    menusNotLive: { one: "{count} menu not live yet", other: "{count} menus not live yet" },
    storefrontsInDraft: {
      one: "{count} storefront still in draft",
      other: "{count} storefronts still in draft",
    },
    menusInDraft: {
      one: "{count} menu is still in draft, ready to publish when you are.",
      other: "{count} menus are still in draft, ready to publish when you are.",
    },
  },
  ar: {
    menusNotLive: {
      zero: "لا توجد قوائم غير منشورة",
      one: "قائمة واحدة لم تُنشر بعد",
      two: "قائمتان لم تُنشرا بعد",
      few: "{count} قوائم لم تُنشر بعد",
      many: "{count} قائمةً لم تُنشر بعد",
      other: "{count} قائمة لم تُنشر بعد",
    },
    storefrontsInDraft: {
      zero: "لا توجد واجهات متجر في وضع المسودة",
      one: "واجهة متجر واحدة لا تزال في وضع المسودة",
      two: "واجهتا متجر لا تزالان في وضع المسودة",
      few: "{count} واجهات متجر لا تزال في وضع المسودة",
      many: "{count} واجهةَ متجر لا تزال في وضع المسودة",
      other: "{count} واجهة متجر لا تزال في وضع المسودة",
    },
    menusInDraft: {
      zero: "لا توجد قوائم في وضع المسودة.",
      one: "قائمة واحدة لا تزال مسودة، وهي جاهزة للنشر متى شئت.",
      two: "قائمتان لا تزالان مسودتين، وهما جاهزتان للنشر متى شئت.",
      few: "{count} قوائم لا تزال مسودات، وهي جاهزة للنشر متى شئت.",
      many: "{count} قائمةً لا تزال مسودات، وهي جاهزة للنشر متى شئت.",
      other: "{count} قائمة لا تزال مسودات، وهي جاهزة للنشر متى شئت.",
    },
  },
} as const satisfies Record<StaffLocale, Record<string, StaffCountForms>>;

export type OverviewCountKey = keyof (typeof COUNT_COPY)["en"];

const PLURAL_RULES: Record<StaffLocale, Intl.PluralRules> = {
  en: new Intl.PluralRules("en"),
  ar: new Intl.PluralRules("ar"),
};

export function overviewCount(locale: StaffLocale, key: OverviewCountKey, count: number) {
  const forms: StaffCountForms = COUNT_COPY[locale][key];
  return (forms[PLURAL_RULES[locale].select(count)] ?? forms.other).replace(
    "{count}",
    String(count),
  );
}

export function overviewGreeting(locale: StaffLocale, hour: number, name: string) {
  const greeting = overviewCopy(
    locale,
    hour < 12 ? "greetingMorning" : hour < 17 ? "greetingAfternoon" : "greetingEvening",
  );
  return overviewCopy(locale, "greeting", { greeting, name });
}

const DATE_LOCALES: Record<StaffLocale, string> = { en: "en-GB", ar: "ar-AE" };

export function overviewDateLine(locale: StaffLocale, date: Date) {
  return date.toLocaleDateString(DATE_LOCALES[locale], {
    weekday: "long",
    day: "numeric",
    month: "long",
    numberingSystem: "latn",
  });
}

export function overviewActivityTime(locale: StaffLocale, date: Date) {
  return date.toLocaleString(DATE_LOCALES[locale], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    numberingSystem: "latn",
  });
}

export function overviewCurrencyLabel(locale: StaffLocale, currency: string) {
  try {
    const parts = new Intl.NumberFormat(DATE_LOCALES[locale], {
      style: "currency",
      currency,
    }).formatToParts(0);
    return parts.find((part) => part.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}

export function overviewLocationStatus(locale: StaffLocale, status: string) {
  if (status === "active") return overviewCopy(locale, "locationActive");
  if (status === "archived") return overviewCopy(locale, "locationArchived");
  return overviewCopy(locale, "locationInactive");
}
