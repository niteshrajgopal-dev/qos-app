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
    <div className="qosp-stack">
      <h3 className="qosp-subcard-title">
        {staffUiCopy(locale, "removedPhotoHistoryTitle")}
      </h3>
      <ul className="qosp-history">
        {entries.map((entry) => {
          const sourceLabel = formatStaffMediaSourceLabel(entry.sourceProvenance, locale);
          const removedAt = formatStaffMediaTimestamp(entry.removedAt, locale);
          const removedBy = formatRemovedByLabel(entry, locale);
          const removedLine = [removedAt, removedBy].filter(Boolean).join(" · ");

          return (
            <li key={`${entry.assetPublicId}-${entry.removedAt}`}>
              <span className="qosp-photo" data-size="sm">
                {/* eslint-disable-next-line @next/next/no-img-element -- catalogue thumbnail */}
                <img src={publicProductThumbnailUrl(entry.assetPublicId)} alt="" />
                {entry.sourceProvenance === "ai_generated" ? (
                  <span className="qosp-photo-tag" title={staffUiCopy(locale, "aiGeneratedImageTitle")}>
                    AI
                  </span>
                ) : null}
              </span>
              <div className="qosp-history-body">
                {sourceLabel ? <p className="qosp-history-source">{sourceLabel}</p> : null}
                {removedLine ? (
                  <p className="qosp-meta-line">
                    {staffUiCopy(locale, "removedPhotoHistoryRemovedPrefix")} {removedLine}
                  </p>
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
