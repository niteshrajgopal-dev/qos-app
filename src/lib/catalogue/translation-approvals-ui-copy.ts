export type TranslationApprovalsLocale = "en" | "ar";

const COPY = {
  en: {
    intro:
      "These catalogue translations were accepted from AI review and still need administrator approval before publish.",
    loadError: "Unable to load translation approvals.",
    actionError: "Unable to update this translation.",
    staleConflict:
      "This translation changed elsewhere. Refresh the list and try again.",
    adminOnlyTitle: "Administrator access required",
    adminOnlyBody: "Only administrators can approve AI-assisted catalogue translations.",
    empty: "No AI translation drafts are waiting for approval.",
    refresh: "Refresh",
    loadQueue: "Load pending approvals",
    loading: "Loading…",
    sourceRevision: "English source revision",
    pendingRevision: "Pending revision",
    openProduct: "Open translation review",
    englishSource: "English source",
    proposedCopy: "Proposed translation",
    displayName: "Display name",
    description: "Description",
    version: "Version",
    lastApprovedVersion: "Last approved version",
    acceptedBy: "Accepted by",
    acceptedAt: "Accepted",
    approve: "Approve",
    reject: "Reject",
  },
  ar: {
    intro:
      "تم قبول هذه الترجمات من مراجعة الذكاء الاصطناعي وما زالت بحاجة إلى موافقة المسؤول قبل النشر.",
    loadError: "تعذّر تحميل موافقات الترجمة.",
    actionError: "تعذّر تحديث هذه الترجمة.",
    staleConflict: "تغيّرت هذه الترجمة في مكان آخر. حدّث القائمة وحاول مرة أخرى.",
    adminOnlyTitle: "يتطلب صلاحيات المسؤول",
    adminOnlyBody: "يمكن للمسؤولين فقط الموافقة على ترجمات الكتالوج المساعدة بالذكاء الاصطناعي.",
    empty: "لا توجد مسودات ترجمة بالذكاء الاصطناعي بانتظار الموافقة.",
    refresh: "تحديث",
    loadQueue: "تحميل الموافقات المعلقة",
    loading: "جاري التحميل…",
    sourceRevision: "مراجعة المصدر الإنجليزي",
    pendingRevision: "المراجعة المعلقة",
    openProduct: "فتح مراجعة الترجمة",
    englishSource: "المصدر الإنجليزي",
    proposedCopy: "الترجمة المقترحة",
    displayName: "اسم العرض",
    description: "الوصف",
    version: "الإصدار",
    lastApprovedVersion: "آخر إصدار معتمد",
    acceptedBy: "قُبلت بواسطة",
    acceptedAt: "تاريخ القبول",
    approve: "موافقة",
    reject: "رفض",
  },
} as const;

export function translationApprovalsCopy(locale: TranslationApprovalsLocale) {
  return COPY[locale];
}
