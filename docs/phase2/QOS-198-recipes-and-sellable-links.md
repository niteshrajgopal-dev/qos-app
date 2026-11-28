# QOS-198 versioned recipes, preparation steps and sellable links

Migration `drizzle/0063_recipes_and_sellable_links.sql` (journal idx 63, `when` 1793600000000; apply manually with the admin connection after 0062, before the matching image). Services in `src/lib/recipes/`, routes under `/api/tenants/[tenantId]/recipes`, UI at Catalogue > Recipes (`/tenants/[tenantId]/catalogue/recipes`).

## Model

- **Recipe family** (`recipes`): names, kind `sellable | prepared`, notes, status. A prepared family names exactly one active prepared `inventory_items` row as its output (one active family per output item). There is no separate ingredient or recipe-item table: lines point at `inventory_items`.
- **Versions** (`recipe_versions`): numbered per family, `draft | approved | discarded`, a whole-batch yield in an explicit unit, and a half-open business-date range `[effective_from, effective_to)` once approved. One open draft per family. Only a draft can change; editing an approved recipe always means "create a draft from this version". Approval ends the previous open-ended approved version on the new date, which must be strictly later than that version's date (so approved ranges never overlap) and writes an insert-only `recipe_version_snapshots` row.
- **Lines and steps** (`recipe_version_lines`, `recipe_version_steps`): ordered, replaced as a whole list, never deleted (removed rows keep `status = 'removed'`). Line quantities describe the whole stated yield. One item at most once per version. Steps: English required, Arabic optional.
- **Sellable links** (`recipe_sellable_links`): one table, append-only revisions per variant. `kind = recipe` points at a sellable family (many variants may share one family; nothing is copied); `kind = direct_stock` names an item, a per-sale quantity and a unit. At most one open link per variant (database index), so the two kinds are exclusive. Only `effective_to` is ever updated.

## Consumption resolution (read-only)

`resolveConsumption` (`src/lib/recipes/resolution.ts`) takes the sold variant and a business date: exactly one link live on the date, then exactly one approved version live on the date. Drafts and discarded versions are never candidates; two live approved versions or two live links are reported, never picked. Per-sale usage per line = line quantity ÷ yield × sales, as an exact rational, converted to the item's storage unit through that item's conversion rules live on the date and the standard table. A line with no conversion path carries no number (`missing_conversion`). A prepared item on a line is used as itself; its own recipe is not expanded. Weight-sold variants are not resolved. Nothing posts stock or production.

## Prepared recipes and cycles

Saving lines or approving a prepared recipe runs a depth-first search from its output item through the lines of other active prepared families (open drafts and approved versions that have not ended). A path back to the output item is refused with `recipe_cycle` and the item path.

## States, cost estimate, workbook profile

States are derived on the server (`states.ts`) and shown as badges. The current cost estimate (`cost-estimate.ts`) uses QOS-197 current reference costs; any line without a cost or a convertible cost makes the total unavailable with a count, never zero. It is not a snapshot and computes no price or margin; modifier effects, configuration cost and ingredient margin are in `QOS-199-modifier-effects-and-costing.md`. Shared and direct-stock links are labelled "Not in the workbook template"; a product flagged as a stock product (QOS-214) with no direct-stock link shows "Needs a direct-stock link" and the flag never creates a link.

## Dependencies

Item archive (and a prepared item's kind change) is refused while recipe lines, live direct-stock links or an active prepared family use it (`item_in_use` with `recipe_lines`, `sellable_links`, `recipe_outputs`). Unit archive counts recipe yields, lines and direct-stock links (`unit_in_use`). Recipe archive is refused while a live link points at the family (`recipe_in_use`). Archiving a catalogue variant is not blocked; the link then shows "Variant archived".

## Workbook mapping for QOS-200 (contract unchanged, 1.4)

> Implemented by QOS-200 with contract 1.5: see [QOS-200-workbook-apply-phase2.md](QOS-200-workbook-apply-phase2.md) for the applied columns and dispositions.

- `Recipes` row → one family plus one approved version (yield and unit required; `effective_from` from the sheet or the import date). A later row for the same family is a new version through the same approve path.
- `Recipe Lines` → lines on that version (whole-batch quantities; the unit must convert for the item or the row is reported deferred with `missing_conversion`). `Prep Steps` → steps (English required, Arabic when supplied).
- Product recipe rows (client workbook `L15:N…`) must name the variant, or the product must have exactly one active variant. A multi-variant product without a variant key stays pending with "Choose which variant this recipe belongs to"; one source recipe is never assigned to every variant by guesswork.
- Semi-finished rows (`I10:K…`) → a prepared family with the named prepared item as output and an explicit yield unit; cycles rejected at validation; no production posted.
- The stock-product flag may still be imported but creates no link; the variant stays "Needs a direct-stock link" until an administrator links an item, quantity and unit. Shared and direct-stock links stay UI-only and are listed in the export coverage notice.
