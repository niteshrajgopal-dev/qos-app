# QOS-216: Foodics menu workbook profile (`foodics_menu_v1`)

**Linear:** QOS-216 (parent QOS-155). **Status:** implemented on branch `niteshrajgopal/qos-216-p2-recognise-and-convert-the-client`; Nitesh retains merge and deployment decisions.

This page makes the assumed parts of the source adapter reviewable outside the code. The code is the source of truth:

- Layout and detection: `src/lib/workbook/foodics-menu/layout.ts`
- Header dictionary (source labels): `src/lib/workbook/foodics-menu/dictionary.v1.json`
- Reader and canonical mapping: `src/lib/workbook/foodics-menu/reader.ts`
- Converter: `src/lib/workbook/foodics-menu/convert.ts`
- Field dictionary 1.1 (capability classes): `src/lib/workbook/qos-workbook-dictionary.v1.1.json`

The client's original workbook (SHA-256 `2a73c4f1…e4cd3`) was not available while building this. Everything below that is not in the issue's verified regions is **ASSUMED** and is checked by `src/lib/workbook/foodics-menu/original.test.ts` once the original is placed in `/workspace/qos-phase2/private/` or `$QOS_216_SOURCE_XLSX` (never committed).

## Verified regions (from the issue)

| Region | Header | Example rows (skipped by position) | First input row | Identity roles |
| --- | --- | --- | --- | --- |
| Categories | F4:G4 | F5:G7 | F8 | name_en, name_ar |
| Products | D6:V6 | D7:V10 | D11 | name_en, name_ar |
| Ingredients | D7:J7 | D8:J17 | D18 | name_en, name_ar |
| Product recipe lines | L7:N7 | L8:N14 | L15 | product, ingredient |
| Modifiers | F8:O8 | F9:O12 | F13 | group_en, option_en |
| Modifier ingredient lines | R8:T8 | R9:T12 | R13 | option, ingredient |
| Product/group assignments | D6:I6 | D7:I8 | D9 | product, group |
| Prepared-item recipe lines | I6:K6 | I7:K9 | I10 | prepared_item, ingredient |

At most 1,000 rows are read per region. Typed identity text below that bound is refused (`too_many_rows`); formula prefill and formatting past it are ignored.

## Recognition

A region matches a sheet when every header cell in its range has text, every required role is found, and enough roles match. The profile is recognised when Categories and Products each match exactly one sheet and no region is half-present without a full match elsewhere. Ingredients and product recipe lines must share a sheet, as must modifiers and modifier ingredient lines. Anything in between is refused with `source_layout_partial` (moved, shifted, renamed or missing) or `source_layout_ambiguous` (on several sheets). A workbook with no region anchors falls through to the legacy flat profile as before.

Sheets that host no region are listed and never read. A sheet is classed `credentials` when its name is Users, User, Staff, Accounts or Logins, or a cell in rows 1–15 says password, PIN, passcode, PIN code, API token or secret; otherwise `guidance`.

## Header dictionary (ASSUMED labels)

Matching normalises the header (NFKC, lower case, `_ - /` as spaces, only Latin and Arabic letters, digits, `%` and spaces) and compares it with the aliases in `dictionary.v1.json`. Bilingual labels split on `/` or `|`. Position decides only between two headers for the same role. A header that matches nothing is reported (`source_column_unmapped`) and its values are kept in the Source Map as `unmapped:<header>`. In Products and Modifiers, a header that contains "price" and is not the base price becomes a channel price `channel_price:<label>`.

If the original's labels differ, add aliases to `dictionary.v1.json`; the algorithm does not change.

## Canonical mapping and capability classes

| Source | Canonical target | Class |
| --- | --- | --- |
| Category names | Categories | recognized |
| Product names, descriptions, SKU, barcode, calories, https image | Products | recognized |
| Product category | Product Categories (resolved inside the file) | recognized |
| Product base price | Variants.amount_minor (one default variant, exact minor units in the tenant currency) | recognized |
| Product tax | Variants.tax_rate_basis_points, price_tax_basis = UNCONFIRMED | deferred |
| Channel prices (products and options) | Source Map `channel_price:<label>`; no Branch Prices | deferred |
| Product cost, selling method, active flag, preparation time | Source Map values | deferred |
| Modifier groups and options, option price | Modifier Groups, Modifier Options | recognized |
| Option cost and calories | Source Map values | deferred |
| Assignments, min/max | Product Modifiers; group min/max when every assignment agrees | recognized |
| Free options | Product Modifiers.free_options_count | deferred |
| Ingredients, units, inventory categories | Ingredients, Units, Inventory Categories | deferred |
| Product and prepared-item recipe lines | Recipes, Recipe Lines (yield unit left blank) | deferred |
| Modifier ingredient lines | Modifier Effects (ADD; recipe version left blank) | deferred |

Nothing is `validated` or `persistable` in dictionary 1.1. QOS-194 owns validation and review; QOS-200 owns apply.

## Keys

`<prefix>~<slug>~<first 8 hex of SHA-256("foodics-menu-v1\0<prefix>\0<identity>")>`, where identity is the NFC, trimmed, space-collapsed English name, or `ar:` plus the Arabic name. Links use `~` (`<product_key>~default`, `<product_key>~<category_key>`). The source namespace is `foodics-menu-v1:<tenantPublicId>`. Exact duplicates block every copy; near duplicates are flagged and kept apart. A renamed record gets a new key; QOS-194 must ask for an explicit match.

## Open assumptions for Nitesh

1. Sheet names and every header label are assumed.
2. Example rows are assumed to be exactly the documented ranges.
3. Products width 19 and the Ingredients G/H formula columns are structural anchors; an added column fails explicitly.
4. Tax is assumed to be a percentage; a tax-group name is kept as text with `tax_unresolved`.
5. Product cost has no canonical column; it is preserved in the Source Map.
6. Converted rows use `action = create`; the alternative is `skip`.
7. Namespace format `foodics-menu-v1:<tenantPublicId>`.
8. Convert needs a brand when the tenant has several.
9. Arabic-Indic digits in numbers are accepted with a notice.
10. Prepared recipes have `yield_quantity = 1` and a blank yield unit.
11. Assignment min/max map to the group only when consistent.
