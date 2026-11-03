"use client";

import { useId, type ReactNode } from "react";

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
  const headingId = useId();

  return (
    <section
      className="qosp-editor-section qosp-glass"
      aria-labelledby={headingId}
      data-testid={productEditorSectionTestId(id)}
    >
      <h2 id={headingId} className="qosp-panel-title">
        {staffUiCopy(locale, titleKey)}
      </h2>
      <p className="qosp-panel-help">{staffUiCopy(locale, helperKey)}</p>
      <div className="qosp-panel-body">{children}</div>
    </section>
  );
}
