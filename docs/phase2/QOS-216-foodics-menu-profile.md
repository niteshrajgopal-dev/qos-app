# QOS-216: Foodics menu workbook profile (`foodics_menu_v1`)

**Linear:** QOS-216 (parent QOS-155). **Status:** implemented on branch `niteshrajgopal/qos-216-p2-recognise-and-convert-the-client`; Nitesh retains merge and deployment decisions.

This page makes the source adapter reviewable outside the code. The code is the source of truth:

- Layout and detection: `src/lib/workbook/foodics-menu/layout.ts`
- Header dictionary (source labels): `src/lib/workbook/foodics-menu/dictionary.v1.json`
- Reader and canonical mapping: `src/lib/workbook/foodics-menu/reader.ts`
- Converter: `src/lib/workbook/foodics-menu/convert.ts`
- Field dictionary 1.1 (capability classes): `src/lib/workbook/qos-workbook-dictionary.v1.1.json`

The client's original workbook (SHA-256 `2a73c4f19c98e35803b026038b08439a5f0f77070f88e59e4356623ded3e4cd3`) was inspected locally on 21 Nov 2026 (Asia/Dubai). It is never committed. `src/lib/workbook/foodics-menu/original.test.ts` re-checks it when the file is at `/workspace/qos-phase2/private/AZURCAFE CAFETERIA Menu Template .xlsx` or `$QOS_216_SOURCE_XLSX`. Business-entry sections of that file are empty; only documented example rows are populated, and those stay non-candidates. Header cells are Localization-sheet formulas: detection reads cached display text only and never evaluates formulas. Typed non-formula text is still required for business-row identity.

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

Sheets that host no region are listed and never read. A sheet is classed `credentials` when a name token is Users, User, Staff, Accounts or Logins (so `7- Users` on the original is an account sheet), or a cell in rows 1–15 says password, PIN, passcode, PIN code, API token or secret, including those labels when they are formula cached text; otherwise `guidance`. Credential cells are never copied into the parse result.

## Header dictionary

Matching uses the first meaningful header line (parenthetical help and `example:` copy are ignored), then normalises (NFKC, lower case, typo `languge`→`language` and `Preperation`→`preparation`, `_ - /` as spaces, only Latin and Arabic letters, digits, `%` and spaces) and compares it with the aliases in `dictionary.v1.json`. Bilingual labels split on `/` or `|`. Position decides only between two headers for the same role. A header that matches nothing is reported (`source_column_unmapped`) and its values are kept in the Source Map as `unmapped:<header>`.

In Products and Modifiers, a header that contains "price" and is not the base product/option price becomes a channel price `channel_price:<label>`. On the original file, `Product Price of Aggregator 1/2/3` and the same for option prices become `channel_price:aggregator 1` (and 2, 3). Those stay deferred. No Dubai, Al Ain, Azur, or other branch mapping is invented.

Observed product columns (D–V) and assignment columns (D–I) are in the dictionary. New deferred Source Map fields kept from the file, not promoted to persistable/validated: `is_stock_product`, `type_of_tax`, `walking_time`, `high_salt`, `allow_repeat`. Assignment `Minimum Modifier options (1=Mandatory, 0=Optional)` is the min; required is folded into that 0/1. Column I is “Can a customer order the same topping option twice?” and is deferred (`allow_repeat`, QOS-212).

## Canonical mapping and capability classes

| Source | Canonical target | Class |
| --- | --- | --- |
| Category names | Categories | recognized |
| Product names, descriptions, SKU, barcode, calories, https image | Products | recognized |
| Product category | Product Categories (resolved inside the file) | recognized |
| Product base price | Variants.amount_minor (one default variant, exact minor units in the tenant currency) | recognized |
| Product tax | Variants.tax_rate_basis_points; price_tax_basis = INCLUSIVE, EXCLUSIVE, or UNCONFIRMED | deferred |
| Channel prices (products and options, including Aggregator 1/2/3) | Source Map `channel_price:<label>`; no Branch Prices | deferred |
| Product cost, selling method, stock-product flag, active flag, preparation time, walking time, high salt | Source Map values | deferred |
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

## Settled from the original workbook (21 Nov 2026, Asia/Dubai)

1. Sheet names and header labels are now taken from the SHA-verified original. Detection still uses documented ranges and aliases, never the file name or a required sheet name.
2. Example-row ranges match the issue: categories F5:G7, products D7:V10, ingredients D8:J17, product recipes L8:N14, modifiers F9:O12, modifier recipes R9:T12, assignments D7:I8, prepared I7:K9. Data-start rows below those ranges are empty on the untouched original.
3. Products width 19 (D–V) and the Ingredients G/H formula columns (G18:H2148 prefilled, blank cached results, 0 typed business rows) are confirmed.
4. The tax% header shows examples `16%, 7%, 5%`, but example values are fractions such as `0.05` plus a `type of tax` column (`Inclusive` / `Exclusive`). A bare value in (0, 1] with no `%` is a fraction (0.05 → 500 basis points). Bare values greater than 1, and any value that already carries `%`, stay percentages. A tax-group name is still kept as text with `tax_unresolved`. Inclusive/Exclusive fills `price_tax_basis`; that field stays deferred.
5. A Product Cost column exists, with guidance that it is empty when cost comes from ingredients. It stays in the Source Map (QOS-215). It is not a persistable catalogue field in this ticket.
6. Prepared-item quantity is “required to produce 1 liter / 1 kg / batch”. There is no separate yield table. `yield_quantity` stays `1` and the yield unit stays blank; the unit is not invented from that help text.
7. Assignment min/max are group-level when every assignment agrees. Required is the min 0/1 rule. Column I (repeat topping) is deferred under QOS-212.
8. Aggregator 1/2/3 prices are unnamed sales-channel prices and stay deferred. Branch or city names are not inferred.

## Still open (not settled by the file)

1. Converted rows use `action = create`; the alternative is `skip`.
2. Namespace format `foodics-menu-v1:<tenantPublicId>`.
3. Convert needs a brand when the tenant has several.
4. Arabic-Indic digits in numbers are accepted with a notice.
