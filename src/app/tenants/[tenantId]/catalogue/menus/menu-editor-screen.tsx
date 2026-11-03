"use client";

import { MenuEditor } from "@/app/tenants/[tenantId]/catalogue/menus/menu-editor";
import { menusCopy } from "@/app/tenants/[tenantId]/catalogue/menus/menus-copy";
import {
  PortalArea,
  PortalPageHeader,
} from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { staffUiCopy } from "@/lib/staff/locale";

type MenuEditorScreenProps = {
  tenantId: string;
  menuPublicId?: string;
};

export function MenuEditorScreen({ tenantId, menuPublicId }: MenuEditorScreenProps) {
  const { locale } = useStaffLocale();

  return (
    <PortalArea>
      <PortalPageHeader
        back={{
          href: `/tenants/${tenantId}/catalogue/menus`,
          label: staffUiCopy(locale, "menus"),
        }}
        title={menusCopy(locale, menuPublicId ? "editMenuTitle" : "newMenuTitle")}
        description={menuPublicId ? undefined : menusCopy(locale, "newMenuDescription")}
        meta={
          menuPublicId ? (
            <span className="qosp-code" dir="ltr">
              {menuPublicId}
            </span>
          ) : undefined
        }
      />
      <MenuEditor tenantId={tenantId} menuPublicId={menuPublicId} />
    </PortalArea>
  );
}
