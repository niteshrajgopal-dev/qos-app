import type { StaffLocale } from "@/lib/staff/locale";

type Bilingual = Record<StaffLocale, string>;

const AUDIT_ACTION_LABELS: Record<string, Bilingual> = {
  "agent_run.requested": { en: "Assistant task requested", ar: "تم طلب مهمة من المساعد الذكي" },
  "agent_run.started": { en: "Assistant task started", ar: "بدأ المساعد الذكي مهمة" },
  "agent_run.completed": { en: "Assistant task completed", ar: "أكمل المساعد الذكي مهمة" },
  "agent_run.failed": { en: "Assistant task failed", ar: "تعذّر على المساعد الذكي إكمال مهمة" },
  "agent_run.awaiting_approval": {
    en: "Assistant task awaiting approval",
    ar: "مهمة المساعد الذكي بانتظار الموافقة",
  },
  "agent_run.wait_expired": {
    en: "Assistant task timed out",
    ar: "انتهت مهلة انتظار مهمة المساعد الذكي",
  },
  "agent_tool.invoked": { en: "Assistant tool used", ar: "تم استخدام أداة المساعد الذكي" },
  "ai_spend.reserved": { en: "AI budget reserved", ar: "تم حجز ميزانية الذكاء الاصطناعي" },
  "catalogue.category.assign_product": {
    en: "Product added to a category",
    ar: "تمت إضافة منتج إلى تصنيف",
  },
  "catalogue.category.create": { en: "Category created", ar: "تم إنشاء تصنيف" },
  "catalogue.category.reorder": { en: "Categories reordered", ar: "تمت إعادة ترتيب التصنيفات" },
  "catalogue.category.unassign_product": {
    en: "Product removed from a category",
    ar: "تمت إزالة منتج من تصنيف",
  },
  "catalogue.category.update": { en: "Category updated", ar: "تم تحديث تصنيف" },
  "catalogue.central_price.update": { en: "Central price updated", ar: "تم تحديث السعر الموحّد" },
  "catalogue.description.suggestion_accepted": {
    en: "Description suggestion accepted",
    ar: "تم قبول اقتراح الوصف",
  },
  "catalogue.description.suggestion_rejected": {
    en: "Description suggestion declined",
    ar: "تم رفض اقتراح الوصف",
  },
  "catalogue.import.apply": { en: "Catalogue import applied", ar: "تم تطبيق استيراد الكتالوج" },
  "catalogue.import.preview": {
    en: "Catalogue import previewed",
    ar: "تمت معاينة استيراد الكتالوج",
  },
  "catalogue.location_price.reset": { en: "Location price reset", ar: "تمت إعادة تعيين سعر الفرع" },
  "catalogue.location_price.set": { en: "Location price set", ar: "تم تحديد سعر خاص بالفرع" },
  "catalogue.media.ai_photo_accepted": { en: "AI photo accepted", ar: "تم قبول صورة الذكاء الاصطناعي" },
  "catalogue.media.ai_photo_failed": {
    en: "AI photo could not be created",
    ar: "تعذّر إنشاء صورة الذكاء الاصطناعي",
  },
  "catalogue.media.ai_photo_rejected": { en: "AI photo declined", ar: "تم رفض صورة الذكاء الاصطناعي" },
  "catalogue.media.ai_photo_requested": { en: "AI photo requested", ar: "تم طلب صورة بالذكاء الاصطناعي" },
  "catalogue.media.primary_photo_removed": { en: "Product photo removed", ar: "تمت إزالة صورة المنتج" },
  "catalogue.menu_extraction.cancelled": {
    en: "Catalogue menu extraction cancelled",
    ar: "تم إلغاء استخراج القائمة",
  },
  "catalogue.menu_extraction.rejected": {
    en: "Catalogue menu extraction cancelled",
    ar: "تم إلغاء استخراج القائمة",
  },
  "catalogue.menu_extraction.confirmed": {
    en: "Menu extraction confirmed",
    ar: "تم تأكيد استخراج القائمة",
  },
  "catalogue.menu_extraction.uploaded": {
    en: "Menu file uploaded for extraction",
    ar: "تم رفع ملف قائمة لاستخراجه",
  },
  "catalogue.menu_manager.suggestion_accepted": {
    en: "Menu Manager suggestion accepted",
    ar: "تم قبول اقتراح مدير القوائم",
  },
  "catalogue.menu.publish": { en: "Menu published", ar: "تم نشر القائمة" },
  "catalogue.modifier_group.attach": { en: "Modifier group attached", ar: "تم ربط مجموعة إضافات" },
  "catalogue.modifier_group.create": { en: "Modifier group created", ar: "تم إنشاء مجموعة إضافات" },
  "catalogue.modifier_group.detach": { en: "Modifier group detached", ar: "تم فصل مجموعة إضافات" },
  "catalogue.modifier_group.reorder_on_product": {
    en: "Modifier groups reordered",
    ar: "تمت إعادة ترتيب مجموعات الإضافات",
  },
  "catalogue.modifier_option.create": { en: "Modifier option created", ar: "تم إنشاء خيار إضافة" },
  "catalogue.modifier_option.reorder": {
    en: "Modifier options reordered",
    ar: "تمت إعادة ترتيب خيارات الإضافة",
  },
  "catalogue.product.archived": { en: "Product archived", ar: "تمت أرشفة منتج" },
  "catalogue.product.restored": { en: "Product restored", ar: "تمت استعادة منتج" },
  "catalogue.translation.approve": { en: "Translation approved", ar: "تم اعتماد ترجمة" },
  "catalogue.translation.reject": { en: "Translation declined", ar: "تم رفض ترجمة" },
  "catalogue.translation.request_cancelled": {
    en: "Translation request cancelled",
    ar: "تم إلغاء طلب ترجمة",
  },
  "catalogue.translation.suggestion_accepted": {
    en: "Translation suggestion accepted",
    ar: "تم قبول اقتراح ترجمة",
  },
  "catalogue.translation.suggestion_rejected": {
    en: "Translation suggestion declined",
    ar: "تم رفض اقتراح ترجمة",
  },
  "catalogue.variant.create": { en: "Variant added", ar: "تمت إضافة متغيّر" },
  "catalogue.variant.reorder": { en: "Variants reordered", ar: "تمت إعادة ترتيب المتغيرات" },
  "location.schedule.exception.delete": {
    en: "Opening-hours exception removed",
    ar: "تمت إزالة استثناء من مواعيد العمل",
  },
  "location.schedule.exception.upsert": {
    en: "Opening-hours exception saved",
    ar: "تم حفظ استثناء لمواعيد العمل",
  },
  "location.schedule.replace": { en: "Opening hours updated", ar: "تم تحديث مواعيد العمل" },
  "location.stop_sale.clear": { en: "Stop-sale lifted", ar: "تم رفع إيقاف البيع" },
  "location.stop_sale.create": { en: "Stop-sale started", ar: "تم إيقاف البيع" },
  "platform.business.provision": { en: "Business set up", ar: "تم إعداد النشاط التجاري" },
  "platform.location.add": { en: "Location added", ar: "تمت إضافة فرع" },
  "staff.access_request.approve": { en: "Access request approved", ar: "تمت الموافقة على طلب وصول" },
  "staff.access_request.reject": { en: "Access request declined", ar: "تم رفض طلب وصول" },
  "staff.membership.revoke": { en: "Staff access removed", ar: "تم سحب صلاحية موظف" },
  "staff.membership.role_change": { en: "Staff role changed", ar: "تم تغيير دور موظف" },
  "storefront.content_blocks_draft.save": {
    en: "Storefront content saved",
    ar: "تم حفظ محتوى واجهة المتجر",
  },
  "storefront.theme_draft.save": { en: "Storefront theme saved", ar: "تم حفظ مظهر واجهة المتجر" },
  "storefront.theme_draft.reset": {
    en: "Storefront theme reset",
    ar: "تمت إعادة تعيين مظهر واجهة المتجر",
  },
  "storefront.publish": { en: "Storefront published", ar: "تم نشر واجهة المتجر" },
  "storefront.rollback": {
    en: "Storefront rolled back",
    ar: "تمت استعادة إصدار سابق من واجهة المتجر",
  },
  "tenant_agent_binding.approved": { en: "AI assistant approved", ar: "تمت الموافقة على المساعد الذكي" },
  "tenant_agent_binding.enabled": { en: "AI assistant turned on", ar: "تم تفعيل المساعد الذكي" },
  "tenant_agent_binding.disabled": { en: "AI assistant turned off", ar: "تم إيقاف المساعد الذكي" },
};

const AUDIT_DOMAIN_LABELS: Record<string, Bilingual> = {
  catalogue: { en: "Catalogue updated", ar: "تم تحديث الكتالوج" },
  storefront: { en: "Storefront updated", ar: "تم تحديث واجهة المتجر" },
  location: { en: "Location updated", ar: "تم تحديث فرع" },
  platform: { en: "Business updated", ar: "تم تحديث النشاط التجاري" },
  staff: { en: "Team updated", ar: "تم تحديث فريق العمل" },
  agent_run: { en: "Assistant activity", ar: "نشاط المساعد الذكي" },
  agent_tool: { en: "Assistant activity", ar: "نشاط المساعد الذكي" },
  tenant_agent_binding: { en: "Assistant activity", ar: "نشاط المساعد الذكي" },
  ai_spend: { en: "AI budget updated", ar: "تم تحديث ميزانية الذكاء الاصطناعي" },
};

const AUDIT_ACTION_FALLBACK: Bilingual = { en: "Activity recorded", ar: "تم تسجيل نشاط" };

const AUDIT_ENTITY_LABELS: Record<string, Bilingual> = {
  agent_run: { en: "Assistant task", ar: "مهمة المساعد الذكي" },
  ai_spend_reservation: { en: "AI budget", ar: "ميزانية الذكاء الاصطناعي" },
  catalogue_category: { en: "Category", ar: "تصنيف" },
  catalogue_import_operation: { en: "Catalogue import", ar: "استيراد الكتالوج" },
  catalogue_media_asset: { en: "Product photo", ar: "صورة منتج" },
  catalogue_menu: { en: "Menu", ar: "قائمة" },
  catalogue_menu_extraction_source: { en: "Menu file", ar: "ملف قائمة" },
  catalogue_modifier_group: { en: "Modifier group", ar: "مجموعة إضافات" },
  catalogue_modifier_option: { en: "Modifier option", ar: "خيار إضافة" },
  catalogue_product: { en: "Product", ar: "منتج" },
  catalogue_variant: { en: "Variant", ar: "متغيّر" },
  location: { en: "Location", ar: "فرع" },
  location_price_override: { en: "Location price", ar: "سعر الفرع" },
  location_schedule_exception: { en: "Opening-hours exception", ar: "استثناء مواعيد العمل" },
  location_stop_sale: { en: "Stop-sale", ar: "إيقاف البيع" },
  product_translation: { en: "Translation", ar: "ترجمة" },
  staff_access_request: { en: "Access request", ar: "طلب وصول" },
  staff_membership: { en: "Staff member", ar: "موظف" },
  storefront: { en: "Storefront", ar: "واجهة المتجر" },
  storefront_release: { en: "Storefront release", ar: "إصدار واجهة المتجر" },
  tenant: { en: "Business", ar: "النشاط التجاري" },
  tenant_agent_binding: { en: "AI assistant", ar: "المساعد الذكي" },
};

const AUDIT_ENTITY_FALLBACK: Bilingual = { en: "Record", ar: "سجل" };

export function tenantAuditActionLabel(action: string, locale: StaffLocale = "en"): string {
  const label =
    AUDIT_ACTION_LABELS[action] ??
    AUDIT_DOMAIN_LABELS[action.split(".")[0] ?? ""] ??
    AUDIT_ACTION_FALLBACK;
  return label[locale];
}

export function tenantAuditEntityLabel(entityType: string, locale: StaffLocale = "en"): string {
  return (AUDIT_ENTITY_LABELS[entityType] ?? AUDIT_ENTITY_FALLBACK)[locale];
}
