import { createHash } from "node:crypto";

/* Source identity and workbook keys for the Foodics menu profile (QOS-216,
   decision D-KEYS). A key is derived from the record's exact identity text,
   never from a row number, so the same file converts to the same keys on any
   machine and a key changes only when its source identity text changes. */

export const KEY_NAMESPACE = "foodics-menu-v1";

export type KeyPrefix = "cat" | "prd" | "grp" | "opt" | "ing" | "unit" | "invcat" | "rcp" | "eff";

/** NFC, trimmed, internal whitespace collapsed. Case and diacritics are kept: identity is exact. */
export function normalizeIdentityText(text: string) {
  return text.normalize("NFC").trim().replace(/\s+/g, " ");
}

/** Identity of a bilingual record: the English text, or the Arabic text marked `ar:` when English is blank. */
export function identityText(english: string, arabic = "") {
  const en = normalizeIdentityText(english);
  if (en) return en;
  const ar = normalizeIdentityText(arabic);
  return ar ? `ar:${ar}` : "";
}

function slugOf(identity: string) {
  const material = identity.startsWith("ar:") ? identity.slice(3) : identity;
  return material
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "");
}

/** `<prefix>~<slug>~<hash8>`, or `<prefix>~<hash8>` when the identity has no Latin letters or digits. */
export function keyFor(prefix: KeyPrefix, identity: string) {
  const hash = createHash("sha256").update(`${KEY_NAMESPACE}\0${prefix}\0${identity}`).digest("hex").slice(0, 8);
  const slug = slugOf(identity);
  return slug ? `${prefix}~${slug}~${hash}` : `${prefix}~${hash}`;
}

/** Lower-case `[a-z0-9-]` name for `internal_name`, or `fallback` when nothing Latin remains. */
export function internalNameFor(english: string, fallback: string) {
  return slugOf(normalizeIdentityText(english)) || fallback;
}

/**
 * Loose form used only to warn about near duplicates and to suggest a
 * candidate: case, diacritics, Arabic tatweel, hamza seats and punctuation are
 * ignored. It never decides identity.
 */
export function looseIdentity(text: string) {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ـ/g, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/[ئى]/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}
