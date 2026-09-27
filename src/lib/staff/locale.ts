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
    workspace: "Workspace",
    searchCommands: "Search pages and actions",
    commandGo: "Go",
    videoErrorEmpty: "The uploaded file is empty.",
    videoErrorTooLarge: "The video file is too large. Maximum file size is 20 MB.",
    videoErrorTooLong: "The video is too long. Maximum duration is 25 seconds.",
    videoErrorResolution: "The video resolution is too high. Maximum resolution is 1920x1080.",
    videoErrorUnsupportedContainer: "This file isn't a supported video. Upload an MP4 video.",
    videoErrorUnsupportedCodec: "This video uses an unsupported codec. Upload an MP4 video with H.264 or H.265 encoding.",
    videoErrorContentType: "This file isn't a supported video. Upload an MP4 video.",
    videoErrorProbe: "Unable to read the video file. The file may be corrupted.",
    videoErrorTranscode: "Unable to process the video. Please try again or contact support.",
    videoErrorPoster: "Unable to generate video thumbnail. Please try again.",
    videoErrorQuarantined: "The video could not be processed after multiple attempts.",
    videoErrorGeneric: "An error occurred while processing the video. Please try again.",
    videoUploadingStatus: "Uploading video…",
    videoQueueingStatus: "Queueing video for processing...",
    videoQueuedStatus: "Video queued for processing.",
    videoProcessingStatus: "Video is being processed...",
    videoCheckStatusError: "Unable to check processing status.",
    videoReadyForPublish: "Video ready for menu publish.",
    videoDescription: "Upload an MP4 video (max 20 MiB, 25 seconds, 1080p, H.264 or H.265). The video is validated and transcoded asynchronously.",
    videoPlayerFallback: "Your browser does not support the video tag.",
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
    workspace: "مساحة العمل",
    searchCommands: "ابحث في الصفحات والإجراءات",
    commandGo: "انتقال",
    videoErrorEmpty: "الملف المرفوع فارغ.",
    videoErrorTooLarge: "حجم الفيديو كبير جدًا. الحد الأقصى 20 ميغابايت.",
    videoErrorTooLong: "مدة الفيديو طويلة جدًا. الحد الأقصى 25 ثانية.",
    videoErrorResolution: "دقة الفيديو عالية جدًا. الحد الأقصى 1920×1080.",
    videoErrorUnsupportedContainer: "هذا الملف ليس فيديو مدعوم. ارفع فيديو MP4.",
    videoErrorUnsupportedCodec: "يستخدم هذا الفيديو ترميزًا غير مدعوم. ارفع فيديو MP4 بترميز H.264 أو H.265.",
    videoErrorContentType: "هذا الملف ليس فيديو مدعوم. ارفع فيديو MP4.",
    videoErrorProbe: "تعذر قراءة ملف الفيديو. قد يكون الملف تالفًا.",
    videoErrorTranscode: "تعذر معالجة الفيديو. حاول مرة أخرى أو اتصل بالدعم.",
    videoErrorPoster: "تعذر إنشاء صورة مصغرة للفيديو. حاول مرة أخرى.",
    videoErrorQuarantined: "تعذرت معالجة الفيديو بعد عدة محاولات.",
    videoErrorGeneric: "حدث خطأ أثناء معالجة الفيديو. حاول مرة أخرى.",
    videoUploadingStatus: "جاري رفع الفيديو…",
    videoQueueingStatus: "جاري إضافة الفيديو إلى قائمة الانتظار...",
    videoQueuedStatus: "تم إضافة الفيديو إلى قائمة الانتظار.",
    videoProcessingStatus: "جاري معالجة الفيديو...",
    videoCheckStatusError: "تعذر التحقق من حالة المعالجة.",
    videoReadyForPublish: "الفيديو جاهز للنشر في القائمة.",
    videoDescription: "ارفع فيديو MP4 (بحد أقصى 20 ميغابايت، 25 ثانية، 1080 بكسل، H.264 أو H.265). يتم التحقق من الفيديو وتحويله تلقائيًا.",
    videoPlayerFallback: "متصفحك لا يدعم عرض الفيديو.",
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
