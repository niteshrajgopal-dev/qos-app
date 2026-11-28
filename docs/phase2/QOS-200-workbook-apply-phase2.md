# QOS-200 increment: workbook apply for the Phase 2 domains

This increment adds real apply handlers for the Phase 2 domain sheets to the QOS-217 apply engine (one engine, one unit transaction per unit, typed source links, revision guard, per-row history). Every write goes through the existing inventory and recipe services, so validation and audit are the same as in the inventory and recipe screens. QOS-200 stays open: prep targets and provider mappings wait for their services, and the menu column extensions (QOS-212 to QOS-215 columns) are the next increment.

Nothing in this path publishes a menu, approves a translation, approves a recipe version or posts stock. Recipes are always saved as draft versions. Opening stock is never applied by the import.

## Contract 1.5 and dictionary 1.2

`Units` and `Warehouses` have identity fields that are required and fixed after create (`inventory_units.code`, `name_ar`, `inventory_warehouses.code`) and had no 1.4 column, so contract 1.5 adds four columns, all `sinceVersion: "1.5"`:

| Sheet | Column | Use |
| --- | --- | --- |
| Units | `code` | Custom unit code, required for a custom unit, fixed after create |
| Units | `name_ar` | Arabic name, required for a custom unit |
| Units | `standard_code` | mg, g, kg, ml, cl, l or piece: adds the standard unit |
| Warehouses | `code` | Required on create, fixed after create |

The `mapping` text of every applied column now names the table and column it is written to; deferred columns keep a `Proposed …` mapping. Files of 1.0 to 1.4 are still read. Dictionary 1.2 classes the applied Phase 2 columns `persistable` and the rest of those sheets `deferred` with a plain owner; menu sheets keep their 1.1 classes. Owner texts carry no ticket ids.

## Order and identity

Contract sheet order is the apply order: menu sheets, then Units, Suppliers, Warehouses, Inventory Categories, Ingredients, Recipes, Recipe Lines, Prep Steps, Modifier Effects. An Ingredients unit saves the item, then its storage to recipe conversion, then its reference cost. Recipe Lines, Prep Steps and Modifier Effects are applied as one unit per recipe version, with one whole-list service call.

Typed source links (migration 0065 widens the entity CHECK) identify every new record by its workbook key: `unit`, `supplier`, `warehouse`, `inventory_category`, `inventory_item`, `recipe` (the family, by `recipe_key`), `recipe_version`, `recipe_line`, `prep_step`, `modifier_effect`. A key that is the record's own QOS id (an export row) needs no link, and one record keeps one key per namespace. Names only ever produce candidates.

## Per-sheet dispositions

| Sheet | Applied through | Applied columns | Deferred (owner) |
| --- | --- | --- | --- |
| Units | `createUnit` (standard or custom), `updateUnit` | code, name, name_ar, standard_code, quantity_kind (BATCH is read as pack), decimal_places, active | none |
| Suppliers | `createSupplier`, `updateSupplier` | name, contact_name, email, phone, reference (code), active, notes | none |
| Warehouses | `createWarehouse`, `updateWarehouse` | branch_key (fixed), code (fixed), name, active, notes | none |
| Inventory Categories | `createCategory`, `updateCategory` | name_en, name_ar, active | none |
| Ingredients | `createItem`, `updateItem`, `createConversion`/`reviseConversion`/`closeConversion`, `setReferenceCost`/`closeReferenceCost` | names, category, type, storage and recipe units, factor, default supplier, cost, currency, tax basis, effective date, source reference, active, notes | none |
| Recipes | `createRecipe`, `createDraftFromVersion`, `updateDraftVersion`, `updateRecipe`, `createSellableLink` | recipe_key, name, target_type, variant_key, prepared_ingredient_key, yield_quantity, yield_unit_key, notes | version_number (QOS assigns it), effective_from and effective_to (set by approval in the recipe editor) |
| Recipe Lines | `replaceDraftLines` | recipe_version_key, ingredient_key, quantity_recipe_units (in the ingredient's recipe unit), sort_order | notes (no line notes field) |
| Prep Steps | `replaceDraftSteps` | recipe_version_key, step_number, instruction | title, expected_minutes, checkpoint_required, notes (the step guide stores one instruction per language) |
| Modifier Effects | `replaceDraftEffects` | modifier_option_key, recipe_version_key, effect_type, target_recipe_line_key, ingredient_key, quantity_per_sold_unit, notes | none |
| Prep Targets | pending | none | whole sheet: the prep-target service is not built yet |
| External Mappings | pending | none | whole sheet: the POS connections service is not built yet |
| Opening Stock | never by this import | none | whole sheet: posted through its own intake with confirmation |
| Future Combos, Combo Components | rejected | none | Phase 3 |

Menu column extensions (product modifier assignment policy, channel prices, selling attributes, selling tax and reference-cost policy columns) stay deferred with the owner "Menu column extensions: next import increment".

## Rules worth knowing

- `active` is the status: FALSE on an existing active record archives it, TRUE on an archived one restores it, FALSE on a new row is refused (services create active records).
- A Units row is a standard unit when `standard_code` is set, or when its name is exactly a standard code or its English name (kg, Kilogram). Anything else is a custom unit and needs `code` and `name_ar`.
- Two standard units of one kind store no conversion; the factor must equal the standard one. A changed factor or cost is a new dated revision; identical values are a no-op. A blank cost stays unknown, never zero; `clear_fields: reference_cost_per_storage_unit` ends the current cost.
- Recipes (D4): a new family is created with version 1 as a draft. A row for an approved version never changes it: a draft is created from it and patched, and the row's key follows the draft. If the family already has an open draft, the row is Conflicting with that draft as the only candidate; choosing it makes the apply patch that draft. Lines, steps and effects of an approved version need their Recipes row in the same workbook, and go to the draft it makes in the same apply, whether the rows use QOS ids or workbook keys; each is matched to its copy on the draft (lines by ingredient, steps by number, effects by option, type and ingredient).
- Open drafts after an apply (review engine qos200.2): a retry of the same plan follows the draft that plan made, with no conflict, and its line, step and effect rows resolve to their copies on that draft. A new upload that reaches a draft made from an approved version (by key or by the approved version's id) shows the Recipes row Conflicting with that draft as the candidate, and its line, step and effect rows Blocked by it; choosing the draft resolves them all. A draft the import itself created as a new family's first version is simply followed, so re-uploading that file stays unchanged.
- Categories, variants, modifier groups and options have no draft state. A `draft` status on them (the blank template and the Foodics conversion write it) never changes an existing record, active or archived; restoring needs `active`, archiving `archived`. A blank status keeps the status.
- A Match existing decision on a row that ends Unchanged (for example `kg` matched to the existing standard unit) is remembered: apply links the workbook key to that record, so the next upload resolves it without asking again. A record already linked under another key keeps that key (one key per record), so a second key for it is asked again.
- A change the service refuses because other records still use the record (archiving a supplier that items use as their default, a category with active items, an ingredient on a recipe, a unit in use) fails that row with the reason and the count ("Used by 1 active item."), never as a concurrent change; the other rows still save.
- A sold variant's recipe link is created when the variant has none; a live link to another family or a direct-stock link is never replaced by an import. Direct-stock and shared links stay in the recipe editor.
- One active warehouse per branch: a second create at the same branch is Conflicting with the existing warehouse as candidate. A warehouse never moves branch.

## Past imports

`GET /api/tenants/{tenantId}/catalogue/workbook/applies?limit=20` lists the business's latest applies, newest first (limit 1 to 50): file name, status, start and finish times, counts and the actor's display name in this business (null when they are not a member here). Administrators only; read only; the raw user id is never returned. The import page shows them as "Past imports" and opens any of them with its per-row results through `GET …/plans/{planPublicId}`. The plan's own apply history shows names too.

## Out of this increment

Prep targets and fresh observations, provider mappings, opening stock intake, the menu column extensions, review-time prepared recipe cycle checks (the service refuses a cycle at apply, and the row stays reviewable) and the review-time modifier applicability check (the service refuses an option that is not assigned to a linked product, reviewable at apply).
