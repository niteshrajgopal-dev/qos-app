import dictionaryJson from "@/lib/workbook/qos-workbook-dictionary.v1.1.json";

/* QOS workbook field dictionary 1.1 (QOS-216, decision D-DICT): a compatible
   sidecar to the unchanged v1.0 contract. It declares the extra manifest
   fields and the Source Map sheet a source conversion writes, and classifies
   every column a source adapter fills. Parsing never promotes a field: no
   entry is `validated` or `persistable` in 1.1. */

export type CapabilityClass = "recognized" | "validated" | "persistable" | "deferred";

type CapabilityGroup = { sheet: string; class: CapabilityClass; owner: string; note?: string; columns: string[] };

type DictionaryFile = {
  dictionaryVersion: string;
  contractVersion: string;
  sourceProfiles: Array<{ id: string; version: number; headerDictionary: string; identity: string }>;
  extraContextFields: Array<{ field: string; rule: string }>;
  extraSheets: Array<{ name: string; table: string; read: "never" }>;
  capabilities: CapabilityGroup[];
  excluded: Array<{ item: string; reason: string }>;
};

export const WORKBOOK_DICTIONARY = dictionaryJson as DictionaryFile;
export const WORKBOOK_DICTIONARY_VERSION = WORKBOOK_DICTIONARY.dictionaryVersion;

export const EXTRA_CONTEXT_FIELDS = WORKBOOK_DICTIONARY.extraContextFields.map((entry) => entry.field);
export const EXTRA_SHEET_NAMES = WORKBOOK_DICTIONARY.extraSheets.map((entry) => entry.name);
export const EXTRA_TABLE_NAMES = WORKBOOK_DICTIONARY.extraSheets.map((entry) => entry.table);
export const SOURCE_MAP_SHEET = "Source Map";
export const SOURCE_MAP_TABLE = "QOS_Source_Map";

export type CapabilityEntry = { sheet: string; column: string; class: CapabilityClass; owner: string; note?: string };

export const CAPABILITIES: CapabilityEntry[] = WORKBOOK_DICTIONARY.capabilities.flatMap((group) =>
  group.columns.map((column) => ({
    sheet: group.sheet,
    column,
    class: group.class,
    owner: group.owner,
    ...(group.note ? { note: group.note } : {}),
  })),
);

/** Capability of a (sheet, column), matching `prefix:*` entries for open-ended fields such as channel prices. */
export function capabilityFor(sheet: string, column: string): CapabilityEntry | null {
  return (
    CAPABILITIES.find((entry) => entry.sheet === sheet && entry.column === column) ??
    CAPABILITIES.find(
      (entry) =>
        entry.sheet === sheet && entry.column.endsWith(":*") && column.startsWith(entry.column.slice(0, -1)),
    ) ??
    null
  );
}
