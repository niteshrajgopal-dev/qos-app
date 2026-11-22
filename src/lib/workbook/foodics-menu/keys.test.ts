import { describe, expect, it } from "vitest";

import { identityText, internalNameFor, keyFor, looseIdentity, normalizeIdentityText } from "@/lib/workbook/foodics-menu/keys";

describe("source identity and workbook keys", () => {
  it("normalises identity text without changing case or letters", () => {
    expect(normalizeIdentityText("  Flat   White ")).toBe("Flat White");
    expect(identityText("Flat White", "فلات وايت")).toBe("Flat White");
    expect(identityText("", " كرك ")).toBe("ar:كرك");
    expect(identityText("", "")).toBe("");
    // NFC: a decomposed é and a composed é are the same identity.
    expect(identityText("Café")).toBe(identityText("Café"));
  });

  it("derives readable, deterministic keys from identity text only", () => {
    const key = keyFor("prd", "Flat White");
    expect(key).toMatch(/^prd~flat-white~[0-9a-f]{8}$/);
    expect(keyFor("prd", "Flat White")).toBe(key);
    expect(keyFor("prd", "flat white")).not.toBe(key);
    expect(keyFor("cat", "Flat White")).not.toBe(key);
    expect(keyFor("prd", "ar:كرك")).toMatch(/^prd~[0-9a-f]{8}$/);
    expect(keyFor("prd", "A very long product name that goes past the slug limit")).toMatch(/^prd~[a-z0-9-]{1,32}~[0-9a-f]{8}$/);
  });

  it("keeps stable known values so keys never drift between releases", () => {
    expect(keyFor("prd", "Flat White")).toBe("prd~flat-white~45e955ba");
    expect(keyFor("cat", "ar:مشروبات خاصة")).toBe("cat~cb9ae49d");
  });

  it("builds internal names from English text, or falls back to the key", () => {
    expect(internalNameFor("Flat White (Large)", "prd~x")).toBe("flat-white-large");
    expect(internalNameFor("", "prd~x")).toBe("prd~x");
  });

  it("compares near duplicates loosely without deciding identity", () => {
    expect(looseIdentity("Flat White")).toBe(looseIdentity("flat-white"));
    expect(looseIdentity("Café")).toBe(looseIdentity("Cafe"));
    expect(looseIdentity("أسبريسو")).toBe(looseIdentity("اسبريسو"));
    expect(looseIdentity("قهـــوة")).toBe(looseIdentity("قهوة"));
    expect(looseIdentity("Latte")).not.toBe(looseIdentity("Lattes"));
  });
});
