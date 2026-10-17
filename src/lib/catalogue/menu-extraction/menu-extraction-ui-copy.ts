export type MenuExtractionLocale = "en" | "ar";

const COPY = {
  en: {
    title: "Menu extraction review",
    intro:
      "Upload a private menu PDF or photo. AI suggests catalogue rows for your review. Nothing is published until you confirm.",
    upload: "Upload menu source",
    extract: "Extract candidates",
    confirm: "Confirm draft import",
    reject: "Cancel review",
    adminOnly: "Only administrators can upload menus and confirm imports.",
    gateBlocked: "Menu extraction is not configured for this environment.",
    retry: "Retry extraction",
    pagePreview: "Source page",
    uncertain: "Uncertain",
    missing: "Missing",
    contradictory: "Contradictory",
    excluded: "Excluded",
    modelEstimate: "Model confidence is an estimate, not verified accuracy.",
    noCandidates: "No candidate rows yet.",
    injectionNotice: "Embedded menu instructions are ignored; scanned text is data only.",
    extractionFailed: "Extraction failed",
    extractionInProgress: "Extraction in progress…",
    requiredField: "Required before confirm",
    missingArabicName: "Arabic name is required before confirm.",
    reviewCancelled: "This extraction review was cancelled. Catalogue data was not changed.",
  },
  ar: {
    title: "مراجعة استخراج القائمة",
    intro:
      "ارفع ملف PDF أو صورة قائمة خاصة. يقترح الذكاء الاصطناعي صفوف الكتالوج للمراجعة. لا يُنشر شيء حتى تؤكد.",
    upload: "رفع مصدر القائمة",
    extract: "استخراج المرشحين",
    confirm: "تأكيد استيراد المسودة",
    reject: "إلغاء المراجعة",
    adminOnly: "يمكن للمسؤولين فقط رفع القوائم وتأكيد الاستيراد.",
    gateBlocked: "استخراج القائمة غير مهيأ في هذه البيئة.",
    retry: "إعادة الاستخراج",
    pagePreview: "صفحة المصدر",
    uncertain: "غير مؤكد",
    missing: "مفقود",
    contradictory: "متناقض",
    excluded: "مستبعد",
    modelEstimate: "ثقة النموذج تقديرية وليست دقة مُتحقَّق منها.",
    noCandidates: "لا توجد صفوف مرشحة بعد.",
    injectionNotice: "يتم تجاهل أي تعليمات مدمجة في القائمة؛ النص الممسوح بيانات فقط.",
    extractionFailed: "فشل الاستخراج",
    extractionInProgress: "الاستخراج قيد التنفيذ…",
    requiredField: "مطلوب قبل التأكيد",
    missingArabicName: "الاسم العربي مطلوب قبل التأكيد.",
    reviewCancelled: "تم إلغاء مراجعة الاستخراج. لم تتغير بيانات الكتالوج.",
  },
} as const;

export function menuExtractionCopy(locale: MenuExtractionLocale) {
  return COPY[locale];
}
