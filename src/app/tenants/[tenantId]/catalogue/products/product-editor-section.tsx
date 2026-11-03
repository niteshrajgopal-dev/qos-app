"use client";

import type { ReactNode } from "react";

import {
  staffUiCopy,
  type StaffLocale,
  type StaffUiCopyKey,
} from "@/lib/staff/locale";

import {
  productEditorSectionTestId,
  type ProductEditorSectionId,
} from "@/app/tenants/[tenantId]/catalogue/products/product-editor-sections";

type ProductEditorSectionProps = {
  id: ProductEditorSectionId;
  titleKey: StaffUiCopyKey;
  helperKey: StaffUiCopyKey;
  locale: StaffLocale;
  children: ReactNode;
};

export function ProductEditorSection({
  id,
  titleKey,
  helperKey,
  locale,
  children,
}: ProductEditorSectionProps) {
  return (
    <section
      className="qos-card min-w-0"
      data-padding="md"
      data-testid={productEditorSectionTestId(id)}
    >
      <h2 className="text-base font-medium text-zinc-900">
        {staffUiCopy(locale, titleKey)}
      </h2>
      <p className="mt-1 text-sm text-zinc-600">{staffUiCopy(locale, helperKey)}</p>
      <div className="mt-4 min-w-0">{children}</div>
    </section>
  );
}
