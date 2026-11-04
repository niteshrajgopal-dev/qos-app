# Quotes catalogue cleanup (2026-11)

A manual data script, run by the database owner, that archives the QA junk row and duplicate products in the
**Quotes** tenant. It is not a migration and nothing runs it automatically. It never deletes rows.

- `apply.sql` previews by default, and archives only when `qos.cleanup_mode=apply` is set.
- `rollback.sql` restores exactly the rows `apply.sql` archived, to the status they had before.

No schema change is needed. `qos.product_status` already includes `archived`, and the previous status is
recorded in an append-only `tenant_audit_events` row, which the rollback reads.

The script has **not** been run against any shared database. Its behaviour is covered by
`src/db/data-scripts/quotes-catalogue-cleanup.integration.test.ts`, which runs against a local Postgres
seeded with equivalent rows.

## What it touches

The script considers only non-archived `catalogue_products` in the tenant given by
`qos.cleanup_tenant_id`, and refuses to run unless that tenant is named `Quotes`. Products are matched
on their English display name, or on the internal name when there is no English name.

| Target              | Matches                                                                                  | Action                         |
| ------------------- | ---------------------------------------------------------------------------------------- | ------------------------------ |
| `formula_test_row`  | `=SUM(1,2)`, with or without the leading `'` a spreadsheet export adds; any case or spacing | Archive every match            |
| `single_espresso`   | `Single Espresso`, any case, with surrounding or repeated spaces ignored                | Keep one survivor, archive the rest |
| `flat_white`        | `Flat White` ignoring case and all spaces, so `Flat White` and `Flatwhite` are one group | Keep one survivor, archive the rest |

Look-alikes such as `Single Espresso Double`, and rows in any other tenant, are not matched.

### How the survivor is chosen

Within each duplicate group, rows are ranked by the following rules; the first rule that separates
two rows decides:

1. Referenced by a published menu. This checks the product's public id in
   `catalogue_menu_live_revisions.payload`, which is the same check the app uses before it allows an
   archive.
2. Referenced by a non-archived draft menu, through a non-archived section and section product.
3. Status `active` before `draft`.
4. The oldest `created_at`.
5. The lowest `public_id`, so the result is deterministic.

The top-ranked row is kept and the others are archived. A row that is in a published menu is never
archived:

- If two or more rows in a group are published, the whole group is reported as `skip_ambiguous` and
  left for a person to resolve.
- A published `=SUM(1,2)` row is reported as `skip_published` and kept.

### Expected effect on dev

Going by the QA report, a preview should list one `=SUM(1,2)` row to archive, two `Single Espresso`
rows (one kept), and `Flat White` plus `Flatwhite` (one kept). Whichever of each pair a live or draft
menu references is the one kept. **Check the preview output before applying**: it prints every
matched row with its public id, status, published and draft menu reference counts, `created_at`, the
decision, and the survivor.

## Running it

Run it as the database owner, using the owner's own connection URL. Do not use the application's
`DATABASE_URL`. Always preview first.

```bash
# 1. Preview (prints the plan, changes nothing)
PGOPTIONS="-c qos.cleanup_tenant_id=<quotes tenant uuid>" \
  psql "$OWNER_URL" -v ON_ERROR_STOP=1 -f apply.sql

# 2. Apply
PGOPTIONS="-c qos.cleanup_tenant_id=<quotes tenant uuid> -c qos.cleanup_mode=apply" \
  psql "$OWNER_URL" -v ON_ERROR_STOP=1 -f apply.sql

# 3. Rollback, if needed (preview first, the same way)
PGOPTIONS="-c qos.cleanup_tenant_id=<quotes tenant uuid> -c qos.cleanup_mode=apply" \
  psql "$OWNER_URL" -v ON_ERROR_STOP=1 -f rollback.sql
```

Each script runs in a single transaction, and sets `qos.current_tenant_id` locally so row-level
security limits it to that one tenant. Before committing, it checks that the number of changes equals
the number planned, and rolls everything back if they differ (for example, because a row was edited
during the run).

### What each change records

Every archived row has its `version` bumped, and gets a `catalogue.product.archived` audit event with:

- actor `data-script:quotes-catalogue-cleanup-2026-11`
- a correlation id shared by the whole run
- `change_summary` containing `previousStatus`, `reason` (the target) and `survivorPublicId`

Rollback writes a `catalogue.product.restored` event for each row it restores.

### Idempotency

- Running `apply.sql` again finds nothing left to archive, because archived rows are excluded.
- `rollback.sql` restores a row only if the script's latest event for it is an archive and the row is
  still archived at the version the script left it. Rows changed since then are reported as
  `skip_changed_since` and left alone, and running the rollback again restores nothing more.
