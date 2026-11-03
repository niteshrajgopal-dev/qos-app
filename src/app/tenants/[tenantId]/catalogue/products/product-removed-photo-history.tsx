import { AiPhotoProvenanceMeta } from "@/app/tenants/[tenantId]/catalogue/menus/ai-photo-provenance-meta";
import { publicProductThumbnailUrl } from "@/components/platform/catalogue-products-list";
import type { StaffRemovedPrimaryPhotoView } from "@/lib/media/ai-photos/staff-media-provenance";
import {
  formatStaffMediaSourceLabel,
  formatStaffMediaTimestamp,
} from "@/lib/media/ai-photos/staff-media-provenance-format";
import { staffUiCopy, type StaffLocale } from "@/lib/staff/locale";

type ProductRemovedPhotoHistoryProps = {
  locale: StaffLocale;
  entries: readonly StaffRemovedPrimaryPhotoView[];
};

function formatRemovedByLabel(
  entry: StaffRemovedPrimaryPhotoView,
  locale: StaffLocale,
): string {
  if (entry.removedByDisplayName) {
    return entry.removedByDisplayName;
  }
  return staffUiCopy(locale, "staffMemberLabel");
}

export function ProductRemovedPhotoHistory({ locale, entries }: ProductRemovedPhotoHistoryProps) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-zinc-900">
        {staffUiCopy(locale, "removedPhotoHistoryTitle")}
      </h3>
      <ul className="space-y-3" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {entries.map((entry) => {
          const sourceLabel = formatStaffMediaSourceLabel(entry.sourceProvenance, locale);
          const removedAt = formatStaffMediaTimestamp(entry.removedAt, locale);
          const removedBy = formatRemovedByLabel(entry, locale);
          const removedLine = [removedAt, removedBy].filter(Boolean).join(" · ");

          return (
            <li key={`${entry.assetPublicId}-${entry.removedAt}`} className="flex flex-wrap items-start gap-3">
              <span className="qos-thumb" data-size="lg">
                {/* eslint-disable-next-line @next/next/no-img-element -- catalogue thumbnail */}
                <img src={publicProductThumbnailUrl(entry.assetPublicId)} alt="" />
                {entry.sourceProvenance === "ai_generated" ? (
                  <span className="qos-thumb-tag" title={staffUiCopy(locale, "aiGeneratedImageTitle")}>
                    AI
                  </span>
                ) : null}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                {sourceLabel ? (
                  <div className="text-sm text-zinc-700">{sourceLabel}</div>
                ) : null}
                {removedLine ? (
                  <div className="qos-menu-row-meta" style={{ whiteSpace: "normal" }}>
                    {staffUiCopy(locale, "removedPhotoHistoryRemovedPrefix")} {removedLine}
                  </div>
                ) : null}
                <AiPhotoProvenanceMeta locale={locale} generation={entry.generation} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
