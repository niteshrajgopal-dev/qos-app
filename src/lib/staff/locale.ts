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
    productsSearchEmptyBody: 'No products found for "{query}".',
    workspaceEyebrow: "{name} workspace",
    catalogueHeadline: "An offering, well curated.",
    catalogueDescription: "Products, prices and availability. One shared catalogue.",
    catalogueStatProductsSub: "In your catalogue",
    catalogueStatActiveLabel: "Active",
    catalogueStatActiveSub: "Live in published menus",
    catalogueStatDraftsLabel: "Drafts",
    catalogueStatDraftsSub: "Prepare before publishing",
    catalogueFilterLabel: "Filter products by status",
    catalogueSearchLabel: "Search catalogue",
    catalogueManagement: "Catalogue management",
    catalogueResultsLabel: "Products",
    productPriceNotSet: "No price set",
    productNoCategory: "No category",
    productNoPhoto: "No photo yet",
    openProduct: "Open product",
    paginationPrevious: "Previous page",
    paginationNext: "Next page",
    paginationRange: "{from}–{to} of {total}",
    newDraftProductTitle: "New draft product",
    newDraftProductSubtitle:
      "Create English and Arabic copy. Both translations must be approved before the product can go live.",
    reload: "Reload",
    variantSaved: "Variant saved.",
    variantAdded: "Variant added.",
    variantOrderUpdated: "Variant order updated.",
    variantDefault: "Default",
    variantEnglishLabel: "English label",
    variantArabicLabel: "Arabic label",
    variantPriceLabel: "Price (AED)",
    variantSave: "Save variant",
    variantMakeDefault: "Make default",
    variantMoveUp: "Move up",
    variantMoveDown: "Move down",
    variantArchive: "Archive variant",
    variantAddTitle: "Add variant",
    variantPublicIdLabel: "Public ID (optional)",
    variantsLoadError: "Unable to load variants.",
    variantSaveError: "Unable to save variant.",
    variantCreateError: "Unable to create variant.",
    variantReorderError: "Unable to reorder variants.",
    modifierManageGroups: "Manage groups",
    modifierAttached: "Modifier group attached.",
    modifierDetached: "Modifier group detached.",
    modifierDetach: "Detach",
    modifierAttachGroupLabel: "Attach a group",
    modifierSelectGroup: "Select a modifier group",
    modifierAttach: "Attach",
    modifierLoadError: "Unable to load modifier groups.",
    modifierAttachError: "Unable to attach modifier group.",
    modifierDetachError: "Unable to detach modifier group.",
    discardUnsavedProductTitle: "Discard unsaved changes to this draft product?",
    discardUnsavedProductDescription:
      "The current draft will revert to the last saved version.",
    discardUnsavedMenuTitle: "Discard unsaved changes to this draft menu?",
    restoreToDraft: "Restore to draft",
    restoring: "Restoring…",
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
    // QOS-192 Phase 2 navigation and branch context. Leaf ids in the empty
    // states use a non-breaking hyphen (U+2011) so "QOS‑201" never wraps.
    recipes: "Recipes",
    inventory: "Inventory",
    ingredientsAndStock: "Ingredients and stock",
    kitchen: "Kitchen prep",
    sales: "Sales input",
    reports: "Reports",
    finance: "Finance",
    branches: "Branches",
    branchSettings: "Branch settings",
    allBranches: "All branches",
    allBranchesHint: "Read-only view across your branches",
    switchBranch: "Switch branch",
    branchPickerLabel: "Branch: {name}",
    branchStatusActive: "Active",
    branchStatusSuspended: "Suspended",
    branchLoading: "Loading branches…",
    branchUnavailable: "Branches unavailable",
    noBranches: "No branches",
    noBranchesBody:
      "Your membership does not include any branch yet. Ask an administrator for access.",
    branchFallbackNotice:
      "The requested branch is not available to you, so {branch} is shown instead.",
    dismiss: "Dismiss",
    unsavedWorkTitle: "Save your work before switching branch?",
    unsavedWorkBody:
      "This screen has unsaved changes for {branch}. Save them as a draft, discard them, or stay on this branch.",
    saveDraft: "Save draft",
    savingDraft: "Saving draft…",
    stay: "Stay",
    unsavedWorkSaveFailed:
      "The draft could not be saved. Your changes are still here and the branch has not changed.",
    phase2NotAvailableTitle: "This area is not available yet",
    phase2BranchContext: "Branch context: {branch}",
    inventoryDescription:
      "Ingredients, units, suppliers and stock levels for each branch.",
    inventoryEmptyBody:
      "Ingredient master data arrives with QOS‑195 to QOS‑197, and the stock ledger with QOS‑201. Nothing is recorded here yet.",
    kitchenDescription: "Prep targets and counts for the selected branch.",
    kitchenEmptyBody:
      "Kitchen prep arrives with QOS‑207 and QOS‑208. No prep targets or counts exist yet.",
    salesDescription: "Daily sales closings entered per branch and business date.",
    salesEmptyBody:
      "Sales input arrives with QOS‑205 and QOS‑206. No sales closings have been recorded.",
    reportsDescription: "Stock, consumption and sales reports from accepted records.",
    reportsEmptyBody:
      "Reports arrive with QOS‑209 and QOS‑210. There is no report data yet.",
    recipesDescription:
      "Recipe versions, ingredient lines and costing for catalogue products.",
    recipesEmptyBody:
      "Recipes arrive with QOS‑198 and QOS‑199. No recipes exist yet.",
    branchesSettingsDescription:
      "The locations your membership covers, and the business branch names awaiting confirmation.",
    requestedBranchesTitle: "Requested business branches",
    requestedBranchesBody:
      "These branch names were reported by the business. Which existing QOS location each one corresponds to has not been confirmed, so each one stays unmapped. No location is renamed, created or reassigned, and no history is moved.",
    columnBusinessBranch: "Business branch",
    columnQosLocation: "QOS location",
    columnMapping: "Mapping",
    notYetMapped: "Not yet mapped",
    noLocationConfirmed: "No location confirmed",
    mappingPendingNote:
      "Mapping needs the actual location identities from the owner. It will be recorded and audited when that work ships; until then nothing here can be changed.",
    permittedLocationsTitle: "Your permitted locations",
    permittedLocationsAdminBody:
      "As an administrator you can work in every location of this business.",
    permittedLocationsUserBody:
      "These are the locations your membership is scoped to.",
    columnLocation: "Location",
    columnTimezone: "Timezone",
    columnCurrency: "Currency",
    baseCurrencyNote:
      "Currency is the business base currency; locations do not have their own.",
    branchesLoadError: "Unable to load branches.",
    branchLabelDubai: "Dubai",
    branchLabelAlAin: "Al Ain",
    branchLabelAzurCafe: "Azur Cafe",
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
    productsSearchEmptyBody: "لم يُعثر على منتجات تطابق «{query}».",
    workspaceEyebrow: "مساحة عمل {name}",
    catalogueHeadline: "تشكيلة منتقاة بعناية.",
    catalogueDescription: "المنتجات والأسعار والتوفّر. كتالوج واحد مشترك.",
    catalogueStatProductsSub: "في الكتالوج",
    catalogueStatActiveLabel: "المنتجات النشطة",
    catalogueStatActiveSub: "ظاهرة في القوائم المنشورة",
    catalogueStatDraftsLabel: "المسودات",
    catalogueStatDraftsSub: "جهّزها قبل النشر",
    catalogueFilterLabel: "تصفية المنتجات حسب الحالة",
    catalogueSearchLabel: "البحث في الكتالوج",
    catalogueManagement: "إدارة الكتالوج",
    catalogueResultsLabel: "المنتجات",
    productPriceNotSet: "لم يُحدَّد السعر",
    productNoCategory: "بلا تصنيف",
    productNoPhoto: "لا توجد صورة بعد",
    openProduct: "فتح المنتج",
    paginationPrevious: "الصفحة السابقة",
    paginationNext: "الصفحة التالية",
    paginationRange: "{from}–{to} من {total}",
    newDraftProductTitle: "مسودة منتج جديدة",
    newDraftProductSubtitle:
      "أنشئ النص بالإنجليزية والعربية. يجب اعتماد الترجمتين قبل أن يصبح المنتج متاحًا.",
    reload: "إعادة التحميل",
    variantSaved: "تم حفظ المتغيّر.",
    variantAdded: "تمت إضافة المتغيّر.",
    variantOrderUpdated: "تم تحديث ترتيب المتغيّرات.",
    variantDefault: "افتراضي",
    variantEnglishLabel: "التسمية بالإنجليزية",
    variantArabicLabel: "التسمية بالعربية",
    variantPriceLabel: "السعر (درهم)",
    variantSave: "حفظ المتغيّر",
    variantMakeDefault: "تعيينه افتراضيًا",
    variantMoveUp: "نقل إلى الأعلى",
    variantMoveDown: "نقل إلى الأسفل",
    variantArchive: "أرشفة المتغيّر",
    variantAddTitle: "إضافة متغيّر",
    variantPublicIdLabel: "المعرّف العام (اختياري)",
    variantsLoadError: "تعذّر تحميل المتغيّرات.",
    variantSaveError: "تعذّر حفظ المتغيّر.",
    variantCreateError: "تعذّر إنشاء المتغيّر.",
    variantReorderError: "تعذّرت إعادة ترتيب المتغيّرات.",
    modifierManageGroups: "إدارة المجموعات",
    modifierAttached: "تم ربط مجموعة الإضافات.",
    modifierDetached: "تم فصل مجموعة الإضافات.",
    modifierDetach: "فصل",
    modifierAttachGroupLabel: "ربط مجموعة",
    modifierSelectGroup: "اختر مجموعة إضافات",
    modifierAttach: "ربط",
    modifierLoadError: "تعذّر تحميل مجموعات الإضافات.",
    modifierAttachError: "تعذّر ربط مجموعة الإضافات.",
    modifierDetachError: "تعذّر فصل مجموعة الإضافات.",
    discardUnsavedProductTitle: "تجاهل التغييرات غير المحفوظة على مسودة المنتج؟",
    discardUnsavedProductDescription:
      "ستعود المسودة الحالية إلى آخر نسخة محفوظة.",
    discardUnsavedMenuTitle: "تجاهل التغييرات غير المحفوظة على مسودة القائمة؟",
    restoreToDraft: "استعادة كمسودة",
    restoring: "جاري الاستعادة…",
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
    // QOS-192 Phase 2 navigation and branch context
    recipes: "الوصفات",
    inventory: "المخزون",
    ingredientsAndStock: "المكونات والمخزون",
    kitchen: "تحضير المطبخ",
    sales: "إدخال المبيعات",
    reports: "التقارير",
    finance: "المالية",
    branches: "الفروع",
    branchSettings: "إعدادات الفروع",
    allBranches: "جميع الفروع",
    allBranchesHint: "عرض للاطلاع فقط على جميع فروعك",
    switchBranch: "تبديل الفرع",
    branchPickerLabel: "الفرع: {name}",
    branchStatusActive: "نشط",
    branchStatusSuspended: "معلّق",
    branchLoading: "جارٍ تحميل الفروع…",
    branchUnavailable: "الفروع غير متاحة",
    noBranches: "لا توجد فروع",
    noBranchesBody:
      "لا تتضمن عضويتك أي فرع بعد. اطلب الوصول من أحد المسؤولين.",
    branchFallbackNotice:
      "الفرع المطلوب غير متاح لك، لذلك يُعرض الفرع {branch} بدلًا منه.",
    dismiss: "إغلاق",
    unsavedWorkTitle: "هل تريد حفظ عملك قبل تبديل الفرع؟",
    unsavedWorkBody:
      "في هذه الشاشة تغييرات غير محفوظة للفرع {branch}. احفظها كمسودة، أو تجاهلها، أو ابقَ في هذا الفرع.",
    saveDraft: "حفظ المسودة",
    savingDraft: "جارٍ حفظ المسودة…",
    stay: "البقاء",
    unsavedWorkSaveFailed:
      "تعذّر حفظ المسودة. ما زالت تغييراتك هنا ولم يتغيّر الفرع.",
    phase2NotAvailableTitle: "هذا القسم غير متاح بعد",
    phase2BranchContext: "سياق الفرع: {branch}",
    inventoryDescription:
      "المكونات والوحدات والموردون ومستويات المخزون لكل فرع.",
    inventoryEmptyBody:
      "تصل البيانات الأساسية للمكونات مع المهام من QOS‑195 إلى QOS‑197، ويصل سجل المخزون مع المهمة QOS‑201. لم يُسجَّل أي شيء هنا بعد.",
    kitchenDescription: "أهداف التحضير وعمليات العدّ للفرع المحدد.",
    kitchenEmptyBody:
      "يصل تحضير المطبخ مع المهمتين QOS‑207 وQOS‑208. لا توجد أهداف تحضير أو عمليات عدّ بعد.",
    salesDescription: "إقفالات المبيعات اليومية المُدخلة لكل فرع ويوم عمل.",
    salesEmptyBody:
      "يصل إدخال المبيعات مع المهمتين QOS‑205 وQOS‑206. لم تُسجَّل أي إقفالات مبيعات بعد.",
    reportsDescription: "تقارير المخزون والاستهلاك والمبيعات من السجلات المعتمدة.",
    reportsEmptyBody:
      "تصل التقارير مع المهمتين QOS‑209 وQOS‑210. لا توجد بيانات تقارير بعد.",
    recipesDescription:
      "إصدارات الوصفات وأسطر المكونات والتكاليف لمنتجات الكتالوج.",
    recipesEmptyBody:
      "تصل الوصفات مع المهمتين QOS‑198 وQOS‑199. لا توجد وصفات بعد.",
    branchesSettingsDescription:
      "المواقع التي تشملها عضويتك، وأسماء فروع النشاط التجاري التي تنتظر التأكيد.",
    requestedBranchesTitle: "فروع النشاط التجاري المطلوبة",
    requestedBranchesBody:
      "أبلغ النشاط التجاري عن أسماء الفروع هذه. لم يُؤكَّد بعد أي موقع حالي في QOS يقابل كلًّا منها، لذلك يبقى كل اسم غير مربوط. لا يُعاد تسمية أي موقع أو إنشاؤه أو إسناده من جديد، ولا يُنقل أي سجل سابق.",
    columnBusinessBranch: "فرع النشاط التجاري",
    columnQosLocation: "موقع QOS",
    columnMapping: "الربط",
    notYetMapped: "لم يُربط بعد",
    noLocationConfirmed: "لم يُؤكَّد أي موقع",
    mappingPendingNote:
      "يتطلب الربط هويات المواقع الفعلية من المالك. سيُسجَّل الربط ويُوثَّق في سجل التدقيق عند إطلاق هذه الميزة، وحتى ذلك الحين لا يمكن تغيير أي شيء هنا.",
    permittedLocationsTitle: "المواقع المسموح لك بها",
    permittedLocationsAdminBody:
      "بصفتك مسؤولًا، يمكنك العمل في جميع مواقع هذا النشاط التجاري.",
    permittedLocationsUserBody: "هذه هي المواقع التي تشملها عضويتك.",
    columnLocation: "الموقع",
    columnTimezone: "المنطقة الزمنية",
    columnCurrency: "العملة",
    baseCurrencyNote:
      "العملة هي العملة الأساسية للنشاط التجاري، ولا توجد عملة خاصة بكل موقع.",
    branchesLoadError: "تعذّر تحميل الفروع.",
    branchLabelDubai: "دبي",
    branchLabelAlAin: "العين",
    // Business name as reported; no Arabic form was supplied.
    branchLabelAzurCafe: "Azur Cafe",
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
  Recipes: "recipes",
  Inventory: "inventory",
  "Ingredients and stock": "ingredientsAndStock",
  "Kitchen prep": "kitchen",
  "Sales input": "sales",
  Reports: "reports",
  Finance: "finance",
  Branches: "branches",
  "Branch settings": "branchSettings",
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

/** Every count phrase has an `other` form; the rest follow CLDR plural
 * categories. Arabic needs all six: the counted noun changes between 1, 2,
 * 3–10 (plural), 11–99 (singular accusative) and 100+ (singular genitive). */
export type StaffCountForms = Partial<Record<Intl.LDMLPluralRule, string>> & {
  other: string;
};

export const STAFF_COUNT_COPY = {
  en: {
    products: { one: "1 product", other: "{count} products" },
    productsActive: { one: "1 active", other: "{count} active" },
    productsDraft: { one: "1 draft", other: "{count} drafts" },
    productsArchived: { one: "1 archived", other: "{count} archived" },
    productsSearchMatch: { one: "1 product matches", other: "{count} products match" },
    searchProductsPlaceholder: { one: "Search 1 product", other: "Search {count} products" },
    modifierOptions: { one: "1 option", other: "{count} options" },
  },
  ar: {
    products: {
      zero: "لا توجد منتجات",
      one: "منتج واحد",
      two: "منتجان",
      few: "{count} منتجات",
      many: "{count} منتجًا",
      other: "{count} منتج",
    },
    productsActive: {
      zero: "لا توجد منتجات نشطة",
      one: "منتج نشط واحد",
      two: "منتجان نشطان",
      few: "{count} منتجات نشطة",
      many: "{count} منتجًا نشطًا",
      other: "{count} منتج نشط",
    },
    productsDraft: {
      zero: "لا توجد مسودات",
      one: "مسودة واحدة",
      two: "مسودتان",
      few: "{count} مسودات",
      many: "{count} مسودةً",
      other: "{count} مسودة",
    },
    productsArchived: {
      zero: "لا توجد منتجات مؤرشفة",
      one: "منتج مؤرشف واحد",
      two: "منتجان مؤرشفان",
      few: "{count} منتجات مؤرشفة",
      many: "{count} منتجًا مؤرشفًا",
      other: "{count} منتج مؤرشف",
    },
    productsSearchMatch: {
      zero: "لا توجد منتجات مطابقة",
      one: "منتج واحد مطابق",
      two: "منتجان مطابقان",
      few: "{count} منتجات مطابقة",
      many: "{count} منتجًا مطابقًا",
      other: "{count} منتج مطابق",
    },
    searchProductsPlaceholder: {
      zero: "ابحث في المنتجات",
      one: "ابحث في منتج واحد",
      two: "ابحث في منتجَين",
      few: "ابحث في {count} منتجات",
      many: "ابحث في {count} منتجًا",
      other: "ابحث في {count} منتج",
    },
    modifierOptions: {
      zero: "لا توجد خيارات",
      one: "خيار واحد",
      two: "خياران",
      few: "{count} خيارات",
      many: "{count} خيارًا",
      other: "{count} خيار",
    },
  },
} as const satisfies Record<StaffLocale, Record<string, StaffCountForms>>;

export type StaffCountKey = keyof (typeof STAFF_COUNT_COPY)["en"];

const PLURAL_RULES: Record<StaffLocale, Intl.PluralRules> = {
  en: new Intl.PluralRules("en"),
  ar: new Intl.PluralRules("ar"),
};

export function staffCount(locale: StaffLocale, key: StaffCountKey, count: number) {
  const forms: StaffCountForms = STAFF_COUNT_COPY[locale][key];
  const category = PLURAL_RULES[locale].select(count);
  return (forms[category] ?? forms.other).replace("{count}", String(count));
}

export function staffCopyWith(
  locale: StaffLocale,
  key: StaffUiCopyKey,
  values: Record<string, string | number>,
) {
  return Object.entries(values).reduce<string>(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    staffUiCopy(locale, key),
  );
}

export function staffProductsSearchPlaceholder(
  locale: StaffLocale,
  count: number,
) {
  return staffCount(locale, "searchProductsPlaceholder", count);
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
    return staffCount(locale, "productsSearchMatch", count);
  }

  switch (activeTab) {
    case "active":
      return staffCount(locale, "productsActive", count);
    case "draft":
      return staffCount(locale, "productsDraft", count);
    case "archived":
      return staffCount(locale, "productsArchived", count);
    default:
      return staffCount(locale, "products", count);
  }
}
