import type { StaffMediaGenerationView } from "@/lib/media/ai-photos/staff-media-provenance";
import { formatStaffMediaGenerationSummary } from "@/lib/media/ai-photos/staff-media-provenance-format";
import { staffUiCopy, type StaffLocale } from "@/lib/staff/locale";

type AiPhotoProvenanceMetaProps = {
  locale: StaffLocale;
  generation: StaffMediaGenerationView | null | undefined;
};

export function AiPhotoProvenanceMeta({ locale, generation }: AiPhotoProvenanceMetaProps) {
  const summary = formatStaffMediaGenerationSummary(generation, locale);
  const prompt = typeof generation?.prompt === "string" ? generation.prompt : null;

  if (!summary && !prompt) {
    return null;
  }

  return (
    <div className="qos-menu-row-meta" style={{ whiteSpace: "normal" }}>
      {summary ? <div>{summary}</div> : null}
      {prompt ? (
        <div style={{ marginTop: summary ? 4 : 0 }}>
          <span className="sr-only">{staffUiCopy(locale, "aiPhotoPromptLabel")}</span>
          <span style={{ opacity: 0.85 }}>{prompt}</span>
        </div>
      ) : null}
    </div>
  );
}
