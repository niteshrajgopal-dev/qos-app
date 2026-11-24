# QOS-195 units, items and item conversions

Migration `0060_inventory_units_items_conversions` (manual) adds three tenant tables. All have forced RLS with a tenant policy and no DELETE grant.

| Table | Purpose |
| --- | --- |
| `inventory_units` | Tenant units. `code` is unique per tenant and cannot change after create. Renames change `name_en` / `name_ar` only; identity is `public_id`. `standard_code` links a row to the constants in `src/lib/inventory/standard-units.ts` (mg, g, kg, ml, cl, l, piece) with exact factors. `quantity_kind` is `mass`, `volume`, `count` or `pack`. `decimal_places` is 0–6. |
| `inventory_items` | The minimal item identity: names, kind (`purchased` / `prepared`), status, and the storage, recipe and purchase unit designations. QOS-196 adds `default_supplier_id`; QOS-197 extends this table with categories, dated costs and notes. |
| `inventory_item_conversions` | Item-scoped rules: one row means `1 from_unit = factor_micros / 1_000_000 to_unit` for one item. Rows are append-only versions. A revision closes the current row (`effective_to`) and inserts `revision + 1`. `qos_app` may update only `effective_to`. |

## Rules enforced by the service

- Factors are decimal strings greater than zero with at most 6 decimal places. They are stored as integer micros and computed as bigint rationals. Floats are never used.
- Two standard units of the same dimension (kg ↔ g) resolve from the standard table and cannot be overridden per item.
- Mass ↔ volume needs an explicit rule on the item with a justification. Nothing is inferred from names, codes or other items.
- One item's rules never apply to another item. Two items can each have `packet → piece` with different factors.
- A rule whose two units already convert for the item, through its rules or standard units, is refused (`already_derivable`). So is a second current rule for the same pair (`duplicate_pair`). Each item's rules therefore form a forest: no cycles and no conflicting paths.
- Writes are for administrators only (D14 assumption). Every write records a tenant audit event in the same transaction.

## Posted history (contract for QOS-201/202)

No stock movement exists yet. When a receipt, count or consumption is posted, the movement must store:

- the conversion row id it used (the version row, not the pair);
- a snapshot of the from code, the to code, `factor_micros` and `effective_from`.

A version row can change only in `effective_to`, so a posted quantity always traces back to the exact factor used. A later revision cannot reinterpret it.

## Precision and rounding (D5 assumption)

`decimal_places` applies to quantities in a unit: display, and input validation for later leaves through `assertQuantityPrecision`. It does not limit a conversion factor. The preview rounds half-up for display only and says when a shown value is rounded. The stored factor stays exact.

## Workbook contract (for QOS-200)

This PR does not change the workbook contract (still 1.4). `Units` stays a deferred sheet. The `Units` and `Ingredients` mapping text still reads "Proposed Phase 2/3 entity; no current schema table". `isDeferredField` keys off that `Proposed` prefix, so the text is left as it is until an apply path exists. QOS-200 should make one 1.5 bump that:

1. points the `Units` and `Ingredients` mappings at `inventory_units` and `inventory_items`;
2. exports `qos_unit_id` / `qos_ingredient_id` as the public ids;
3. maps `Ingredients.recipe_units_per_storage_unit` to a storage → recipe item conversion. A changed value goes through the revise operation (a new dated version), never a silent overwrite. A pair already resolved by standard units (kg → g = 1000) is checked against the standard factor and is not stored as a rule;
4. maps `quantity_kind` `BATCH` to `pack`;
5. requires `name_ar` for `Units` rows. Versions 1.0–1.4 stay readable.

Formula cells in the original workbook are not trusted conversion values. Every factor passes through the same validation as the staff editor.
