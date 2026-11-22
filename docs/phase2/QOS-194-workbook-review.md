# QOS-194 — Validate and preview workbook changes

Status: implemented on `niteshrajgopal/qos-194-p2-validate-and-preview-workbook`, stacked on PR #93 (QOS-216).
Review only: nothing in this leaf creates, changes or links a catalogue record. Apply is QOS-217.

## What it does

`POST /api/tenants/{tenantId}/catalogue/workbook/preview` reviews an uploaded QOS workbook (`qos_extended_v1`) or the client's Foodics menu workbook (`foodics_menu_v1`) against the tenant's current records and stores the outcome as a **workbook import plan**. The catalogue import screen shows it in a review panel.

```
upload → parse (#93, stateless) → toReviewInput → snapshot (reads only) → reviewWorkbook (pure) → plan (0055)
```

Module: `src/lib/workbook/validation/`

| File | Role |
| --- | --- |
| `input.ts` | One normalised `ReviewInput` from either profile; context rejection. Foodics is reviewed from the in-memory canonical rows after `assertConvertible`, never from a converted file. |
| `snapshot.ts` | The tenant's records in export vocabulary (`loadCurrentRecordExport`), permitted and all branch ids, product source links for the namespace, business profile, `snapshotHash`. `restrictSourceToScope` re-checks a plan in its own branch scope. |
| `types.ts` | Strict cell parsers. Nothing is coerced, truncated or rounded. |
| `actions.ts` | Per-sheet action matrix (service exists ⇒ supported). |
| `identity.ts` | Name scopes, candidates, labels. Names never decide identity. |
| `graph.ts` | References, link identity by verified endpoints, blocking propagation. |
| `rules.ts` | Typing, conditional inputs, deferred values (tax with source text), service-parity validation. |
| `capability.ts` | Field decisions: validated / deferred / rejected / mechanics. |
| `review.ts` | The engine (`REVIEW_ENGINE_VERSION = "qos217.1"` after QOS-217). |
| `plan-hash.ts`, `plan-repository.ts`, `service.ts` | Hash, persistence, orchestration. |
| `correction-report.ts` | XLSX correction report from a stored plan. |

## Classification

Every row is exactly one of: **Create, Update, Unchanged, Skipped, Conflicting, Invalid, Blocked, Unsupported**.

- **Identity** comes only from a QOS id (`qos_*_id`, or the key itself in the `qos:<tenant>` export namespace), a product source link (`catalogue_import_source_links`, connection key = namespace), a stored operator decision, or — for link rows — both endpoints being verified records. A create row with a name colliding (case, diacritics, Arabic letter forms ignored) with an existing record in scope is **Conflicting** with candidates; an update row without identity is Conflicting (if names match) or Invalid. Foodics keys (`foodics-menu-v1:<tenant>`) are never verified, so a reimport over an existing catalogue is Conflicting wherever names collide and never a silent Create or Update.
- **Existing multi-variant products** require a reviewed target per Variants row (`variant_target_required`); values are never fanned out. Exactly one default variant per product across workbook rows and untouched existing variants (`default_variant_conflict`).
- **Revision**: `expected_revision` different from the current record ⇒ Conflicting `stale_revision` (decision `accept_current_revision` rebinds). Blank ⇒ the current token is bound into the plan row (`revision_bound_at_review`) and QOS-217 re-checks it.
- **Converted rows** (with Foodics provenance) compare only the columns that came from a source cell when they update an existing record. Conversion defaults (`status = draft`, `sort_order`, `is_default`, …) never overwrite existing values; on create they are proposed as usual.
- **Blocking**: a proposed row whose referenced row is Invalid, Conflicting, Blocked, Unsupported or excluded is Blocked and points at the responsible row; that row lists what it blocks. Deferred-sheet rows never block supported rows (menu first).
- **Service parity**: proposed creates and updates are run through the catalogue validators the services call (`validateCreateDraftProductInput`, `validateCreateCategoryInput`, …); a refusal is Invalid `service_validation`.

### Strict types and semantics

| Value | Rule |
| --- | --- |
| `money_minor` | ASCII whole minor units only (`1250`); `12.50`, `1,250`, `1250.0`, `1e3`, `+5`, `-5`, Arabic-Indic digits ⇒ `malformed_minor_units`. |
| integers | whole numbers, contract `min`/`max`; `tax_rate_basis_points` 0..10000 (deferred, warning only). |
| enums, booleans | contract values, case-insensitive, normalised with an info note. |
| currency | must equal the tenant's base currency. |
| blank | on create a required blank is an error; on update it keeps the current value. `0` is a real zero, `FALSE` a real false. |
| `clear_fields` | only optional data columns, never with a value in the same row, never on create; the diff shows `before → (cleared)`. |
| omitted rows | do nothing; a review never proposes deletion. |
| `archive` | needs a verified target; the default variant cannot be archived. `archived → draft/active` is a restore. |
| `remove_link` | needs the link id or both verified endpoints. |
| `reset_to_central` | needs an existing branch price for a verified variant and permitted branch. |
| status → `active` | an ordinary field update; it never approves translations or publishes a menu (`status_not_approval`). |

### Action matrix

| Sheet | create | update | archive | remove_link | reset_to_central | skip |
| --- | --- | --- | --- | --- | --- | --- |
| Branches | unsupported (Settings → Branches) | unsupported | — | — | — | anchor |
| Categories, Products, Variants, Modifier Groups, Modifier Options, Menus, Menu Sections, Menu Items | yes | yes | yes | — | — | yes |
| Product Categories, Product Modifiers, Menu Branches | yes | yes | — | yes | — | yes |
| Branch Prices | yes | yes | — | — | yes | yes |
| Deferred sheets (Units … External Mappings) | unsupported with owner | | | | | |
| Future Combos, Combo Components | unsupported (Phase 3) | | | | | |

### Deferred values

Deferred columns on supported sheets (`price_tax_basis`, `tax_rate_basis_points`, `free_options_count`) and values a source adapter kept beside the canonical columns (channel prices, product cost, selling method, …) are stored on each plan row in `deferred_fields` with their owner from dictionary 1.1. They are never counted as changes. Tax keeps its source text: `0.05` ⇒ 500 basis points (5%). Acknowledgement is required per sheet and column before the review is complete.

## Persisted plan (migration 0055)

`qos.workbook_import_plans` (header) and `qos.workbook_import_plan_rows` (one row per workbook row), RLS enabled and forced, tenant isolation policies, `SELECT, INSERT, UPDATE` for `qos_app` (no `DELETE`). Down script in the migration header. Rows store the input values and provenance, so a re-review never needs the file again.

`plan_hash = sha256(stable JSON { engine version, tenant, brand, namespace, profile, file fingerprint, source sha, created by + role, reviewed by, branch scope, snapshot hash, rows (sheet,row,key,classification,operation,target,target revision,after,deferred), decisions })`.

- A changed record changes its revision token ⇒ `snapshotHash` differs ⇒ `GET plan` reports `stale: true` and flips `status` to `stale` (the only write on read). A viewer who cannot see the plan's whole branch scope gets the stored status.
- `POST plans/{id}/review` requires `expectedPlanHash` equal to the stored hash (409 `plan_hash_mismatch` otherwise), recomputes everything from stored rows and the current snapshot, bumps `revision`, resets `status` to `review_ready`. Only the creator or an administrator (403 `plan_not_yours`).
- `Idempotency-Key` is required on preview; the same key and file replays the stored plan (`replayed: true`); the same key with another file is 409 `idempotency_key_reused`.

### Contract for QOS-217

Delivered by QOS-217: apply a `review_ready` plan after recomputing `plan_hash` with `hashReview`, through real catalogue services, with typed source links, audit events, per-unit rollback and resumable `apply_failed` retry via re-review. See the QOS-217 apply module and migration 0058.

1. Load the plan by public id inside the tenant context; require `status = review_ready`.
2. Rebuild the snapshot for the plan's brand and branch scope, recompute `planHash` with `hashReview` over the stored rows and decisions, and require equality with the stored `plan_hash` and with the hash the client sends.
3. Re-check the actor's membership and role.
4. Apply rows in graph order (contract sheet order), only `create`/`update` classifications, using each row's `operation`, `after`, `target_public_id`, and re-reading `target_revision` per row immediately before mutating.
5. Deferred values are on each row for QOS-212–215 handlers. QOS-217 may widen the status CHECK (`applying`, `applied`, `failed`) and add typed source links.

## API

| Route | Notes |
| --- | --- |
| `POST …/workbook/preview` | multipart `file`, optional `brand`, `branch` (narrowing; 403 outside scope), `decisions` (JSON); header `Idempotency-Key`. 409 `review_context_rejected` for another tenant/brand/namespace/source profile (nothing stored); 400 `review_unsupported_profile` for the current flat profile. |
| `GET …/workbook/plans/{planPublicId}` | stored plan with `stale`. |
| `POST …/workbook/plans/{planPublicId}/review` | JSON `{ expectedPlanHash, decisions }`. |
| `GET …/workbook/plans/{planPublicId}/correction-report?locale=en|ar` | XLSX: Corrections (one row per error or warning), Summary, Context. |

Auth as parse/convert/export: 401 without a session; 404 for another, unknown or malformed tenant and for another tenant's plan; 403 `tenant_inactive` and for branches outside the scope. Any active member may preview; viewing a plan or its report needs read access to every branch of the plan's scope (otherwise 403, as the export would refuse those branches). An idempotency key replays only its creator's review of the same file.

## Decisions

| Id | Choice | Reverse |
| --- | --- | --- |
| D-STACK | Stacked on #93. | Rebase onto `main` after #93 merges. |
| D-INPUT | One engine over `ReviewInput`; Foodics reviewed from the parse result. | Feed converted bytes back through `parseWorkbookUpload`. |
| D-MATCH | Identity only by id, source link, decision (and verified link endpoints). | Add typed source links in QOS-217. |
| D-PLAN | Migration 0055, two tables, plan hash, staleness on read. | Drop both tables (down script); renumber if needed. |
| D-ACTIONS | Matrix above. | Flip a cell in `ACTION_MATRIX`. |
| D-CAPABILITY | Field decisions from contract + dictionary 1.1; nothing persistable. | Dictionary 1.2 with `validated` classes. |
| D-UI | Review panel in the existing import screen; XLSX report; acknowledgements as decisions; no Apply. | Collapse components; CSV report. |
| D-AUTH | Same as parse/convert/export; re-review by creator or administrator. | Tighten the route guard to administrators. |
| D-LIB | No new dependency. | n/a |
| D-PERSIST | No catalogue, source-link or audit writes. | Add `recordTenantAuditEventInTx` on plan creation. |
| D-REVISION | Mismatch ⇒ Conflicting; blank ⇒ bound at review. | One branch in `buildUpdate`. |
| D-BLANK-NS | Blank namespace on a hand-filled template ⇒ `qos:<tenant>`, unverified. | One branch in `input.ts`. |
