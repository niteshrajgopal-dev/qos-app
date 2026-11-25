# QOS-199 modifier effects and recipe costing

Builds on QOS-198 (recipes, versions, links, resolution), QOS-212 (product modifier assignment policy), QOS-213 (sales channel prices), QOS-215 (selling tax and reference cost policies) and QOS-197 (ingredient reference costs). One migration: `drizzle/0064_recipe_modifier_effects.sql` (journal idx 64, `when` 1793700000000). Nothing here posts stock, production or consumption.

## Effects

`recipe_version_modifier_effects` holds what one selected modifier option does to one recipe version:

| Type | Target | Item, unit, quantity | Meaning |
| --- | --- | --- | --- |
| `add` | none | required | adds `quantity × q` of the item per sale |
| `remove` | a base line of the same version | none | subtracts that line's whole per-sale base contribution, once |
| `replace` | a base line of the same version | required | subtracts the line once, then adds `quantity × q` of the item |

`q` is the accepted option quantity. Effect quantities are per selection per sold unit, in the effect's unit, so they are not divided by the yield; base lines are (`quantity ÷ yield`). The target line is referenced by id through a composite FK (`tenant_id, recipe_version_id, id`), never by item or option name.

- Effects belong to one version and change only while it is a draft (`PUT …/versions/{v}/effects`, whole-list replace, removed rows kept as `removed`). Approved versions, their effects and their snapshots are immutable.
- Creating a draft from a version copies its active effects and points each `remove` / `replace` at the draft's copy of the same line (`recipe.version.create` audit gains `copiedEffects`). The draft shows a note to review them before approving.
- Removing a targeted base line from a draft, or switching it to another item, is refused (409 `line_targeted_by_effect`).
- Save-time rules: sellable recipes only; an active option whose group is attached to a product with a variant whose open (current or scheduled) link points at this recipe ("reviewed applicability"; the picker only offers these); item active; unit active and convertible to the item's storage unit today; quantity positive within the unit's decimals; one `remove`/`replace` per option per line and one `add` per option per item (also partial unique indexes); at most 100 effects.
- Approval refuses effects whose item or unit was archived since saving, and writes snapshot `schema: 2` with an `effects` array (option public id and names, type, target line, item, quantity, unit code). Existing `schema: 1` rows are untouched.
- Item archive counts active effects on live versions (`recipe_effects`); unit archive counts them in `recipeUsages`. A modifier group whose options any effect names cannot be hard-deleted (409 `modifier_options_in_recipe_effects`); archive it instead.

## Engine (`effects.ts`, pure)

1. Base = `resolveConsumption` (QOS-198). Unresolved reasons end the calculation.
2. Selections are validated per assigned group with the product's effective rules (`selectionRulesForAssignment` / `toEffectiveModifierGroupRules`) through `validateModifierGroupSelections`. With `defaults=auto`, a group with no selection gets its default options once, quantity 1; a default never joins an explicit selection. Rejections: `option_not_available`, `duplicate_selection`, `option_quantity_exceeds_cap`, `selection_required`, `selection_exceeds_max`, `group_rules_infeasible`.
3. Effects: an option with any `remove`/`replace` selected more than once → `repeat_not_allowed_for_effect`; two selected options removing or replacing the same line → `conflicting_effects`; a per-item total below zero → `negative_consumption`. Rejections carry no numbers; nothing is clamped.
4. An effect unit with no conversion on the date carries no number and the configuration is incomplete.

## Costing and margin (`costing.ts`, pure)

Each contribution is costed like a QOS-198 line (quantity → item's current cost unit × amount; removals negative). Exactly one method per component:

- Base: manual variant policy → manual amount (base lines not costed); recipe-derived or no policy → base lines.
- Option × q: manual option policy → amount × q (its effects still drive consumption, not cost); otherwise its effect contributions.
- Manual base + option with `remove`/`replace` and no manual option policy → `attribution_unavailable` (no total, no margin). Manual base + add-only option → base + added ingredients.

Unknown or unconvertible costs → `incomplete` with a count (never zero). Bases: all net → net, all gross → gross, any unconfirmed → unconfirmed, net with gross → mixed. Batch and per-output cost stay the QOS-198 estimate (per-output = per-batch ÷ yield; no yield, no per-output).

Price = central variant price, or the selected channel's row (inherited from central when none), plus option price deltas × q (central or the option's channel row). Option deltas are assumed to share the variant's selling tax basis. Margin = price − cost on one basis via `compareOnBasis` (shared with QOS-215 `referenceMargin`). Unavailable: `missing_price`, `option_currency_mismatch`, `zero_price`, `missing_selling_tax_basis`, `unconfirmed_selling_tax_basis`, `missing_tax_rate`, `cost_unavailable`, `attribution_unavailable`, `unconfirmed_cost_tax_basis`, `mixed_cost_tax_basis`, `currency_mismatch`, `cost_unit_not_each`. The Phase 1 checkout tax is never read. Copy calls it "ingredient margin", never profit.

Worked example (latte, yield 1; milk 200 ml at 4 AED/l, beans 18 g at 60 AED/kg, oat milk 9 AED/l, all net; 18.00 AED exclusive 5%): extra shot ×2 and oat milk ×1, sold 3 → beans 36 g per sale (0.108 kg), milk 0, oat 0.6 l; cost 3.96 per sale, 11.88 total; price 26.00; margin 22.04, 84.8% (rounded).

## Current estimates and history

Estimates use today's current reference costs and are never stored. Changing a cost or a policy changes only the live estimate; changing effects needs a new draft and approval, so an approved version's effects and its snapshot never diverge. Posting-time snapshots are QOS-206.

## Product editor

A variant with a recipe-derived policy now resolves through the engine for the base configuration (lines only, one sale, today, central price): `recipe_derived_computed` with amount, basis, recipe and version, or `recipe_no_link`, `recipe_no_version`, `recipe_incomplete`, `recipe_unresolved`. An unconfirmed or mixed ingredient basis shows the amount but no margin. An option's recipe-derived cost reads "computed per configuration in the recipe preview".

## `free_options_count`

Already satisfied, no change: populated cells are a deferred field in workbook review ("Kept for later, not applied"), block apply until acknowledged, are listed on the apply panel, and the capability matrix keeps them `apply: "unsupported"`, `scheduled: false` (test-protected). Free-option allowance pricing is not implemented.

## Workbook mapping for QOS-200 (contract unchanged, 1.4)

No apply handlers are added here. When QOS-200 imports the `Modifier Effects` sheet: `effect_key` → `public_id`; `modifier_option_key` → option; `recipe_version_key` → an open draft only (approved versions cannot take effects; such rows stay deferred with "create a draft first"); `effect_type` lower-cased; `target_recipe_line_key` → `target_line_id`; `ingredient_key` → `item_id`; `quantity_per_sold_unit` is in the item's recipe unit → `unit_id = recipe_unit_id` (rejected when the item has none); `notes`. Every rule above (applicability, single-selection, duplicates) applies to imported rows.

## Deferred

Modifier group editor effects panel; workbook apply handlers for effects; branch × channel margins; weight-sold variants; nested prepared-recipe explosion (a prepared item is costed at its own reference cost); stored estimate history; option-level tax basis; free-option allowances; combos; any posting.
