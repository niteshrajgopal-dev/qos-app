import type { MenuExtractionLocale } from "@/lib/catalogue/menu-extraction/menu-extraction-ui-copy";

const FAILURE_COPY: Record<
  string,
  { en: string; ar: string }
> = {
  provider_rejected_request: {
    en: "The vision service rejected this menu extraction request. Check the model allowlist and API credentials.",
    ar: "رفضت خدمة الرؤية طلب استخراج القائمة. تحقق من قائمة النماذج المسموحة وبيانات اعتماد واجهة البرمجة.",
  },
  model_not_supported: {
    en: "The configured model does not support vision or structured menu extraction. Use a vision-capable model such as gpt-4.1-mini or gpt-4o-mini.",
    ar: "النموذج المُهيأ لا يدعم الرؤية أو الاستخراج المنظم للقائمة. استخدم نموذجاً يدعم الرؤية مثل gpt-4.1-mini أو gpt-4o-mini.",
  },
  schema_rejected: {
    en: "The vision service rejected the menu extraction response schema. This is usually a configuration bug — contact support if it persists.",
    ar: "رفضت خدمة الرؤية مخطط استجابة استخراج القائمة. غالباً ما يكون ذلك خطأ إعداد — تواصل مع الدعم إذا استمر.",
  },
  provider_timeout: {
    en: "The vision service timed out. Try again with a smaller upload or fewer pages.",
    ar: "انتهت مهلة خدمة الرؤية. أعد المحاولة بملف أصغر أو صفحات أقل.",
  },
  provider_unavailable: {
    en: "The vision service could not be reached. Try again shortly.",
    ar: "تعذر الوصول إلى خدمة الرؤية. أعد المحاولة بعد قليل.",
  },
  model_submission_unknown: {
    en: "QOS could not confirm whether the model accepted this menu extraction.",
    ar: "تعذر على QOS التأكد من أن النموذج قبِل طلب استخراج القائمة.",
  },
};

export function menuExtractionFailureMessage(
  code: string | null | undefined,
  locale: MenuExtractionLocale,
  fallback: string | null | undefined,
) {
  if (!code) {
    return fallback ?? "";
  }
  const entry = FAILURE_COPY[code];
  if (!entry) {
    return fallback ?? code;
  }
  return locale === "ar" ? entry.ar : entry.en;
}
