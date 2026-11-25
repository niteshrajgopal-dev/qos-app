import type { StaffLocale } from "@/lib/staff/locale";

/* QOS-195, QOS-196, QOS-197 and QOS-198 staff copy for inventory and recipe API error codes. The API message stays
   English for logs and API clients; the staff UI shows this copy instead. */

type Bilingual = Record<StaffLocale, string>;

export const INVENTORY_ERROR_COPY = {
  administrator_required: {
    en: "Only administrators can change inventory setup records.",
    ar: "يمكن للمسؤولين فقط تغيير سجلات إعداد المخزون.",
  },
  tenant_inactive: { en: "This business is not active.", ar: "هذا النشاط غير نشط." },
  body_invalid: { en: "The request could not be read. Try again.", ar: "تعذّرت قراءة الطلب. حاول مرة أخرى." },
  source_invalid: { en: "Choose a standard or a custom unit.", ar: "اختر وحدة قياسية أو مخصصة." },
  standard_code_unknown: { en: "Choose a standard unit from the list.", ar: "اختر وحدة قياسية من القائمة." },
  standard_code_taken: { en: "This standard unit has already been added.", ar: "أُضيفت هذه الوحدة القياسية بالفعل." },
  unit_code_taken: { en: "Another unit already uses this code.", ar: "يستخدم هذا الرمزَ وحدةٌ أخرى بالفعل." },
  code_invalid: {
    en: "Use 1 to 24 letters, digits, hyphens or underscores for the code, starting with a letter or digit.",
    ar: "استخدم للرمز من 1 إلى 24 حرفًا لاتينيًا أو رقمًا أو شرطة أو شرطة سفلية، يبدأ بحرف أو رقم.",
  },
  code_reserved_for_standard: {
    en: "This code belongs to a standard unit. Add it as a standard unit so its exact conversions apply.",
    ar: "هذا الرمز لوحدة قياسية. أضفها كوحدة قياسية لتنطبق تحويلاتها الدقيقة.",
  },
  name_required: { en: "Enter a name.", ar: "أدخل اسمًا." },
  name_too_long: { en: "This name is too long.", ar: "هذا الاسم طويل جدًا." },
  quantity_kind_invalid: { en: "Choose mass, volume, count or pack.", ar: "اختر كتلة أو حجمًا أو عددًا أو عبوة." },
  decimal_places_out_of_range: {
    en: "Decimal places must be a whole number from 0 to 6.",
    ar: "يجب أن تكون المنازل العشرية عددًا صحيحًا من 0 إلى 6.",
  },
  immutable_field: {
    en: "The code cannot change after the unit is created. Rename the unit instead.",
    ar: "لا يمكن تغيير الرمز بعد إنشاء الوحدة. أعد تسمية الوحدة بدلًا من ذلك.",
  },
  unit_in_use: {
    en: "This unit is used by an item, a current conversion, a current cost or a recipe and cannot be archived.",
    ar: "هذه الوحدة مستخدمة في صنف أو تحويل حالي أو تكلفة حالية أو وصفة ولا يمكن أرشفتها.",
  },
  unit_not_found: { en: "This unit was not found.", ar: "لم يتم العثور على هذه الوحدة." },
  unit_archived: {
    en: "Archived units cannot be used here. Restore the unit first.",
    ar: "لا يمكن استخدام الوحدات المؤرشفة هنا. استعد الوحدة أولًا.",
  },
  item_not_found: { en: "This item was not found.", ar: "لم يتم العثور على هذا الصنف." },
  item_archived: {
    en: "This item is archived. Restore it before using it or changing its conversions or cost.",
    ar: "هذا الصنف مؤرشف. استعده قبل استخدامه أو تغيير تحويلاته أو تكلفته.",
  },
  item_in_use: {
    en: "This item is still used by a recipe or a sellable link and cannot be archived or change kind.",
    ar: "هذا الصنف لا يزال مستخدمًا في وصفة أو ربط بيع ولا يمكن أرشفته أو تغيير نوعه.",
  },
  kind_invalid: { en: "Choose purchased or prepared.", ar: "اختر مشترى أو محضّر." },
  status_invalid: { en: "Choose active or archived.", ar: "اختر نشط أو مؤرشف." },
  factor_invalid: {
    en: "Enter the factor as a plain decimal number, for example 12 or 0.5.",
    ar: "أدخل المعامل كرقم عشري بسيط، مثل 12 أو 0.5.",
  },
  factor_not_positive: { en: "The factor must be greater than zero.", ar: "يجب أن يكون المعامل أكبر من صفر." },
  factor_too_precise: {
    en: "The factor can have at most 6 decimal places.",
    ar: "يمكن أن يحتوي المعامل على 6 منازل عشرية على الأكثر.",
  },
  same_unit: { en: "Choose two different units.", ar: "اختر وحدتين مختلفتين." },
  standard_pair_not_overridable: {
    en: "These standard units already convert exactly. The standard conversion cannot be overridden per item.",
    ar: "تتحول هاتان الوحدتان القياسيتان بدقة بالفعل. لا يمكن تجاوز التحويل القياسي لكل صنف.",
  },
  justification_required: {
    en: "A mass to volume rule needs a justification for this item, for example a measured density.",
    ar: "تحتاج قاعدة الكتلة إلى الحجم إلى مبرر لهذا الصنف، مثل كثافة مقاسة.",
  },
  justification_too_long: {
    en: "The justification can be at most 200 characters.",
    ar: "يمكن أن يتكون المبرر من 200 حرف على الأكثر.",
  },
  justification_invalid: { en: "Enter the justification as text.", ar: "أدخل المبرر كنص." },
  duplicate_pair: {
    en: "This item already has a current rule for these units. Change its factor instead.",
    ar: "لهذا الصنف قاعدة حالية لهاتين الوحدتين بالفعل. غيّر معاملها بدلًا من ذلك.",
  },
  already_derivable: {
    en: "These units already convert through another rule for this item.",
    ar: "تتحول هاتان الوحدتان بالفعل عبر قاعدة أخرى لهذا الصنف.",
  },
  conversion_not_found: { en: "This conversion was not found.", ar: "لم يتم العثور على هذا التحويل." },
  conversion_not_current: {
    en: "This version is no longer current. Reload to see the current rule.",
    ar: "لم يعد هذا الإصدار حاليًا. أعد التحميل لعرض القاعدة الحالية.",
  },
  expected_version_mismatch: {
    en: "This record changed elsewhere. Reload and try again.",
    ar: "تغيّر هذا السجل في مكان آخر. أعد التحميل وحاول مجددًا.",
  },
  expected_version_required: {
    en: "This record changed elsewhere. Reload and try again.",
    ar: "تغيّر هذا السجل في مكان آخر. أعد التحميل وحاول مجددًا.",
  },
  effective_from_invalid: { en: "Enter a valid date.", ar: "أدخل تاريخًا صحيحًا." },
  effective_from_before_current: {
    en: "The date cannot be earlier than the current version. History is not rewritten.",
    ar: "لا يمكن أن يسبق التاريخ الإصدار الحالي. لا يُعاد كتابة السجل.",
  },
  operation_invalid: { en: "The request could not be read. Try again.", ar: "تعذّرت قراءة الطلب. حاول مرة أخرى." },
  quantity_invalid: { en: "Enter the quantity as a plain decimal number.", ar: "أدخل الكمية كرقم عشري بسيط." },
  quantity_too_precise: {
    en: "This quantity has more decimal places than the unit allows.",
    ar: "تحتوي هذه الكمية على منازل عشرية أكثر مما تسمح به الوحدة.",
  },
  supplier_not_found: { en: "This supplier was not found.", ar: "لم يتم العثور على هذا المورّد." },
  supplier_archived: {
    en: "This supplier is archived. Restore it before choosing it.",
    ar: "هذا المورّد مؤرشف. استعده قبل اختياره.",
  },
  supplier_code_taken: {
    en: "Another supplier already uses this reference code.",
    ar: "يستخدم هذا الرمزَ المرجعي مورّدٌ آخر بالفعل.",
  },
  supplier_in_use: {
    en: "Items still use this supplier as their default. Clear it on those items first.",
    ar: "لا تزال أصناف تستخدم هذا المورّد كمورّد افتراضي. أزله من تلك الأصناف أولًا.",
  },
  text_too_long: { en: "This text is too long.", ar: "هذا النص طويل جدًا." },
  phone_invalid: {
    en: "Enter the phone number with digits, spaces, plus or hyphens only.",
    ar: "أدخل رقم الهاتف بأرقام ومسافات وعلامة زائد وشرطات فقط.",
  },
  email_invalid: { en: "Enter a valid email address.", ar: "أدخل بريدًا إلكترونيًا صحيحًا." },
  warehouse_not_found: { en: "This warehouse was not found.", ar: "لم يتم العثور على هذا المستودع." },
  warehouse_archived: { en: "This warehouse is archived. Restore it first.", ar: "هذا المستودع مؤرشف. استعده أولًا." },
  warehouse_code_taken: { en: "Another warehouse already uses this code.", ar: "يستخدم هذا الرمزَ مستودعٌ آخر بالفعل." },
  warehouse_code_immutable: {
    en: "The code cannot change after the warehouse is created. Rename the warehouse instead.",
    ar: "لا يمكن تغيير الرمز بعد إنشاء المستودع. أعد تسمية المستودع بدلًا من ذلك.",
  },
  warehouse_branch_taken: {
    en: "This branch already has an active warehouse. The pilot allows one per branch.",
    ar: "لهذا الفرع مستودع نشط بالفعل. يسمح التجريب بمستودع واحد لكل فرع.",
  },
  warehouse_in_use: {
    en: "This warehouse has stock history and cannot be archived.",
    ar: "لهذا المستودع سجل مخزون ولا يمكن أرشفته.",
  },
  location_required: {
    en: "Choose one branch. All branches cannot hold a warehouse.",
    ar: "اختر فرعًا واحدًا. لا يمكن لجميع الفروع أن تحتفظ بمستودع.",
  },
  location_not_found: { en: "This branch was not found.", ar: "لم يتم العثور على هذا الفرع." },
  location_suspended: {
    en: "This branch is suspended and cannot take a new warehouse.",
    ar: "هذا الفرع معلّق ولا يمكن إضافة مستودع له.",
  },
  location_immutable: {
    en: "A warehouse stays with its branch so stock history remains traceable. Archive it and add a warehouse at the other branch.",
    ar: "يبقى المستودع مع فرعه ليظل سجل المخزون قابلًا للتتبع. أرشفه وأضف مستودعًا في الفرع الآخر.",
  },
  category_not_found: { en: "This category was not found.", ar: "لم يتم العثور على هذه الفئة." },
  category_archived: {
    en: "This category is archived. Restore it before choosing it.",
    ar: "هذه الفئة مؤرشفة. استعدها قبل اختيارها.",
  },
  category_in_use: {
    en: "Active items are still in this category. Move or archive them first.",
    ar: "لا تزال أصناف نشطة في هذه الفئة. انقلها أو أرشفها أولًا.",
  },
  category_name_taken: {
    en: "Another active category already has this English name.",
    ar: "توجد فئة نشطة أخرى بهذا الاسم الإنجليزي بالفعل.",
  },
  amount_required: {
    en: "Enter an amount. A blank cost stays unknown; enter 0 only for a free item.",
    ar: "أدخل مبلغًا. تبقى التكلفة الفارغة غير معروفة؛ أدخل 0 فقط لصنف مجاني.",
  },
  amount_invalid: {
    en: "Enter the amount as a plain decimal number, for example 12.5.",
    ar: "أدخل المبلغ كرقم عشري بسيط، مثل 12.5.",
  },
  amount_negative: { en: "The amount cannot be negative.", ar: "لا يمكن أن يكون المبلغ سالبًا." },
  amount_too_precise: {
    en: "The amount can have at most 6 decimal places. It is not rounded.",
    ar: "يمكن أن يحتوي المبلغ على 6 منازل عشرية على الأكثر. لا يتم تقريبه.",
  },
  currency_not_supported: {
    en: "Only this business's currency is accepted.",
    ar: "تُقبل عملة هذا النشاط فقط.",
  },
  cost_unit_not_designated: {
    en: "A cost must be per the item's storage, recipe or purchase unit. Set those units first.",
    ar: "يجب أن تكون التكلفة لكل وحدة تخزين أو وصفة أو شراء للصنف. حدّد هذه الوحدات أولًا.",
  },
  tax_basis_invalid: { en: "Choose net, gross or unconfirmed.", ar: "اختر صافيًا أو شاملًا أو غير مؤكد." },
  cost_source_invalid: {
    en: "Choose manual estimate, supplier quote or invoice.",
    ar: "اختر تقديرًا يدويًا أو عرض سعر مورّد أو فاتورة.",
  },
  reference_cost_not_found: { en: "This cost was not found.", ar: "لم يتم العثور على هذه التكلفة." },
  reference_cost_not_current: {
    en: "This cost version is no longer current. Reload to see the current cost.",
    ar: "لم يعد إصدار التكلفة هذا حاليًا. أعد التحميل لعرض التكلفة الحالية.",
  },
  recipe_not_found: { en: "This recipe was not found.", ar: "لم يتم العثور على هذه الوصفة." },
  version_not_found: { en: "This recipe version was not found.", ar: "لم يتم العثور على إصدار الوصفة هذا." },
  recipe_archived: {
    en: "This recipe is archived. Restore it before changing or linking it.",
    ar: "هذه الوصفة مؤرشفة. استعدها قبل تغييرها أو ربطها.",
  },
  recipe_kind_invalid: { en: "Choose sellable or prepared.", ar: "اختر للبيع أو محضّرة." },
  recipe_kind_immutable: {
    en: "The kind and output item are fixed once a version has been approved. Create a new recipe instead.",
    ar: "يُثبَّت النوع والصنف الناتج بعد اعتماد أي إصدار. أنشئ وصفة جديدة بدلًا من ذلك.",
  },
  recipe_in_use: {
    en: "This recipe is still linked to sold variants. End those links first.",
    ar: "لا تزال هذه الوصفة مرتبطة بمتغيرات مباعة. أنهِ تلك الروابط أولًا.",
  },
  output_item_required: {
    en: "Choose the prepared item this recipe makes.",
    ar: "اختر الصنف المحضّر الذي تنتجه هذه الوصفة.",
  },
  output_item_not_prepared: {
    en: "The output of a prepared recipe must be a prepared item.",
    ar: "يجب أن يكون ناتج الوصفة المحضّرة صنفًا محضّرًا.",
  },
  output_item_taken: {
    en: "Another active recipe already makes this prepared item.",
    ar: "توجد وصفة نشطة أخرى تنتج هذا الصنف المحضّر بالفعل.",
  },
  output_item_not_allowed: {
    en: "A sellable recipe has no output item. Link it to sold variants instead.",
    ar: "لا صنف ناتجًا لوصفة البيع. اربطها بالمتغيرات المباعة بدلًا من ذلك.",
  },
  draft_exists: {
    en: "This recipe already has an open draft. Approve or discard it first.",
    ar: "لهذه الوصفة مسودة مفتوحة بالفعل. اعتمدها أو تجاهلها أولًا.",
  },
  version_not_draft: {
    en: "Approved versions are read-only. Create a draft from this version to change the recipe.",
    ar: "الإصدارات المعتمدة للقراءة فقط. أنشئ مسودة من هذا الإصدار لتغيير الوصفة.",
  },
  yield_required: {
    en: "Enter the yield and its unit before approving.",
    ar: "أدخل الناتج ووحدته قبل الاعتماد.",
  },
  yield_invalid: { en: "Enter the yield as a plain decimal number.", ar: "أدخل الناتج كرقم عشري بسيط." },
  yield_not_positive: { en: "The yield must be greater than zero.", ar: "يجب أن يكون الناتج أكبر من صفر." },
  yield_too_precise: {
    en: "The yield has more decimal places than its unit allows.",
    ar: "يحتوي الناتج على منازل عشرية أكثر مما تسمح به وحدته.",
  },
  quantity_not_positive: { en: "The quantity must be greater than zero.", ar: "يجب أن تكون الكمية أكبر من صفر." },
  line_item_required: { en: "Choose an item for every line.", ar: "اختر صنفًا لكل سطر." },
  duplicate_line_item: {
    en: "Each item can appear once per version. Enter the total quantity on one line.",
    ar: "يظهر كل صنف مرة واحدة في الإصدار. أدخل الكمية الإجمالية في سطر واحد.",
  },
  label_too_long: { en: "This label is too long.", ar: "هذا الوصف طويل جدًا." },
  lines_too_many: { en: "A recipe version can have at most 200 lines.", ar: "يمكن أن يحتوي إصدار الوصفة على 200 سطر على الأكثر." },
  line_not_found: {
    en: "This line was not found on the draft. Reload and try again.",
    ar: "لم يتم العثور على هذا السطر في المسودة. أعد التحميل وحاول مجددًا.",
  },
  step_not_found: {
    en: "This step was not found on the draft. Reload and try again.",
    ar: "لم يتم العثور على هذه الخطوة في المسودة. أعد التحميل وحاول مجددًا.",
  },
  step_text_required: { en: "Enter every step in English.", ar: "أدخل كل خطوة بالإنجليزية." },
  step_text_too_long: { en: "A step can be at most 1000 characters.", ar: "يمكن أن تتكون الخطوة من 1000 حرف على الأكثر." },
  steps_too_many: { en: "A recipe version can have at most 50 steps.", ar: "يمكن أن يحتوي إصدار الوصفة على 50 خطوة على الأكثر." },
  no_lines_to_approve: {
    en: "Add at least one ingredient line before approving.",
    ar: "أضف سطر مكوّن واحدًا على الأقل قبل الاعتماد.",
  },
  recipe_cycle: {
    en: "These lines would make a prepared item part of its own recipe.",
    ar: "ستجعل هذه الأسطر الصنف المحضّر جزءًا من وصفته نفسها.",
  },
  variant_not_found: { en: "This variant was not found.", ar: "لم يتم العثور على هذا المتغيّر." },
  variant_archived: {
    en: "This variant is archived and cannot be linked.",
    ar: "هذا المتغيّر مؤرشف ولا يمكن ربطه.",
  },
  product_archived: {
    en: "This product is archived and its variants cannot be linked.",
    ar: "هذا المنتج مؤرشف ولا يمكن ربط متغيراته.",
  },
  recipe_kind_not_sellable: {
    en: "A prepared recipe describes a prepared item and cannot be linked to a sold variant.",
    ar: "تصف الوصفة المحضّرة صنفًا محضّرًا ولا يمكن ربطها بمتغيّر مباع.",
  },
  link_kind_invalid: {
    en: "Choose a recipe link or a direct stock link.",
    ar: "اختر ربطًا بوصفة أو ربطًا مباشرًا بالمخزون.",
  },
  direct_stock_fields_required: {
    en: "A direct stock link needs an item, a quantity and a unit.",
    ar: "يحتاج الربط المباشر بالمخزون إلى صنف وكمية ووحدة.",
  },
  link_exists: {
    en: "This variant already has a link. Replace it or end it first.",
    ar: "لهذا المتغيّر ربط بالفعل. استبدله أو أنهِه أولًا.",
  },
  link_not_found: { en: "This link was not found.", ar: "لم يتم العثور على هذا الربط." },
  link_not_current: {
    en: "This link has already ended. Reload to see the current link.",
    ar: "انتهى هذا الربط بالفعل. أعد التحميل لعرض الربط الحالي.",
  },
  branch_not_permitted: { en: "Your membership does not include this branch.", ar: "لا تتضمن عضويتك هذا الفرع." },
} as const satisfies Record<string, Bilingual>;

export type InventoryErrorCode = keyof typeof INVENTORY_ERROR_COPY;

/** Staff copy for an API error code; unknown codes fall back to the generic save error. */
export function inventoryErrorText(locale: StaffLocale, code: string | null | undefined, fallback: string): string {
  if (code && code in INVENTORY_ERROR_COPY) {
    return INVENTORY_ERROR_COPY[code as InventoryErrorCode][locale];
  }
  return fallback;
}
