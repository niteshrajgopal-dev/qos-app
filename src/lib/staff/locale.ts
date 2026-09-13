export type StaffLocale = "en" | "ar";

export const STAFF_LOCALE_STORAGE_KEY = "qos-staff-locale";

export function staffDocumentDirection(locale: StaffLocale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}

export function isStaffLocale(value: string | null | undefined): value is StaffLocale {
  return value === "en" || value === "ar";
}

export function readStoredStaffLocale(): StaffLocale {
  if (typeof window === "undefined") {
    return "en";
  }

  const stored = window.localStorage.getItem(STAFF_LOCALE_STORAGE_KEY);
  return isStaffLocale(stored) ? stored : "en";
}

const staffLocaleListeners = new Set<() => void>();

export function subscribeStaffLocale(onStoreChange: () => void) {
  staffLocaleListeners.add(onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    staffLocaleListeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

export function setStoredStaffLocale(locale: StaffLocale) {
  window.localStorage.setItem(STAFF_LOCALE_STORAGE_KEY, locale);
  for (const listener of staffLocaleListeners) {
    listener();
  }
}

export const STAFF_UI_COPY = {
  en: {
    signInTitle: "Sign in to QOS",
    signInSubtitle: "Use your work account.",
    workEmail: "Work email",
    password: "Password",
    continue: "Continue",
    home: "Home",
    orders: "Orders",
    catalogue: "Catalogue",
    products: "Products",
    menus: "Menus",
    modifiers: "Modifier groups",
    import: "Import",
    categories: "Categories",
    customers: "Customers",
    channels: "Sales Channels",
    store: "Online Store",
    pos: "POS",
    locations: "Locations",
    integrations: "Integrations",
    analytics: "Analytics",
    team: "Team",
    accessRequests: "Access requests",
    audit: "Audit",
    settings: "Settings",
    commerce: "Commerce",
    platform: "Platform",
    soon: "Soon",
    signOut: "Sign out",
    development: "Development",
    welcomeBack: "Welcome back",
    loadingWorkspace: "Loading workspace…",
    chooseBusiness: "Choose a business",
  },
  ar: {
    signInTitle: "تسجيل الدخول إلى QOS",
    signInSubtitle: "استخدم حساب العمل.",
    workEmail: "البريد المهني",
    password: "كلمة المرور",
    continue: "متابعة",
    home: "الرئيسية",
    orders: "الطلبات",
    catalogue: "الكتالوج",
    products: "المنتجات",
    menus: "القوائم",
    modifiers: "مجموعات الإضافات",
    import: "الاستيراد",
    categories: "التصنيفات",
    customers: "العملاء",
    channels: "قنوات البيع",
    store: "المتجر الإلكتروني",
    pos: "نقطة البيع",
    locations: "الفروع",
    integrations: "التكاملات",
    analytics: "التحليلات",
    team: "الفريق",
    accessRequests: "طلبات الوصول",
    audit: "التدقيق",
    settings: "الإعدادات",
    commerce: "التجارة",
    platform: "المنصة",
    soon: "قريبًا",
    signOut: "تسجيل الخروج",
    development: "بيئة التطوير",
    welcomeBack: "مرحبًا بعودتك",
    loadingWorkspace: "جاري تحميل مساحة العمل…",
    chooseBusiness: "اختر نشاطًا",
  },
} as const;

export type StaffUiCopyKey = keyof (typeof STAFF_UI_COPY)["en"];

export function staffUiCopy(locale: StaffLocale, key: StaffUiCopyKey) {
  return STAFF_UI_COPY[locale][key];
}

const NAV_LABEL_KEYS: Record<string, StaffUiCopyKey> = {
  Home: "home",
  Orders: "orders",
  Catalogue: "catalogue",
  Products: "products",
  Menus: "menus",
  "Modifier groups": "modifiers",
  Import: "import",
  Categories: "categories",
  Customers: "customers",
  "Sales Channels": "channels",
  "Online Store": "store",
  POS: "pos",
  Locations: "locations",
  Integrations: "integrations",
  Analytics: "analytics",
  Team: "team",
  "Access requests": "accessRequests",
  Audit: "audit",
  Settings: "settings",
};

export function staffNavLabel(locale: StaffLocale, id: string, fallback: string) {
  const fromLabel = NAV_LABEL_KEYS[fallback];
  if (fromLabel) {
    return staffUiCopy(locale, fromLabel);
  }
  if (id in STAFF_UI_COPY.en) {
    return staffUiCopy(locale, id as StaffUiCopyKey);
  }
  return fallback;
}
