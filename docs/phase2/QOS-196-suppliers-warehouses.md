# QOS-196 suppliers and branch warehouses

Migration `0061_inventory_suppliers_warehouses` (manual, apply after 0060) adds two tenant tables and one column. Both tables have forced RLS with a tenant policy and no DELETE grant.

| Table / column | Purpose |
| --- | --- |
| `inventory_suppliers` | Basic supplier identity, contact and reference: `name_en` (required), `name_ar`, `code` (optional reference, unique per tenant without case, editable), `contact_name`, `phone`, `email`, `address`, `notes`, `status`, `version`. Identity is `public_id`; names are not unique, so two suppliers with the same name stay two suppliers. No payment terms, tax or bank fields: payables are out of scope. |
| `inventory_warehouses` | One warehouse at one branch. `location_id` is a composite FK to `locations(tenant_id, id)`; `code` is unique per tenant without case and cannot change after create. A partial unique index allows one **active** warehouse per location; an archived warehouse keeps its location as history. |
| `inventory_items.default_supplier_id` | Composite FK to `inventory_suppliers(tenant_id, id)`. The supplier proposed on a direct receipt of the item. |

## Rules enforced by the service

- A warehouse's branch must be an existing, active location of the tenant. All Branches (`"all"`) and blanks are `location_required` (400); unknown or another tenant's location ids are `location_not_found` (404); a suspended location is `location_suspended` (400). The QOS-192 business labels are names, never location ids, so they cannot become a warehouse branch.
- A warehouse never moves: a different `locationPublicId` on PATCH is `location_immutable` (409) with `dependencies`. To change branch, archive and add a new warehouse there.
- Warehouse create, update, archive and restore write only `inventory_warehouses` and the audit event (with `location_id`). The location row is share-locked on create and never written.
- Archive only, for both tables. A supplier used as the default by an active item cannot be archived (`supplier_in_use`, 409, `dependencies: [{ kind: "inventory_items", count }]`).
- Writes are for administrators only. Reads: suppliers for every active member; warehouses for administrators, and for users only at branches in their `staff_location_scopes` (403 `branch_not_permitted` otherwise).

## Extension points (QOS-201/202/208)

- `warehouseDependencies` in `src/lib/inventory/warehouses.ts` returns `[]` today. QOS-201 adds stock movement and stock operation counts, QOS-208 prep targets. Archive (`warehouse_in_use`) and reassignment (`location_immutable`) already report its result.
- `supplierDependencies` in `src/lib/inventory/suppliers.ts` counts active items. QOS-202 adds direct receipts.
- `assertWarehouseBelongsToBranch` in `src/lib/staff/branch-context.ts` now checks that a server-loaded warehouse is active and at the branch returned by `assertOperationalBranch`.
- Movement snapshots (QOS-201) should quote the warehouse code; receipts (QOS-202) should snapshot the supplier name and code, because the supplier code is editable.

## Workbook contract (for QOS-200)

This PR does not change the workbook contract (still 1.4). `Suppliers` and `Warehouses` stay deferred sheets with their `Proposed …` mapping text, so `isDeferredField` keeps reporting them as deferred. The single 1.5 bump in QOS-200 should map:

- `Suppliers.supplier_key` / `qos_supplier_id` → `inventory_suppliers.public_id`; `name` → `name_en`; `contact_name`, `email`, `phone` → the same columns; `reference` → `code`; `active` → `status`; `notes` → `notes`.
- `Warehouses.branch_key` → through the Branches sheet to `locations.public_id`. The location must be active; an All Branches or unmapped business label row is rejected, never created. `name` → `name_en`; `active` → `status`. One active warehouse per branch is enforced by the index.
- `Ingredients.default_supplier_key` → `inventory_items.default_supplier_id`.
- Prep Targets and Opening Stock `warehouse_key` → `inventory_warehouses.public_id` (QOS-201/208).
