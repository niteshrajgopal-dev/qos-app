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
    approvals: "Approvals",
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
    videoSuperseded: "Superseded by a newer upload.",
    productVideoLabel: "Product video",
    chooseFile: "Choose File",
    noFileChosen: "No file chosen",
    archiveDraftProduct: "Archive draft product",
    archiveDraftProductDescription:
      "Remove this draft from the catalogue. It will not appear in product lists or menu pickers.",
    archiveDraftProductConfirmTitle: "Archive this draft product?",
    archiveDraftProductConfirmDescription:
      "This hides the draft from your catalogue. Published menus are not changed.",
    archiveDraftProductConfirmLabel: "Archive",
    archiveDraftProductArchiving: "Archiving…",
    archiveDraftProductSuccessNotice: "Draft product archived.",
    aiGeneratedImageTitle: "AI-generated image",
    aiPhotoPromptLabel: "Generation prompt",
    aiPhotoStaleMessage: "Item changed since this image was generated. Generate a new one.",
    removeProductPhoto: "Remove photo",
    removingProductPhoto: "Removing photo…",
    productPhotoRemoved: "Photo removed from draft. Publish to update live menus.",
    staffMemberLabel: "Staff member",
    overview: "Overview",
    storefronts: "Storefronts",
    more: "More",
    menuExtraction: "Menu extraction",
    allChannels: "All channels",
    members: "Members",
    aiAgents: "AI & Agents",
    cancel: "Cancel",
    confirm: "Confirm",
    keepEditing: "Keep editing",
    discard: "Discard",
    roleAdministrator: "Administrator",
    roleUser: "User",
    unableToLoadWorkspace: "Unable to load staff workspace",
    noAccessToBusiness: "No access to this business",
    noMembershipBody:
      "Your staff account does not have an active membership here.",
    switchBusiness: "Switch business",
    searchThisBusiness: "Search this business",
    notifications: "Notifications",
    productsTitle: "Products",
    loadingProductsSubtitle: "Loading products...",
    loadingCatalogueProducts: "Loading catalogue products...",
    unableToLoadCatalogueProducts: "Unable to load catalogue products.",
    networkError: "Network error",
    noProductsYet: "No products yet",
    newProduct: "New product",
    noCatalogueProductsTitle: "No catalogue products",
    noCatalogueProductsBody: "Products you create or import will appear here.",
    noProductsMatchSearch: "No products match your search",
    clearSearch: "Clear search",
    tabAll: "All",
    tabActive: "Active",
    tabDrafts: "Drafts",
    tabArchived: "Archived",
    columnProduct: "Product",
    columnInternalName: "Internal name",
    columnStatus: "Status",
    columnActions: "Actions",
    unableToRestoreProduct: "Unable to restore product.",
    noActiveProductsTitle: "No active products",
    noActiveProductsBody: "Active products will appear here once published.",
    noDraftProductsTitle: "No draft products",
    noDraftProductsBody: "Products you create or import will start as drafts.",
    noArchivedProductsTitle: "No archived products",
    noArchivedProductsBody: "Archived products will appear here.",
    noProductsTitle: "No products",
    noProductsBody: "No products to display.",
    searchProductsPlaceholder: "Search {count} products",
    productsSearchEmptyBody: 'No products found for "{query}".',
    productsSearchMatchOne: "1 product matches",
    productsSearchMatchMany: "{count} products match",
    productsCountOne: "1 product",
    productsCountMany: "{count} products",
    productsActiveOne: "1 active",
    productsActiveMany: "{count} active",
    productsDraftOne: "1 draft",
    productsDraftMany: "{count} drafts",
    productsArchivedOne: "1 archived",
    productsArchivedMany: "{count} archived",
    discardUnsavedProductTitle: "Discard unsaved changes to this draft product?",
    discardUnsavedProductDescription:
      "The current draft will revert to the last saved version.",
    discardUnsavedMenuTitle: "Discard unsaved changes to this draft menu?",
    restoreToDraft: "Restore to draft",
    restoring: "Restoring…",
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
    approvals: "الموافقات",
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
    videoSuperseded: "تم استبداله بملف أحدث.",
    productVideoLabel: "فيديو المنتج",
    chooseFile: "اختيار ملف",
    noFileChosen: "لم يتم اختيار ملف",
    archiveDraftProduct: "أرشفة مسودة المنتج",
    archiveDraftProductDescription:
      "إزالة هذه المسودة من الكتالوج. لن تظهر في قوائم المنتجات أو منتقي القوائم.",
    archiveDraftProductConfirmTitle: "أرشفة هذه المسودة؟",
    archiveDraftProductConfirmDescription:
      "ستُخفى المسودة من الكتالوج. القوائم المنشورة لا تتغير.",
    archiveDraftProductConfirmLabel: "أرشفة",
    archiveDraftProductArchiving: "جاري الأرشفة…",
    archiveDraftProductSuccessNotice: "تمت أرشفة مسودة المنتج.",
    aiGeneratedImageTitle: "صورة مُولَّدة بالذكاء الاصطناعي",
    aiPhotoPromptLabel: "نص التوليد",
    aiPhotoStaleMessage: "تغيّر الصنف بعد توليد هذه الصورة. أنشئ صورة جديدة.",
    removeProductPhoto: "إزالة الصورة",
    removingProductPhoto: "جاري إزالة الصورة…",
    productPhotoRemoved: "أُزيلت الصورة من المسودة. انشر القائمة لتحديث القوائم المنشورة.",
    staffMemberLabel: "عضو الفريق",
    overview: "نظرة عامة",
    storefronts: "واجهات المتجر",
    more: "المزيد",
    menuExtraction: "استخراج القائمة",
    allChannels: "كل القنوات",
    members: "الأعضاء",
    aiAgents: "الذكاء الاصطناعي والوكلاء",
    cancel: "إلغاء",
    confirm: "تأكيد",
    keepEditing: "متابعة التعديل",
    discard: "تجاهل",
    roleAdministrator: "مسؤول",
    roleUser: "مستخدم",
    unableToLoadWorkspace: "تعذر تحميل مساحة عمل الموظفين",
    noAccessToBusiness: "لا يوجد وصول إلى هذا النشاط",
    noMembershipBody: "حسابك لا يملك عضوية نشطة هنا.",
    switchBusiness: "تبديل النشاط",
    searchThisBusiness: "البحث في هذا النشاط",
    notifications: "الإشعارات",
    productsTitle: "المنتجات",
    loadingProductsSubtitle: "جاري تحميل المنتجات...",
    loadingCatalogueProducts: "جاري تحميل منتجات الكتالوج...",
    unableToLoadCatalogueProducts: "تعذر تحميل منتجات الكتالوج.",
    networkError: "خطأ في الشبكة",
    noProductsYet: "لا توجد منتجات بعد",
    newProduct: "منتج جديد",
    noCatalogueProductsTitle: "لا توجد منتجات في الكتالوج",
    noCatalogueProductsBody: "ستظهر المنتجات التي تنشئها أو تستوردها هنا.",
    noProductsMatchSearch: "لا توجد منتجات مطابقة لبحثك",
    clearSearch: "مسح البحث",
    tabAll: "الكل",
    tabActive: "نشط",
    tabDrafts: "مسودات",
    tabArchived: "مؤرشف",
    columnProduct: "المنتج",
    columnInternalName: "الاسم الداخلي",
    columnStatus: "الحالة",
    columnActions: "إجراءات",
    unableToRestoreProduct: "تعذر استعادة المنتج.",
    noActiveProductsTitle: "لا توجد منتجات نشطة",
    noActiveProductsBody: "ستظهر المنتجات النشطة هنا بعد النشر.",
    noDraftProductsTitle: "لا توجد مسودات منتجات",
    noDraftProductsBody: "تبدأ المنتجات التي تنشئها أو تستوردها كمسودات.",
    noArchivedProductsTitle: "لا توجد منتجات مؤرشفة",
    noArchivedProductsBody: "ستظهر المنتجات المؤرشفة هنا.",
    noProductsTitle: "لا توجد منتجات",
    noProductsBody: "لا توجد منتجات لعرضها.",
    searchProductsPlaceholder: "ابحث في {count} منتجًا",
    productsSearchEmptyBody: 'لم يُعثر على منتجات لـ "{query}".',
    productsSearchMatchOne: "منتج واحد مطابق",
    productsSearchMatchMany: "{count} منتجات مطابقة",
    productsCountOne: "منتج واحد",
    productsCountMany: "{count} منتجات",
    productsActiveOne: "نشط واحد",
    productsActiveMany: "{count} نشطة",
    productsDraftOne: "مسودة واحدة",
    productsDraftMany: "{count} مسودات",
    productsArchivedOne: "مؤرشف واحد",
    productsArchivedMany: "{count} مؤرشفة",
    discardUnsavedProductTitle: "تجاهل التغييرات غير المحفوظة على مسودة المنتج؟",
    discardUnsavedProductDescription:
      "ستعود المسودة الحالية إلى آخر نسخة محفوظة.",
    discardUnsavedMenuTitle: "تجاهل التغييرات غير المحفوظة على مسودة القائمة؟",
    restoreToDraft: "استعادة كمسودة",
    restoring: "جاري الاستعادة…",
  },
} as const;

export type StaffUiCopyKey = keyof (typeof STAFF_UI_COPY)["en"];

export function staffUiCopy(locale: StaffLocale, key: StaffUiCopyKey) {
  return STAFF_UI_COPY[locale][key];
}

const NAV_LABEL_KEYS: Record<string, StaffUiCopyKey> = {
  Home: "home",
  Overview: "overview",
  Orders: "orders",
  Catalogue: "catalogue",
  Products: "products",
  Menus: "menus",
  "Modifier groups": "modifiers",
  Import: "import",
  Categories: "categories",
  Customers: "customers",
  "Sales Channels": "channels",
  "Sales channels": "channels",
  "Online Store": "store",
  Storefronts: "storefronts",
  POS: "pos",
  Locations: "locations",
  Integrations: "integrations",
  Analytics: "analytics",
  Team: "team",
  Members: "members",
  "Access requests": "accessRequests",
  Approvals: "approvals",
  Audit: "audit",
  Settings: "settings",
  "Menu extraction": "menuExtraction",
  "All channels": "allChannels",
  "AI & Agents": "aiAgents",
  More: "more",
  Commerce: "commerce",
  Platform: "platform",
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

export function staffRoleLabel(
  locale: StaffLocale,
  role: "administrator" | "user" | null | undefined,
) {
  if (role === "administrator") {
    return staffUiCopy(locale, "roleAdministrator");
  }
  if (role === "user") {
    return staffUiCopy(locale, "roleUser");
  }
  return staffUiCopy(locale, "roleUser");
}

export function staffProductsSearchPlaceholder(
  locale: StaffLocale,
  count: number,
) {
  return staffUiCopy(locale, "searchProductsPlaceholder").replace(
    "{count}",
    String(count),
  );
}

export function staffProductsSearchEmptyBody(
  locale: StaffLocale,
  query: string,
) {
  return staffUiCopy(locale, "productsSearchEmptyBody").replace(
    "{query}",
    query,
  );
}

export function staffProductsListSubtitle(
  locale: StaffLocale,
  count: number,
  activeTab: string,
  hasSearchQuery: boolean,
): string {
  if (hasSearchQuery) {
    return count === 1
      ? staffUiCopy(locale, "productsSearchMatchOne")
      : staffUiCopy(locale, "productsSearchMatchMany").replace(
          "{count}",
          String(count),
        );
  }

  switch (activeTab) {
    case "all":
      return count === 1
        ? staffUiCopy(locale, "productsCountOne")
        : staffUiCopy(locale, "productsCountMany").replace(
            "{count}",
            String(count),
          );
    case "active":
      return count === 1
        ? staffUiCopy(locale, "productsActiveOne")
        : staffUiCopy(locale, "productsActiveMany").replace(
            "{count}",
            String(count),
          );
    case "draft":
      return count === 1
        ? staffUiCopy(locale, "productsDraftOne")
        : staffUiCopy(locale, "productsDraftMany").replace(
            "{count}",
            String(count),
          );
    case "archived":
      return count === 1
        ? staffUiCopy(locale, "productsArchivedOne")
        : staffUiCopy(locale, "productsArchivedMany").replace(
            "{count}",
            String(count),
          );
    default:
      return count === 1
        ? staffUiCopy(locale, "productsCountOne")
        : staffUiCopy(locale, "productsCountMany").replace(
            "{count}",
            String(count),
          );
  }
}
