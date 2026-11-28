# QOS-197 ingredients, inventory categories and dated reference costs

An ingredient is an `inventory_items` row (QOS-195). There is no separate ingredients table. Migration `0062_inventory_categories_reference_costs` (manual, apply after 0061) adds two tenant tables and two columns. Both tables have forced RLS with a tenant policy and no DELETE grant.

| Table / column | Purpose |
| --- | --- |
| `inventory_categories` | Flat inventory categories: `name_en` (required), `name_ar`, `status`, `version`. Identity is `public_id` (`invcat_…`); a rename changes names only. A partial unique index allows one **active** category per tenant with a given English name (case and outer spaces ignored); archived categories keep their name as history. Separate from menu categories. |
| `inventory_items.category_id` | Optional composite FK to `inventory_categories(tenant_id, id)`, so an item can never point at another tenant's category. |
| `inventory_items.notes` | Preparation or procurement notes, at most 1000 characters. |
| `inventory_item_reference_costs` | Dated reference cost versions per item: `amount_micros` (exact, 6 decimal places of the major unit, never negative), `currency` (the tenant's base currency), `unit_id` (one of the item's designated units), `tax_basis` (`net`, `gross`, `unconfirmed`), `source` (`manual`, `supplier_quote`, `invoice`), `source_reference`, `effective_from`, `effective_to`, `revision`. Append-only: `qos_app` may update only `effective_to`. A partial unique index allows one current row (`effective_to IS NULL`) per item. |

## Rules enforced by the service

- **Unknown is not zero.** An item without a current cost row has an unknown cost: the API returns `referenceCost: { status: "unknown" }` with no amount field. A blank or missing amount is refused (`amount_required`); a known zero is only ever an explicit `"0"`.
- **Exact amounts.** Amounts are decimal strings with at most 6 decimal places, stored as integer micros. More precision is refused (`amount_too_precise`), never rounded. Nothing rounds to cents.
- **Derived per-unit cost.** `src/lib/inventory/cost-completeness.ts` expresses the current cost per storage unit and per recipe unit through the item's own conversion rules and the standard table (QOS-195). Exact values are shown exactly; a non-terminating value (for example 1/12) is rounded half-up to 6 places for display and flagged. When a designated unit cannot be reached the status is `known_not_convertible` and the reason is shown instead of a number.
- **No margin.** Nothing in inventory compares a cost with a price. `tax_basis = unconfirmed` is kept as a known amount with its basis; QOS-199 decides what it may be compared with.
- **History.** Setting a cost when one is current closes it on the new `effective_from` and inserts `revision + 1`. Clearing closes the current row with no successor: the item is unknown again from that date. Every version stays readable in `costHistory`. A new date can never be earlier than the current (or last ended) version.
- **Separate from other costs.** These are reference estimates for recipe costing. They are not stock valuation, purchase records or the catalogue product and modifier cost policies of QOS-215, which are untouched.
- **Categories.** Assigning an archived category is refused unless it is already the item's category. Archiving a category is refused while active items use it (`category_in_use`, 409, `dependencies: [{ kind: "inventory_items", count }]`); archived items keep the category as history. Restore is allowed when no other active category has the same English name.
- **Units.** A unit cannot be archived while a current reference cost is priced in it (`unit_in_use`, `usage.currentCosts`).
- **Prepared items** are definitions only. Saving one writes the item row and one audit event and posts nothing. Yields, components and production posting belong to recipes (QOS-198) and Phase 3.
- Writes are for administrators only; reads for every active member. Every write records a tenant audit event in the same transaction (`inventory.category.*`, `inventory.reference_cost.create|revise|close`).

## Extension points

- `itemDependencies` in `src/lib/inventory/items.ts` now returns the QOS-198 recipe dependencies (lines of open drafts and current or scheduled approved versions, live direct-stock links, the active prepared recipe that makes the item; see `QOS-198-recipes-and-sellable-links.md`). QOS-201 adds stock balances and movements; item archive reports the result (`item_in_use`).
- When QOS-201/202 value a movement they must snapshot the cost row id, amount, currency, unit and the conversion row used, so a later cost or conversion revision never reinterprets a posted value. Derived per-unit costs are computed live and never stored.
- A receipt-derived or average cost needs a separately approved policy and real receipts (QOS-202). Until then a blank cost stays unknown.

## Workbook contract (for QOS-200)

> Implemented by QOS-200 with contract 1.5: see [QOS-200-workbook-apply-phase2.md](QOS-200-workbook-apply-phase2.md) for the applied columns and dispositions.

This PR does not change the workbook contract (still 1.4). `Ingredients` and `Inventory Categories` stay deferred sheets. The single 1.5 bump in QOS-200 should map:

- `Inventory Categories.qos_inventory_category_id` → `inventory_categories.public_id`; `name_en` / `name_ar` → the same columns; `active` TRUE/FALSE → `status`.
- `Ingredients.qos_ingredient_id` → `inventory_items.public_id`; `inventory_category_key` → `category_id` (must resolve inside the tenant; a menu category name is not accepted); `ingredient_type` PURCHASED/PREPARED → `kind` in lower case (no production posting on import); `notes` → `notes`; `active` → `status`; `recipe_units_per_storage_unit` → a QOS-195 conversion.
- `reference_cost_per_storage_unit`, `cost_currency`, `cost_tax_basis` (upper case → lower case), `cost_effective_date` and `cost_source_reference` → **one** `inventory_item_reference_costs` row with `unit_id` = the storage unit, `source = manual` and the import's `provenance`. A **blank** cost creates **no row** (unknown), never zero and never an average. An amount with more than 6 decimals is rejected at validation, not rounded. A currency other than the tenant's is rejected.
