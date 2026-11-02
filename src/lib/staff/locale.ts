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
    removeProductPhotoConfirmTitle: "Remove this photo?",
    removeProductPhotoConfirmDescription:
      "The photo will be cleared from the draft product. Published menus stay unchanged until you publish.",
    removeProductPhotoConfirmLabel: "Remove photo",
    productPhotoRemoved: "Photo removed from draft. Publish to update live menus.",
    removedPhotoHistoryTitle: "Removed photos",
    removedPhotoHistoryRemovedPrefix: "Removed",
    photoSourceAiGenerated: "AI-generated",
    photoSourceUploaded: "Uploaded",
    staffMemberLabel: "Staff member",
    cancel: "Cancel",
    keepEditing: "Keep editing",
    discard: "Discard",
    discardUnsavedProductTitle: "Discard unsaved changes to this draft product?",
    discardUnsavedProductDescription:
      "The current draft will revert to the last saved version.",
    productEditorSectionIdentityTitle: "Identity",
    productEditorSectionIdentityHelp:
      "Internal identifiers used in search, imports, and reports.",
    productEditorSectionEnglishTitle: "English",
    productEditorSectionEnglishHelp:
      "Name and description shown when the menu language is English.",
    productEditorSectionArabicTitle: "Arabic",
    productEditorSectionArabicHelp:
      "Name and description shown when the menu language is Arabic.",
    productEditorSectionPricingTitle: "Pricing and calories",
    productEditorSectionPricingHelp:
      "Default sell price and optional calorie count for hospitality menus.",
    productEditorSectionMediaTitle: "Media",
    productEditorSectionMediaHelp:
      "Photo and short video validated for menu publish.",
    productEditorSectionVariantsTitle: "Variants",
    productEditorSectionVariantsHelp:
      "Size or style choices sold under one product.",
    productEditorSectionModifierGroupsTitle: "Modifier groups",
    productEditorSectionModifierGroupsHelp:
      "Reusable choice groups attached to this product.",
    productEditorSectionStatusTitle: "Status",
    productEditorSectionStatusHelp:
      "Whether this product is a draft, live in menus, or archived.",
    productEditorInternalNameLabel: "Internal name",
    productEditorInternalNameHelp: "Staff-only label; not shown on customer menus.",
    productEditorSkuLabel: "SKU",
    productEditorSkuHelp: "Optional stock-keeping unit.",
    productEditorBarcodeLabel: "Barcode",
    productEditorBarcodeHelp: "Optional scannable code.",
    productEditorDisplayNameLabel: "Display name",
    productEditorDescriptionLabel: "Description",
    productEditorTranslationVersionLabel: "Translation version",
    productEditorDefaultPriceLabel: "Default price (AED)",
    productEditorDefaultPriceHelp: "Applies to the default variant.",
    productEditorCaloriesLabel: "Calories (optional)",
    productEditorPriceAdminNotice: "Price changes require an administrator.",
    productEditorPhotoLabel: "Product photo",
    productEditorPhotoHelp:
      "Upload a JPEG or PNG. It is validated and converted for menu publish.",
    productEditorUploadingPhoto: "Uploading and processing…",
    productEditorPhotoApproved:
      "Product image approved and ready for menu publish.",
    productEditorLoading: "Loading product…",
    productEditorUnsavedChanges: "Unsaved changes",
    productEditorAllSavedLocally: "All changes saved locally",
    productEditorProductLabel: "Product",
    productEditorVersionLabel: "Version",
    productEditorSavedDraftNotice: "Draft product saved.",
    productEditorCreatedDraftNotice: "Draft product created.",
    productEditorInvalidPrice: "Enter a valid AED price.",
    productEditorRestoreHelp:
      "Return this archived product to draft status so it can be edited again.",
    productEditorStatusDraft: "Draft",
    productEditorStatusActive: "Active",
    productEditorStatusArchived: "Archived",
    productEditorCurrentStatus: "Current status",
    productEditorTranslationReview: "Translation review",
    productEditorLocationPrices: "Location prices",
    productEditorVideoProcessingTimeout:
      "Processing took too long. Check back later.",
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
    removeProductPhotoConfirmTitle: "إزالة هذه الصورة؟",
    removeProductPhotoConfirmDescription:
      "ستُزال الصورة من مسودة المنتج. القوائم المنشورة لا تتغيّر حتى تنشر التعديلات.",
    removeProductPhotoConfirmLabel: "إزالة الصورة",
    productPhotoRemoved: "أُزيلت الصورة من المسودة. انشر القائمة لتحديث القوائم المنشورة.",
    removedPhotoHistoryTitle: "الصور المُزالة",
    removedPhotoHistoryRemovedPrefix: "أُزيلت",
    photoSourceAiGenerated: "مُولَّدة بالذكاء الاصطناعي",
    photoSourceUploaded: "مرفوعة",
    staffMemberLabel: "عضو الفريق",
    cancel: "إلغاء",
    keepEditing: "متابعة التعديل",
    discard: "تجاهل",
    discardUnsavedProductTitle: "تجاهل التغييرات غير المحفوظة على مسودة المنتج؟",
    discardUnsavedProductDescription:
      "ستعود المسودة إلى آخر نسخة محفوظة.",
    productEditorSectionIdentityTitle: "الهوية",
    productEditorSectionIdentityHelp:
      "معرّفات داخلية تُستخدم في البحث والاستيراد والتقارير.",
    productEditorSectionEnglishTitle: "الإنجليزية",
    productEditorSectionEnglishHelp:
      "الاسم والوصف الظاهران عندما تكون لغة القائمة الإنجليزية.",
    productEditorSectionArabicTitle: "العربية",
    productEditorSectionArabicHelp:
      "الاسم والوصف الظاهران عندما تكون لغة القائمة العربية.",
    productEditorSectionPricingTitle: "التسعير والسعرات",
    productEditorSectionPricingHelp:
      "سعر البيع الافتراضي وعدد السعرات اختياريًا لقوائم الضيافة.",
    productEditorSectionMediaTitle: "الوسائط",
    productEditorSectionMediaHelp:
      "صورة المنتج وفيديو قصير يُتحقق منهما قبل النشر في القائمة.",
    productEditorSectionVariantsTitle: "المتغيرات",
    productEditorSectionVariantsHelp:
      "اختيارات الحجم أو النمط التي تُباع تحت منتج واحد.",
    productEditorSectionModifierGroupsTitle: "مجموعات الإضافات",
    productEditorSectionModifierGroupsHelp:
      "مجموعات اختيار قابلة لإعادة الاستخدام مرتبطة بهذا المنتج.",
    productEditorSectionStatusTitle: "الحالة",
    productEditorSectionStatusHelp:
      "ما إذا كان المنتج مسودة أو منشورًا في القوائم أو مؤرشفًا.",
    productEditorInternalNameLabel: "الاسم الداخلي",
    productEditorInternalNameHelp: "تسمية للفريق فقط؛ لا تظهر في قوائم العملاء.",
    productEditorSkuLabel: "رمز SKU",
    productEditorSkuHelp: "رمز مخزون اختياري.",
    productEditorBarcodeLabel: "الباركود",
    productEditorBarcodeHelp: "رمز قابل للمسح اختياري.",
    productEditorDisplayNameLabel: "اسم العرض",
    productEditorDescriptionLabel: "الوصف",
    productEditorTranslationVersionLabel: "إصدار الترجمة",
    productEditorDefaultPriceLabel: "السعر الافتراضي (درهم)",
    productEditorDefaultPriceHelp: "ينطبق على المتغير الافتراضي.",
    productEditorCaloriesLabel: "السعرات (اختياري)",
    productEditorPriceAdminNotice: "تغيير السعر يتطلب صلاحية مسؤول.",
    productEditorPhotoLabel: "صورة المنتج",
    productEditorPhotoHelp:
      "ارفع JPEG أو PNG. تُتحقق من الصورة وتُحوَّل للنشر في القائمة.",
    productEditorUploadingPhoto: "جاري الرفع والمعالجة…",
    productEditorPhotoApproved: "تمت الموافقة على الصورة وهي جاهزة للنشر في القائمة.",
    productEditorLoading: "جاري تحميل المنتج…",
    productEditorUnsavedChanges: "تغييرات غير محفوظة",
    productEditorAllSavedLocally: "جميع التغييرات محفوظة محليًا",
    productEditorProductLabel: "المنتج",
    productEditorVersionLabel: "الإصدار",
    productEditorSavedDraftNotice: "تم حفظ مسودة المنتج.",
    productEditorCreatedDraftNotice: "تم إنشاء مسودة المنتج.",
    productEditorInvalidPrice: "أدخل سعرًا صالحًا بالدرهم.",
    productEditorRestoreHelp:
      "إعادة هذا المنتج المؤرشف إلى مسودة حتى يمكن تعديله مجددًا.",
    productEditorStatusDraft: "مسودة",
    productEditorStatusActive: "نشط",
    productEditorStatusArchived: "مؤرشف",
    productEditorCurrentStatus: "الحالة الحالية",
    productEditorTranslationReview: "مراجعة الترجمة",
    productEditorLocationPrices: "أسعار الفروع",
    productEditorVideoProcessingTimeout:
      "استغرقت المعالجة وقتًا طويلًا. تحقق لاحقًا.",
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
  Approvals: "approvals",
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
