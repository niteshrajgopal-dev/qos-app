import type { CatalogueImportColumnMapping } from "@/db/schema";

/* Form fields for the current-profile preview request (QOS-160 section
   1.13). The first preview of a file must not send a mapping: the server
   then suggests one from the file's headers and returns them. Sending the
   all-empty starting mapping made every first preview fail with "Column
   mapping for sourceId is required." and the mapping controls never
   appeared. Once the headers are known, the reviewed mapping is sent. */

export const LEGACY_MAPPING_FIELDS = [
  "sourceId",
  "internalName",
  "displayNameEn",
  "displayNameAr",
  "amountMinor",
  "currency",
] as const satisfies ReadonlyArray<keyof CatalogueImportColumnMapping>;

export function legacyPreviewFields(input: {
  connectionKey: string;
  /** Mapping reviewed by the person for this file, or null before the first preview. */
  mapping: CatalogueImportColumnMapping | null;
}): Array<[string, string]> {
  const fields: Array<[string, string]> = [["connectionKey", input.connectionKey.trim()]];
  if (input.mapping) {
    fields.push(["columnMapping", JSON.stringify(input.mapping)]);
  }
  return fields;
}

/** Fresh key for each preview attempt, so a different file or mapping never replays an earlier preview. */
export function newImportIdempotencyKey() {
  return crypto.randomUUID();
}
