# QOS-160 plan: reconcile current QOS code, Claude prototype and revised Phase 2

**Status:** draft for Nitesh's review. Planning and reconciliation only. No feature code was written.
**Date:** 21 November 2026
**Linear:** QOS-160 (parent QOS-155, phase root QOS-154)
**Scope source:** live Linear export of 21 November 2026 (authoritative), the Grok implementation pack (design brief, workbook contract, workbook, CSV, audits) and this repository at the commit recorded in section 1.
**Author:** planning engineer, headless session. Nitesh retains merge and shared-environment deployment decisions.

How to read this document: section 1 records verified facts with file paths. Sections 2 to 5 are the reuse map, traceability, architecture and test plan. Section 6 lists the decisions only Nitesh can make. Section 7 separates provider-access blockers from independent work. Section 8 is the exact first implementation proposal for QOS-192 and the outline for QOS-193. Section 9 is the dependency order for the rest of Phase 2. Appendix A is the prototype discrepancy list. Appendix B lists every command executed for this plan. "Source inspection" means a file was read; it is not a runtime test. Anything marked "Unknown" was not verifiable from this checkout and says what would resolve it.

## 1. Baseline

### 1.1 Repository snapshot

| Item | Verified value | Evidence |
| --- | --- | --- |
| Repository | `niteshrajgopal-dev/qos-app` | `git remote -v` shows `origin https://github.com/niteshrajgopal-dev/qos-app.git` |
| Branch | `main` | `git branch --show-current` |
| HEAD SHA | `99d8106f386bcd349f8f51b263481bb90227d0fc` | `git log -1` |
| HEAD subject | `Merge pull request #87 from niteshrajgopal-dev/cursor/qa-restyle-followups-f510` | `git log -1` |
| HEAD date and author | Sat 14 Nov 2026 19:34:53 +0400, `niteshrajgopal-dev` | `git log -1 --format=%ad %an` |
| Working tree at start | Clean (`git status --porcelain` empty) | executed |
| Working tree at end | Only this file is new. `npm ci` created `node_modules/`, which is git-ignored. | `git status --porcelain` |
| Tags | None | `git tag` returned nothing |
| Remote branches | 19 `cursor/*` branches besides `main`, including the three open PR heads | `git branch -a` |

The design brief appendix A and the workbook contract JSON both record `99d8106f386bcd349f8f51b263481bb90227d0fc` as the 16 November 2026 snapshot. That is the same commit as today's HEAD. The 16 November source observations were therefore made against the code that is on `main` now; section 1.13 rechecks each claim against the files anyway.

### 1.2 Agent instructions that apply

- `AGENTS.md` (root) contains only the `next dev` generated block: read `node_modules/next/dist/docs/` before writing Next.js code because this Next.js version differs from training data. `CLAUDE.md` is one line, `@AGENTS.md`.
- `.agents/skills/*/SKILL.md` holds 30 generic skill files (code review, TDD, documentation and ADRs, and so on). None is Phase 2 specific.
- `.cursor/settings.json` only enables the `superpowers` plugin.
- No nested `AGENTS.md` exists under `src/`.
- Documentation conventions observed in `docs/`: no YAML frontmatter, an H1 title, bold metadata lines, `##` sections. `docs/phase2/` existed as an empty folder before this file was added.

### 1.3 Toolchain, package manager, scripts

- Package manager: npm. The only lockfile is `package-lock.json` (lockfileVersion 3). No `pnpm-lock.yaml`, `yarn.lock` or `bun.lockb`.
- `package.json`: name `qos-api`, version `0.1.0`, `engines.node >= 22`. CI uses Node 22. The local sandbox ran Node v24.22.1 (recorded for honesty; not the CI version).
- Framework versions from `package.json`: `next 16.4.4`, `react 19.2.8`, `react-dom 19.2.8`, `drizzle-orm ^0.45.2`, `drizzle-kit ^0.31.4`, `better-auth ^1.7.15`, `postgres ^3.4.7`, `exceljs ^4.4.0`, `zod ^4.6.6`, `stripe ^22.6.2`, `lucide-react ^0.469.0`, `tailwindcss ^4`, `typescript ^5`, `vitest 4.1.11`, `esbuild 0.25.12`. Overrides pin `body-parser 2.4.0` and `source-map-js 1.2.2`.
- Scripts (from `package.json`): `dev`, `build`, `build:worker`, `build:ai-worker`, `start`, `worker:video`, `worker:ai`, `lint` (eslint), `typecheck` (tsc --noEmit), `test` (vitest run), `test:watch`, `check` (typecheck, lint, test), `db:generate`, `db:push`, `db:migrate`, `db:seed`, `db:seed:quotes-checkout-tester`, `verify:stripe-sandbox`, `verify:qos-57`, `verify:qos-47-48`, `export:quotes-hbz-finedine`, `import:quotes-hbz-finedine`, `generate:menu-extraction-fixtures`, `approve-publish:quotes-hbz-finedine`, `audit:ci`, `agents:connect-hyperagent`, `agents:approve-binding`, `agents:native-smoke`, `ai:spend`.
- Safe commands for Phase 2 work without a database: `npm ci`, `npm run typecheck`, `npm run lint`, and targeted `npx vitest run <paths>` on non-database suites. Everything under `db:*`, `import:*`, `approve-publish:*`, `verify:*`, `db:seed*` connects to a database and was not run.
- `vitest.config.ts`: alias `@` to `./src`, `environment: node`, `include: ["src/**/*.test.ts"]`, `fileParallelism: false`. `.test.tsx` files are not picked up.
- `tsconfig.json` excludes `design-system`, `design` and `handoff`.

### 1.4 CI

`.github/workflows/ci.yml`, one job `quality` on `ubuntu-latest`, triggered on pull requests and pushes to `main`:

1. Postgres service `postgres:16-alpine` (user, password and database `qos`), with `DATABASE_URL` and `TEST_DATABASE_URL` set to `postgresql://qos:qos@localhost:5432/qos` and `CI=true`.
2. `actions/setup-node@v4` with Node 22 and npm cache; `apt-get install ffmpeg`.
3. `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` (`NEXT_TELEMETRY_DISABLED=1`), `npm run build:worker`, `npm run build:ai-worker`, `npm run audit:ci`.

CI does not run `db:migrate`. The integration suites migrate the CI database themselves through `resetAndMigrate()` in `src/db/test-utils.ts` (lines 38 to 50), which drops the `qos` and `drizzle` schemas and re-applies every file in `drizzle/`.

### 1.5 Open pull requests and collision check

Source: `/workspace/qos-phase2/open-prs.json` (gathered for this session; no live GitHub access). All three are drafts and GitHub reports each as `CONFLICTING` with `main`. Diffs were computed locally with `git diff --stat main...origin/<branch>`.

| PR | Branch and head | Changed files | Phase 2 collision |
| --- | --- | --- | --- |
| #4 `fix(catalogue): unblock FineDine import apply under RLS (QOS-89)` | `cursor/fix-catalogue-import-rls-9c8a` at `7b2c161f` (18 Sep 2026) | `src/lib/catalogue/catalogue-import.test.ts` (+48), `src/lib/catalogue/products.ts` (24 lines) | Touches the product service used by the catalogue apply path that QOS-193, QOS-194 and QOS-200 extend. |
| #5 `Add local-run QOS-89 HBZ FineDine import and verify scripts` | `cursor/hbz-finedine-local-ops-6a61` at `6c27a19e` (18 Sep 2026) | `package.json` (4 lines), three new scripts under `scripts/` and `scripts/sql/` | Any Phase 2 change to `package.json` scripts will conflict. |
| #14 `fix: regenerate package-lock.json to unblock CI audit` | `cursor/fix-package-lock-audit-e8e8` at `191641c1` (19 Sep 2026) | `package-lock.json` only (288+, 297-) | Conflicts with any lockfile change. |

None of the open PRs touches navigation, locations, staff shell, locale copy or schema. QOS-192 as proposed in section 8 does not collide with them. Recommendation for Nitesh: decide whether #4, #5 and #14 are closed or rebased before QOS-193 changes the import code, because #4 edits `products.ts` and the import test.

### 1.6 Drizzle schema and migrations

- `drizzle.config.ts`: `schema: ./src/db/schema.ts`, `out: ./drizzle`, `dialect: postgresql`, `schemaFilter: ["qos"]`, credentials from `DATABASE_URL`.
- Single schema file `src/db/schema.ts` (3,715 lines). Everything lives in the Postgres schema `qos` declared at line 21; tables use `qos.table(...)`, enums `qos.enum(...)`. Context setting constants at lines 3708 to 3715: `qos.current_tenant_id`, `qos.operator_provisioning`, `qos.agent_credential_access`, `qos.agent_platform_admin`.
- Table inventory by domain (table name, schema line):
  - Tenancy and branches: `tenants` (105), `organizations` (131), `brands` (158), `locations` (184), `location_weekly_schedule_windows` (332), `location_schedule_exceptions` (361), `location_item_stop_sales` (395), `location_external_menu_sources` (433), `business_provisioning_operations` (2948).
  - Staff and access: `staff_identities` (217), `staff_memberships` (233), `staff_invitations` (265), `staff_invitation_locations` (304), `staff_access_requests` (2582), `staff_access_request_locations` (2616), `staff_location_scopes` (2977).
  - better-auth: `customer_auth_users/sessions/accounts/verifications` (1652 to 1717), `staff_auth_users/sessions/accounts/verifications` (1730 to 1795).
  - Catalogue: `catalogue_products` (464), `catalogue_product_translations` (503), `catalogue_variants` (577), `catalogue_variant_translations` (613), `catalogue_variant_prices` (642), `catalogue_variant_location_price_overrides` (672), `catalogue_variant_location_price_reset_audits` (714), `catalogue_modifier_groups` (743), `catalogue_modifier_group_translations` (775), `catalogue_modifier_options` (809), `catalogue_modifier_option_translations` (850), `catalogue_product_modifier_groups` (884), `catalogue_categories` (917), `catalogue_category_translations` (948), `catalogue_product_categories` (977).
  - Menus and publishing: `catalogue_menus` (1007), `catalogue_menu_translations` (1040), `catalogue_menu_locations` (1074), `catalogue_menu_sections` (1103), `catalogue_menu_section_translations` (1137), `catalogue_menu_section_products` (1173), `catalogue_menu_live_revisions` (1307), `catalogue_menu_publish_operations` (1339), `catalogue_menu_public_links` (1381).
  - Storefront, baskets, checkout, Stripe: `storefronts` (1416) through `storefront_checkout_payment_operations` (2356).
  - Media: `catalogue_media_assets` (2420), `catalogue_media_upload_grants` (2468), `catalogue_media_derivatives` (2495), `video_processing_jobs` (2529).
  - Audit: `tenant_audit_events` (2643) with `location_id`, `actor_subject`, `actor_class`, `action`, `entity_type`, `entity_public_id`, `entity_version`, `correlation_id`, `change_summary`, `occurred_at`.
  - Import and extraction: `catalogue_import_source_links` (2811), `catalogue_import_operations` (2837), `catalogue_menu_extraction_sources` (2880), `catalogue_menu_extraction_pages` (2916), `catalogue_menu_extraction_candidates` (3266).
  - Agents and AI: `agent_provider_connections` (3067) through `ai_job_attempts` (3590).
- Not present in the schema: any inventory, ingredient, unit, supplier, warehouse, recipe, stock, sales closing, tender, POS connection, POS mapping or reporting table. Orders are a mock screen; there is no orders table. The only external provider enum is `external_menu_provider = ["finedine"]` (line 85).
- Relevant enums: `staff_role = administrator | user` (line 38), `location_status = active | suspended` (line 33), `data_provenance = synthetic_fixture | operator_entered | imported | ai_generated` (line 71), `catalogue_import_operation_status = preview_ready | applied | failed` (line 2685).
- Migrations: 54 SQL files `drizzle/0000_foamy_logan.sql` to `drizzle/0053_translation_admin_review_revert_approval.sql`. `drizzle/meta/_journal.json` has 54 entries; the last is idx 53, tag `0053_translation_admin_review_revert_approval`. Snapshots exist for only 27 migrations (0000 to 0019, 0024, 0026 to 0029, 0034, 0035); hand-written migrations have none.
- Naming pattern: `NNNN_<name>.sql`. drizzle-kit generated files carry random names (for example `0026_clean_gargoyle.sql`); hand-written files carry descriptive snake_case names (0020 to 0023, 0025, 0030 to 0033, 0036 to 0053). Statements are separated by `--> statement-breakpoint`.
- RLS convention: 39 of the 54 migrations create policies (107 `CREATE POLICY` statements in total). Every tenant table gets `ENABLE` and `FORCE ROW LEVEL SECURITY` plus a `<table>_tenant_isolation` policy keyed on `nullif(current_setting('qos.current_tenant_id', true), '')::uuid` (example `drizzle/0031_catalogue_categories.sql` lines 43 to 63, including `GRANT ALL ON TABLE ... TO qos_app`). Newer migrations narrow grants (`drizzle/0050_catalogue_menu_extraction.sql` lines 27 to 28: `REVOKE ALL ... FROM qos_app; GRANT SELECT, INSERT, UPDATE ...`). Database roles `qos_app` and `qos_migrator` (BYPASSRLS) are created in `drizzle/0000_foamy_logan.sql` lines 103 to 122; `qos_ai_worker` and `qos_ai_scaler` appear from 0042.
- Location scoping is not enforced by RLS. `locations` and `staff_location_scopes` are ordinary tenant tables; location checks are application level (section 1.9).

### 1.7 How migrations are applied

Manual, never on deploy. Evidence:

- `README.md` lines 37 to 39: edit `src/db/schema.ts`, `npm run db:generate`, commit the SQL, then `npm run db:migrate`; lines 93 to 94 say "Apply migration 0035 to the target database first" before deploying the video worker.
- `deploy/deploy-video-worker.ps1` line 21 and `deploy/deploy-ai-worker.ps1` line 19 list migrations as prerequisites that must already be applied.
- Per-migration admin scripts exist for migrations that need the admin login: `scripts/apply-0030-list-memberships.ts`, `apply-0032-storefront-deployments.ts`, `apply-0047-catalogue-translation-review.ts`, `apply-0048-ai-worker-menu-facts-read.ts`, `apply-0049-catalogue-description-draft.ts` (the last reads `DATABASE_ADMIN_URL || DATABASE_URL`; `qos_app` cannot `ALTER TYPE`).
- `Dockerfile`, `docker-compose.yml`, `infra/*.bicep`, `infra/container-app-update.yaml`, `.azure/deployment-plan.md` and `.github/workflows/ci.yml` contain no migrate step.

Every Phase 2 migration proposed in section 4 therefore has to be applied by Nitesh (or someone Nitesh delegates) with the admin connection before the matching application image is deployed. Deployed database state (which of 0000 to 0053 is applied on `psql-qos-dev`) is Unknown from this checkout; a `SELECT * FROM drizzle.__drizzle_migrations` run by Nitesh would resolve it.

### 1.8 Authentication

- Two better-auth instances, both with the Drizzle adapter and `schemaName: "qos"`: staff in `src/lib/staff/auth-server.ts` (`basePath /api/staff-auth`, cookie prefix `qos-staff`, email and password with required verification, optional Google and Microsoft) and customer in `src/lib/customer/auth-server.ts`. Route handlers: `src/app/api/staff-auth/[...all]/route.ts` and `src/app/api/auth/[...all]/route.ts`.
- Server helpers in `src/lib/staff/auth.ts`: `requireStaffIdentity` (line 26), `requireActiveStaffMembership` (line 51, checks active tenant then active membership inside `withTenantContext`), `requireAdministratorMembership` (line 92). Errors are `StaffAuthorizationError` with a 403 default, mapped by `staffErrorResponse` in `src/lib/staff/http.ts`.
- Session helpers: `src/lib/staff/session.ts` (`requireVerifiedStaffSession`, `staffPrivateCacheControl`). Client: `src/lib/staff/staff-session-client.ts` calls `GET /api/staff/me/memberships`, which returns `subject`, `email` and `ActiveStaffMembershipSummary[]` (`tenantId`, `tenantPublicId`, `tenantName`, `membershipId`, `role`) from the SQL function `qos.list_active_staff_memberships` (`src/lib/staff/memberships.ts` lines 248 to 263).
- Pattern for every tenant API route: read `tenantId` from the path, `requireStaffIdentity(request)`, then `requireActiveStaffMembership` or `requireAdministratorMembership`, then call the service inside `withTenantContext` (example `src/app/api/tenants/[tenantId]/catalogue/import/preview/route.ts` lines 26 to 34). There is no `middleware.ts` or `proxy.ts`.
- Platform operator auth is header based (`src/lib/platform/operator-auth.ts`, `x-qos-operator-key`).
- Audit: `recordTenantAuditEventInTx` in `src/lib/audit/tenant-audit.ts` (line 154) writes `tenant_audit_events`; it redacts secret-like keys (lines 57 to 58). It is called from 25 non-test modules (catalogue, staff, onboarding, storefront, media, agents, AI spend).

### 1.9 Tenant and location (branch) model and RLS enforcement

- Tenant context is set per transaction with `select set_config('qos.current_tenant_id', $1, true)` by `withTenantContext` in `src/lib/tenant/context.ts` lines 51 to 64. All tenant tables fail closed without it (tested in `src/db/tenant-isolation.test.ts`).
- Hierarchy: `tenants` (base_currency, default_locale, default_timezone, supported_locales), `organizations`, `brands`, `locations` (schema lines 184 to 215: `public_id`, `name`, `slug`, `timezone`, `status active|suspended`, unique on tenant plus public_id and tenant plus slug).
- Roles are fixed: `staff_memberships.role` is `administrator` or `user`. Location scope for users is `staff_location_scopes` (schema lines 2977 to 3003). Administrators bypass location checks; users must hold a scope row for every requested location (`assertAuthorizedLocations` in `src/lib/catalogue/menus.ts` lines 226 to 270). Location availability mutations require administrators (`src/lib/catalogue/location-availability.ts`).
- There is no current-branch selector anywhere in the staff shell. `PortalTopBar.tsx` lines 197 to 241 only switch tenant. Location is a path parameter (`/tenants/[tenantId]/locations/[locationPublicId]/availability`) or a checkbox list inside forms (menu publish, access requests). `GET /api/tenants/[tenantId]/staff/locations` (route file at `src/app/api/tenants/[tenantId]/staff/locations/route.ts`) is administrator only and returns `listTenantLocationsForAdmin` (`src/lib/staff/access-requests.ts` line 220). `listTenantOverviewBranches` in `src/lib/staff/overview.ts` line 156 lists up to eight locations for the overview.
- Known Quotes location identities in code are fixtures only: `loc_quotes_hbz` (HBZ Stadium), `loc_quotes_hct` (HCT Academic City), `loc_quotes_al_ain_zoo` (Al Ain Zoo) in `src/lib/seed/fixtures/quotes-locations.ts`; the two-tenant isolation fixtures in `src/lib/tenant/fixtures.ts`. The actual public IDs and names in the deployed Quotes tenant are Unknown; only a read of the deployed `qos.locations` table confirms them (decision D1 in section 6).
- No code references Dubai, Al Ain or Azur Cafe as branch names. The strings "Dubai" and "Al Ain" appear only in timezone values (`Asia/Dubai`), mock marketing copy (`src/mocks/platform.ts` line 61) and the fixture "Al Ain Zoo".

### 1.10 Staff app routes, navigation and i18n

- Shell: `src/app/tenants/[tenantId]/layout.tsx` renders `StaffAppShell` (`src/components/staff/StaffAppShell.tsx`), which loads the session, redirects 401 to `/staff/sign-in`, exposes `PortalShellProvider` (`tenantId`, `tenantName`, `personName`, `roleLabel`, `motion`, `toggleMotion` in `src/components/portal/portal-shell-context.tsx`), renders `PortalScene` and the 94 px `PortalTopBar`, and opens the command palette on Ctrl or Cmd plus K.
- Navigation data: `src/lib/staff/nav.ts`. Header destinations `STAFF_TOP_NAV` (lines 81 to 87): Overview, Orders, Catalogue, Menus, Storefronts. `STAFF_MORE_NAV_GROUPS` (lines 89 to 121): Catalogue (Categories, Modifier groups, Import, Menu extraction), Commerce (Sales channels, POS, Locations, Customers), Platform (Integrations, Analytics, Team, Access requests, Approvals, Audit, AI & Agents, Settings). `STAFF_NAV_PATHS` (130 to 152) and `PATH_MATCHERS` (154 to 175) resolve ids to routes and the active id. Tests in `src/lib/staff/nav.test.ts`.
- Staff pages under `src/app/tenants/[tenantId]/`: overview (`page.tsx`), `orders`, `customers`, `analytics`, `audit`, `integrations`, `catalogue` with `products`, `categories`, `modifier-groups`, `menus`, `import`, `menu-extraction`, `channels`, `channels/online-store`, `channels/pos`, `locations` and `locations/[locationPublicId]/availability`, `team`, `staff/access-requests`, `staff/translation-approvals`, `staff/audit`, `settings`, `settings/ai-agents`.
- Mock screens still present from Phase 1: `orders`, `customers`, `analytics`, `integrations`, `settings`, `channels/pos` and `/storefront` render `SampleDataNotice` (`src/components/staff/sample-data-notice.tsx`) with data from `src/mocks/platform.ts`. The real-data screens are catalogue, menus, categories, modifier groups, import, menu extraction, locations, channels, online store, team, access requests, approvals, audit and the overview.
- i18n: hand-written dictionaries, no library. `STAFF_UI_COPY` in `src/lib/staff/locale.ts` (English lines 41 to 293, Arabic 294 to 544), `staffNavLabel` with `NAV_LABEL_KEYS` (553 to 595), CLDR plurals through `Intl.PluralRules` (617 to 698). Locale is a client preference in `localStorage` key `qos-staff-locale` (line 3); `StaffLocaleProvider` sets `document.documentElement.lang` and `dir` (`ar` gives `rtl`). RTL CSS lives in `src/app/qos-portal.css`, `qos-components.css`, `qos-app-extras.css`, `qos-portal-workspace.css` and `globals.css`. The server always renders `lang="en"`. `src/lib/staff/staff-admin-i18n-audit.test.ts` forbids hard-coded English and light-palette classes in an explicit file list; new Phase 2 screens must be added to that list.
- Design system: `src/design-system/index.ts` exports the typed component kit (Card, DataTable, EmptyState, Alert, Drawer, Modal, ConfirmDialog, Tabs, SegmentedControl, Select, StatusBadge, CommandPalette, and others). Portal workspace kit: `src/components/portal/workspace/PortalWorkspace.tsx` (PortalArea, PortalPageHeader, PortalStat, PortalFilterTabs, PortalNotice, PortalPanel, PortalField, PortalFileInput, PortalPagination). Brand assets in `public/brand/` and fonts `qos-display.otf`, `qos-sans.otf`, `qos-sans-bold.otf` in `src/app/fonts/`. Ambient motion toggle: `src/components/portal/use-ambient-motion.ts`.
- Storefront boundary: the customer storefront renderer is a separate deployment (`docs/QOS_Cursor_Phase1_Development_Handover_v2.md` lines 113 to 132); this repo exposes `/api/public/**` and `src/lib/storefront/*`. ADR-SF-01 is referenced in four docs but the ADR file itself is not in the repository. Phase 2 does not touch the storefront runtime.

### 1.11 Existing services relevant to Phase 2

| Area | What exists | Paths |
| --- | --- | --- |
| Products, variants, prices | Draft product create/update/archive/restore with version checks; variants; base prices; location price overrides and audited reset | `src/lib/catalogue/products.ts` (createDraftProduct 430, updateDraftProduct 558), `variants.ts`, `location-price-overrides.ts`, `location-price-resolver.ts` |
| Categories (many-to-many) | list/create/update/reorder, assign and unassign product | `src/lib/catalogue/categories.ts` |
| Modifier groups and options | groups with min/max, options with price delta, default, quantity rules; product-level attachment | `src/lib/catalogue/modifiers.ts`, `modifier-selection.ts` |
| Translations and media | per-locale translation rows with approval workflow; image ingestion with preserve and re-ingest | `translation-approval.ts`, `translation-review/`, `src/lib/media/product-images.ts` (ingestProductImageFromRemoteUrl 583) |
| Menus and publishing | menus, locations, sections, section products; publish is administrator only, idempotent per operation id, writes live snapshots | `menus.ts`, `menu-publish.ts`, `menu-snapshot.ts`, `menu-health.ts` |
| Availability | weekly windows, exceptions, stop-sales, eligibility | `location-availability.ts`, `availability-schedule.ts`, `item-eligibility.ts` |
| Catalogue import (flat profile) | CSV and first-worksheet XLSX parse, column mapping suggestions, validation, preview, apply, source links | `catalogue-import-parser.ts`, `catalogue-import-xlsx.ts`, `catalogue-import-validation.ts`, `catalogue-import.ts`, `import-report.ts`, `catalogue-import-sample.ts` |
| FineDine | flat-list parser and CSV builder, HBZ import and approve-publish scripts, connection key `finedine.hbz-stadium` | `finedine-menu-extract.ts`, `finedine-hbz-import.ts`, `finedine-hbz-constants.ts`, `finedine-hbz-approve-publish.ts`, scripts listed in 1.3 |
| Menu extraction (AI) | PDF and image extraction into import candidates | `src/lib/catalogue/menu-extraction/` |
| Integrations and POS | None real. Integrations and POS screens are mocks. Stripe webhook exists for checkout. Agent provider connections exist for AI, not POS. | `src/components/platform/integrations-screen.tsx`, `src/mocks/platform.ts` lines 76 to 85, `src/app/api/webhooks/stripe/checkout/route.ts` |
| Analytics and reports | Mock analytics screen; real overview counts only | `src/components/platform/analytics-screen.tsx`, `src/lib/staff/overview.ts`, `src/lib/staff/workspace.ts` |
| exceljs | Only `src/lib/catalogue/catalogue-import-xlsx.ts` (`readFirstWorksheetMatrix`, `writeWorksheetMatrix`), used by the parser and the sample download | `catalogue-import-sample.ts`, `catalogue-import-parser.ts` |
| Inventory, recipes, stock, suppliers, warehouses, kitchen prep, sales closings | None found in `src/` or `drizzle/` | search for inventory, recipe, ingredient, stock, supplier, warehouse, uom, prep, kitchen, loyverse, foodics returned no domain code |
| Fixture isolation | `data_provenance = synthetic_fixture` on products and modifier groups; dev-only seed guard refuses staging and production targets | `src/lib/seed/dev-tenants.ts`, `src/lib/seed/dev-only-environment.ts` |

### 1.12 Tests and harness

- 225 `*.test.ts` files under `src/`. 86 of them use the integration gate `hasIntegrationDatabase()` from `src/db/test-utils.ts` and are skipped unless the resolved URL is localhost, `127.0.0.1`, `@db:` or `CI=true`. The default URL is `postgresql://qos:qos@localhost:5432/qos`, so a plain `npm test` on a machine without local Postgres attempts a database connection. For that reason the full suite was not run here.
- Integration pattern to copy for new tables: `resetAndMigrate()`, `grantRoleMembership(sql, "qos", "qos_app")`, `runAsRole(sql, "qos_app", ...)`, `withTenantContext`, cross-tenant assertions (`src/db/tenant-isolation.test.ts` lines 33 to 80). Migration shape tests query `pg_enum` and `to_regclass` (`src/db/catalogue-description-draft-migration.test.ts`).
- Accessibility and layout tests already present: `src/design-system/tokens/portal-contrast.test.ts` (WCAG AA 4.5 on portal tokens), `src/lib/portal/overview-layout-qos150.test.ts` (viewport grid with widths 360, 390, 414, 600, 768, 900, 1024 and zoom cells), `src/lib/staff/staff-admin-i18n-audit.test.ts`, `src/lib/staff/overlay.test.ts` (keyboard and RTL in the command palette), `src/lib/staff/locale.test.ts`.
- No Playwright or other browser end-to-end harness is in the repository or `package.json`. `scripts/measure-overview-layout.mjs` loads Playwright from outside the repo through `PLAYWRIGHT_MODULE_PATH` (documented in `docs/qos-149/overview-layout/README.md`). This is a gap for the browser evidence that QOS-192 and QOS-182 require (decision D11).
- Fixtures: `fixtures/catalogue-import/quotes-hbz-finedine.csv`, `quotes-synthetic.csv`, `fixtures/finedine/quotes-hbz-stadium-flat-list.json`, media and menu-extraction fixtures, `test-fixtures/video/`.

Baseline commands executed in this session (details in Appendix B):

| Command | Result |
| --- | --- |
| `npm ci --no-audit --no-fund` | exit 0, 669 packages, 10 s, deprecation warnings only |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0, 0 errors, 34 warnings |
| `npx vitest run <36 non-database suites>` | exit 0, 36 files, 298 tests passed |
| `npm test` (full) | not run: 86 suites require Postgres on localhost and this session was forbidden to connect to any database |
| `npm run build`, `build:worker`, `build:ai-worker`, `audit:ci` | not run |

### 1.13 Recheck of the 16 November audit claims

The design brief appendix A and the workbook contract rules were written against the same commit as HEAD. Each claim was reread in the current files.

| Claim (16 Nov) | Current code | Status |
| --- | --- | --- |
| XLSX parsing reads only the first worksheet | `readFirstWorksheetMatrix` uses `workbook.worksheets[0]` (`catalogue-import-xlsx.ts` line 71); parser warns "Only the first worksheet was imported." | Confirmed |
| Limits 2 MiB, 500 data rows, 32 columns, 2,000 characters per cell | `IMPORT_LIMITS` in `catalogue-import-parser.ts` lines 15 to 20: `maxFileBytes 2*1024*1024`, `maxRows 500`, `maxCellLength 2000`, `maxColumns 32` | Confirmed |
| Parser recognises 13 mappings | `suggestColumnMapping` returns 13 fields: sourceId, internalName, displayNameEn, displayNameAr, descriptionEn, descriptionAr, variantLabelEn, variantLabelAr, amountMinor, currency, sku, barcode, imageUrl (lines 212 to 226) | Confirmed |
| Apply persists only the seven-column profile; descriptions, SKU, barcode and variant labels are dropped | Create passes `sku: null`, `barcode: null`, `description: null` (`catalogue-import.ts` lines 1051 to 1064); update passes internal name, display names and `amountMinor` only (1098 to 1115) | Confirmed |
| Currency set on create, not changed on update | Create uses `row.currency`; update omits currency | Confirmed |
| Identity is tenant + connection key + source id | `catalogue_import_source_links` unique on tenant, connection_key, source_id (schema 2811 to 2835); `linkImportSourceToProduct` at apply | Confirmed |
| Existing non-null SKU or barcode can still produce an Update preview | `rowsEquivalent` compares `sku` and `barcode` (lines 101 to 109) although apply never writes them | Confirmed by source inspection; not executed |
| Image: approved primary image preserved unless re-ingest forced | `attachImportedImageIfNeeded` and `forceImageReingest` option (lines 643, 1074) | Confirmed |
| No inventory or recipe tables | Confirmed; see 1.6 | Confirmed |
| Branches have id, name, slug, timezone, active or suspended | `locations` table and `location_status` enum | Confirmed |
| Menu placements hold products, not variants | `catalogue_menu_section_products` (1173) | Confirmed |
| Modifier limits belong to the group; options carry price delta, default, quantity rules; product-level attachment | `catalogue_modifier_groups` (743), `catalogue_modifier_options` (809), `catalogue_product_modifier_groups` (884) | Confirmed |

New observation not in the 16 November audit (source inspection only, not executed): the import panel `src/app/tenants/[tenantId]/catalogue/import/catalogue-import-panel.tsx` always sends `JSON.stringify(columnMapping)` starting from `EMPTY_MAPPING` (lines 45 to 59 and 97). The preview route treats any non-empty string as a supplied mapping (`preview/route.ts` lines 18 to 24), `previewCatalogueImport` then skips `suggestColumnMapping` (`catalogue-import.ts` lines 651 to 654) and `validateColumnMapping` throws "Column mapping for sourceId is required." (`catalogue-import-validation.ts` lines 102 to 109). If this reproduces in a running app, the first preview from the UI fails and the mapping dropdowns never appear because `headers` stays empty. The API itself works when no mapping is sent (the FineDine script path). This should be verified in a running app and, if confirmed, fixed inside QOS-193 because that leaf rewrites the import landing screen anyway. The `previewIdempotencyKey` is also created once per mount (line 71), so a second preview with a different file in the same mount replays the first operation.

### 1.14 Inputs inspected outside the repository

- Live Linear export `/workspace/qos-phase2/linear-live.md` (2,354 lines): QOS-154, nine workstreams, 39 leaves, full descriptions and relations. Statuses: QOS-160 and QOS-162 are Todo; every other active issue is Backlog. Its "Differences vs pack" section states titles, statuses and relations match the pack snapshot; the pack descriptions are truncated prefixes of the live text; workstream parents are `relatedTo` QOS-185 (not blocking). Some in-description slugs are stale but the issue ids resolve.
- Design brief `requirements/QOS_Phase2_Claude_Opus_Design_Brief.md` (580 lines): requirement ids P2-DES-01 to P2-X-08, journeys J1 to J8, acceptance scenarios AC01 to AC46, appendices A to C.
- Workbook contract `requirements/QOS_Workbook_Data_Contract.json`: version 1.0, asOf 2026-11-16, profile `qos-extended-v1-proposed`, `layout.extendedHeaderRow 6`, `extendedFirstDataRow 7`, `currentProfileHeaderRow 1`, `tablePrefix QOS_`, computed column `row_check`, manifest table `QOS_Workbook_Context`; 28 sheets with 316 documented data columns; 28 rules; six formula contracts (`ingredient_cost_per_recipe_unit`, `recipe_line_cost`, `recipe_cost_per_yield_unit`, `sale_consumption`, `prepared_reference_cost_per_storage_unit`, `opening_value`); `profileCoverage.uiOnlyInPhase2` lists shared recipe assignments, direct-stock sellable mappings, availability and schedules, daily sales and tenders, receipts, waste and counts, prep observations.
- Workbook `requirements/QOS_Menu_and_Operations_Template.xlsx`, inspected from the real bytes with Python's `zipfile`: 31 worksheets in this order: Start Here, Current Import, Branches, Categories, Products, Product Categories, Variants, Branch Prices, Modifier Groups, Modifier Options, Product Modifiers, Menus, Menu Branches, Menu Sections, Menu Items, Units, Suppliers, Warehouses, Inventory Categories, Ingredients, Recipes, Recipe Lines, Prep Steps, Modifier Effects, Prep Targets, Opening Stock, External Mappings, Future Combos, Combo Components, Field Guide, Import Rules. 30 named tables with the `QOS_` prefix: `QOS_Workbook_Context` on Start Here at `A48:C58` (field, value, rule), `QOS_Current_Import` on Current Import at `A1:G501` (seven columns), 27 entity tables each starting at row 6 (for example `QOS_Branches A6:J26`, `QOS_Products A6:P206`, `QOS_Ingredients A6:U106`, `QOS_Recipes A6:Q106`, `QOS_Opening_Stock A6:N106`) each ending in a `row_check` column, and `QOS_Field_Guide` at `A6:I322`. Total table columns 355 (316 data columns, 27 `row_check`, 3 context, 9 field guide). No workbook-level defined names.
- CSV `requirements/QOS_Current_Catalogue_Import.csv`: header only, `source_id,internal_name,display_name_en,display_name_ar,amount_minor,currency,image_url`.
- Pack audits (`audit/QOS_Phase2_Prototype_Audit.md`, `QOS_Repository_Access_and_Discovery.md`, `QOS_Phase2_Handoff_Verification.md`), pack Linear documents (`linear/01` to `04`, `QOS_Phase2_Linear_Changes.md`) and prompts 01 to 05.
- Prototype `reference/claude-prototype/`: `PHASE2_HANDOVER.md`, `qos/app/page.tsx`, `qos/app/phase2/*` (14 files), `qos/app/prototype-data.ts`, assets, and the runtime loader files. Findings are in section 2 and Appendix A.

## 2. Reuse map

Prototype paths are relative to `reference/claude-prototype/qos/app/`. Repository paths are relative to the repo root. "New" means no equivalent exists in the repository today.

| Capability area | Reuse or extend (repository) | Prototype reference | Genuinely new |
| --- | --- | --- | --- |
| Staff shell, navigation, branch context (QOS-192) | `src/lib/staff/nav.ts`, `src/components/staff/StaffAppShell.tsx`, `src/components/portal/PortalTopBar.tsx`, `portal-shell-context.tsx`, `src/lib/staff/locale.ts`, `staff_location_scopes`, `assertAuthorizedLocations` pattern, `listTenantLocationsForAdmin` | `page.tsx` (branch picker line 53, nav line 48), `phase2/Phase2.tsx` (P2_PARENT nesting line 20), `phase2/P2Setup.tsx` (branch identity mapping panel), `phase2/P2Extend.tsx` | Shared branch selector with authorised All Branches; server branch-context API; branch-change guard (Save draft, Discard, Stay); persisted business-label mapping with audit; Phase 2 entry points with honest unavailable states |
| Business policies (QOS-161) | `tenants.base_currency`, `default_timezone`, `locations.timezone`, `tenant_audit_events` | `phase2/P2Setup.tsx` policy panel, `p2-core.ts` `Policy` type and defaults (lines 80 to 101) | Decision register (this document, section 6) and later a persisted policy record owned by the ledger leaf |
| Workbook parsing, template, export (QOS-193) | `catalogue-import-xlsx.ts` (exceljs load and write), `catalogue-import-parser.ts` (limits, CSV parser, `sanitizeSpreadsheetCell`, fingerprint), `catalogue-import-sample.ts`, `catalogue-import-validation.ts` (URL rules), source-link identity | `phase2/P2Import.tsx` (two-profile landing, review layout), `uploads/QOS_Current_Catalogue_Import.csv`, contract JSON | Named-table multi-sheet reader at header row 6, manifest reader, 31-sheet blank XLSX generator, current-record export with QOS ids, revision tokens and immutable context, unsupported-sheet classification |
| Validation and preview (QOS-194) | `validateColumnMapping`, `normalizeImportRow`, preview row statuses, `catalogue_import_operations` preview payload and hash, `CatalogueProductConflictError` version checks | `P2Import.tsx` review table, severity filters, correction report download | Cross-sheet reference resolution, action semantics (create, update, archive, remove_link, reset_to_central, skip, clear_fields), revision and namespace checks, downloadable correction report, durable pending upload |
| Apply with recovery (QOS-200) | `applyCatalogueImport` (idempotency key, preview hash, per-row report, replay), `createDraftProduct`, `updateDraftProduct`, categories, modifiers, variants, location price override and reset services, `ingestProductImageFromRemoteUrl`, `recordTenantAuditEventInTx` | `P2Import.apply()` (history only; must not be copied) | Dependency-ordered handlers for every supported sheet, per-entity outcomes, resumable operation state |
| Units and conversions (QOS-195) | Migration and RLS conventions, service and route patterns, `ConfirmDialog`, `DataTable` | `phase2/P2Inventory.tsx` Units tab, `p2-core.ts` `Unit`, `Conversion` | Whole domain |
| Suppliers and warehouses (QOS-196) | `locations`, label mapping from QOS-192, audit | `P2Inventory.tsx` Suppliers tab, `P2Setup.tsx` warehouses panel | Whole domain |
| Ingredients, categories, dated costs (QOS-197) | translation row pattern (`catalogue_*_translations`), `data_provenance`, audit | `P2Inventory.tsx` Ingredients tab and detail card | Whole domain |
| Recipes and sellable links (QOS-198) | `catalogue_variants` identity, `catalogue_products` detail screen (`product-editor.tsx` sections) | `phase2/P2Recipes.tsx`, `P2Kitchen.tsx` guide | Whole domain, including immutable versions and prep steps |
| Modifier effects and costing (QOS-199) | `catalogue_modifier_options` identity, `modifier-selection.ts` default resolution | `P2Recipes.tsx` effects panel, `p2-core.ts` `consumption()` (must not be copied as is) | Effects table, server cost and margin calculator |
| Stock ledger and postings (QOS-201 to 204) | transaction and idempotency patterns in `catalogue_menu_publish_operations` and `applyCatalogueImport`, audit | `phase2/P2Stock.tsx` tabs and forms | Whole domain |
| Kitchen Prep (QOS-207, 208) | design-system touch-friendly primitives, locale copy | `phase2/P2Kitchen.tsx`, `phase2.css` prep cards | Whole domain |
| Sales and consumption (QOS-205, 206) | variant and option identity, ledger from QOS-201 | `phase2/P2Sales.tsx` | Whole domain |
| Reports and exports (QOS-209, 210) | `src/lib/staff/overview.ts` (real counts), `writeWorksheetMatrix` (exceljs write), `analytics-screen.tsx` layout only | `phase2/P2Reports.tsx` catalogue of nine reports, `P2Extend.tsx` Finance chips | Report query services and typed XLSX export |
| Inbound POS foundation (QOS-163 to 177) | `catalogue_import_operations` shape as a model for durable operations, `agent_provider_credentials` as a model for secret references (not reuse of the table), Stripe webhook as an example of provider event handling, `integrations-screen.tsx` layout | `phase2/P2Pos.tsx` | Whole domain; provider findings pending QOS-162 |
| Real provider adapter (QOS-178 to 185) | same as above | `P2Pos.tsx` proof record | Whole domain; pending QOS-162 |

Prototype elements that must not be copied into production (file and line from the prototype):

- `localStorage` as the business store: `phase2/p2-core.ts` lines 280 to 289 (key `qos-phase2-v1`, `saveP2`), `page.tsx` lines 34 to 39 (`qos-portal-v1`, `qos-motion`), `phase2/P2Setup.tsx` line 118 (reset by `removeItem` then reload).
- Browser Babel and CDN runtime: `QOS Portal.dc.html`, `support.js` (React and Babel from unpkg), `qos-runtime.js` (esm.sh dependencies, Tailwind browser build, `new Function` evaluation). `qos/original-package.json` is not a runnable project.
- Scripted imports: `phase2/P2Import.tsx` lines 22 to 44 (`demoRows()`), 59 to 70 (`upload()` reads only `f.name` and `f.size`), 72 to 86 (`apply()` and `reapply()` write history only).
- Simulated success: `P2Stock.tsx` lines 35 to 42 and `P2Sales.tsx` lines 48 to 56 (`setTimeout` then toast), `P2Pos.tsx` lines 26 to 58 (connected (simulated), fixed period 2026-11-14, 42 records, AED 1,860), `page.tsx` line 60 (demo sync).
- Sample scenario defaults: `page.tsx` line 31 `useP2(true)`; `p2-core.ts` `sampleP2()` lines 135 to 187 including Dubai mapped to `loc_hbz`; `P2Setup.tsx` lines 116 to 118 (turning sample off keeps records).
- Hardcoded tenant and locations: `p2-core.ts` lines 8 to 15 (`TENANT` with 04:00 cutoff, `loc_hbz`, `loc_hct`, `loc_zoo`), line 125 (actor `N. Rajgopal`).
- Client-side role as authorisation: `page.tsx` line 42 (`admin = data.role === 'Administrator'`).
- CSV labelled as Excel: `P2Reports.tsx` lines 46 to 56 (`exportXlsx` writes `text/csv`); `P2Import.tsx` lines 118 to 130 (sheet-index CSV as "template", SKU used as `source_id`).

Visual language worth preserving (already largely present in the repo): tokens in `qos/public/assets/tokens.css` (night `#151b24`, surface `#202733`, text `#f4f3f5`, muted `#b1b7c4`, violet `#b3a1ef`, cyan `#99dfe9`, peach `#eec9b4`, radius 22 px and 10 px), glass panels, pill tabs, sticky table headers with tabular numbers (`phase2/phase2.css`), 44 px inputs and 48 px prep touch targets, state boxes with non-colour cues, `prefers-reduced-motion` and the motion toggle. The repository already ships the same fonts (`src/app/fonts/`), brand (`public/brand/`), portal scene and motion toggle; Phase 2 screens should use the existing `src/design-system` and portal workspace kit rather than importing prototype CSS.

## 3. Requirement-to-issue traceability

### 3.1 Workstreams

| Workstream | Leaves | Relation to QOS-185 |
| --- | --- | --- |
| QOS-155 Foundations and workbook onboarding | 160, 161, 192, 193, 194, 200 | relatedTo |
| QOS-187 Ingredients, recipes and basic costing | 195, 196, 197, 198, 199 | relatedTo |
| QOS-188 Basic stock ledger and operational controls | 201, 202, 203, 204 | relatedTo |
| QOS-189 Kitchen Prep Workspace | 207, 208 | relatedTo |
| QOS-190 Daily sales, consumption and reconciliation | 205, 206 | relatedTo |
| QOS-191 Essential reporting and Excel exports | 209, 210 | relatedTo |
| QOS-156 Inbound POS foundation and fixture testing | 163, 164, 166, 167, 168, 169, 170, 177 | relatedTo 163, 165 (deferred), 185 |
| QOS-158 First real inbound POS integration | 162, 178, 179, 211, 181 | relatedTo |
| QOS-159 Acceptance and operational handover | 182, 183, 184, 185, 186 | contains 185 |

Deferred and unscheduled, not Phase 3, not to be implemented: QOS-157, 165, 171, 172, 173, 174, 175, 176, 180.

### 3.2 Leaves

Requirement ids, ACs and journeys come from each leaf's live traceability block; live blockers are the live `blockedBy` relations. "Journeys" lists the journeys the leaf materially serves even where the leaf text does not cite them; only QOS-182, 184 and 186 cite J1 to J8 explicitly.

| Leaf | Live blockers | Requirement ids and ACs | Journeys | Existing code reused | New work |
| --- | --- | --- | --- | --- | --- |
| QOS-160 Reconcile code, prototype, reuse map | none (Todo) | P2-DES-01..05, P2-CTX, AC01, AC34, AC35 | all (planning) | whole repo (read) | this document |
| QOS-161 Record branch, stock, tax, reporting, posting policies | 160 | P2-CTX, P2-STK-10, P2-REC-05, P2-RPT-04a, P2-KIT-05..07 | J1, J3, J4, J7, J8 | tenants currency and timezone, locations | decision register (section 6); persisted policy record arrives with QOS-201 |
| QOS-192 Extend staff navigation and branch context | 160 | P2-DES-01, P2-DES-04, P2-CTX-01, 04, 05, 06, P2-DATA-01, AC01, AC02, AC03, AC34 | J1 (branch confirmation step), all journeys for context | nav, shell, top bar, locale, location scopes, audit | section 8 |
| QOS-193 Parse real workbooks and generate exports | 160 | P2-IMP-01..04, AC37, AC38, AC45, AC46 | J1 | xlsx reader, parser limits, sanitizer, sample download, source links | multi-sheet named-table reader, template generator, record export |
| QOS-194 Validate and preview workbook changes | 192, 193 | P2-IMP-05..08, 11, AC04, AC05, AC07, AC08, AC39, AC45, AC46 | J1 | preview statuses, version conflicts, validation errors | cross-sheet validation, review UI, durable pending upload |
| QOS-200 Apply imports with durable identity and recovery | 164, 194, 195, 196, 197, 198, 199, 208 | P2-IMP-09, 10, 12, P2-MENU-01..03, AC06, AC09, AC38, AC39, AC40, AC44 | J1 | apply replay and report, catalogue services, image ingestion | handlers per sheet, import history |
| QOS-195 Units and ingredient conversions | 160, 192 | P2-INV-02, 03, P2-X-08, AC10 | J2, J3 | migration, RLS, service and route patterns | units, conversions with effective history |
| QOS-196 Suppliers and branch warehouses | 192 | P2-INV-05, 06, 07, P2-CTX-04, AC02, AC03, AC36 | J1, J3 | locations, label mapping, audit | suppliers, warehouses (one per confirmed branch) |
| QOS-197 Ingredients, categories, dated costs | 195, 196 | P2-INV-01, 04, 07, P2-REC-07, AC11, AC13, AC27 | J2 | translation row pattern, audit | inventory categories, ingredients, dated reference costs |
| QOS-198 Versioned recipes and sellable links | 197 | P2-REC-01, 02, 02a, 04, 06, 07, 08, AC13, AC43 | J2, J7 | variants identity, product editor sections | recipe families, immutable versions, lines, prep steps, sellable and direct-stock links |
| QOS-199 Modifier effects and recipe costing | 198 | P2-REC-03, 05, P2-MENU-02, P2-POS-03a, AC11, AC12, AC13, AC27, AC42 | J2, J4 | modifier option identity, default resolution | effects, server cost and margin calculation |
| QOS-201 Stock ledger and posting service | 161, 195, 196 | P2-STK-01, 02, 08, 10, P2-X-08, AC02, AC14, AC17, AC25 | J3, J5 | transaction and idempotency patterns, audit | append-only movements, operations, balances, policy record |
| QOS-202 Opening stock and direct receipts | 197, 201 | P2-STK-03, 04, 05, 08, AC14, AC17 | J3 | ledger | intake drafts, receipts, duplicate explanation |
| QOS-203 Waste and traceable corrections | 201 | P2-STK-06, 09, AC15, AC17, AC20 | J5 | ledger | waste, correction, linked reversal |
| QOS-204 Quick physical counts | 201, 203 | P2-STK-07, 08, 09, AC15, AC16, AC17 | J5 | ledger | count snapshots, variance, reconcile state |
| QOS-207 Kitchen guides and batch calculator | 192, 198 | P2-KIT-01..04, 08, AC28, AC29, AC33, AC36 | J7 | recipes, design system | kitchen workspace, calculator, checklist session model |
| QOS-208 Prep targets and observations | 196, 207 | P2-KIT-05..08, AC29, AC30, AC31, AC36 | J7 | warehouses | targets, observations with revisions, priority view |
| QOS-205 Daily sales and payment closings | 163, 192 | P2-SAL-01..04, 08, AC18, AC19, AC26 | J4 | variant and option search, branch context | closings, lines, tenders, reconciliation |
| QOS-206 Sales consumption and overlap | 163, 199, 201, 205 | P2-SAL-05..07, P2-POS-03a, AC12, AC13, AC18, AC20, AC21, AC42 | J4, J6 | ledger, effects | consumption acceptance, snapshots, overlap resolution |
| QOS-209 Report queries | 199, 202, 203, 204, 206 | P2-RPT-01..04, 04a, AC25, AC26, AC27, AC41 | J8 | overview query pattern | nine report services |
| QOS-210 Drill-through and Excel exports | 192, 209 | P2-RPT-04, 05, 06, P2-UI-01, AC25, AC26, AC27, AC35 | J8 | `writeWorksheetMatrix`, analytics layout | report screens, typed XLSX export |
| QOS-163 Canonical sales intake and inbound contracts | 160 | P2-SAL, P2-POS, AC18..24, AC42 | J4, J6 | existing contract style (`public-menu-contract.ts`) | contract document and types |
| QOS-164 Scoped POS connections, mappings, source mode | 163 | P2-CTX, P2-POS-02, 03, AC02, AC03, AC46 | J6 | credential reference pattern, audit | connections, mappings, fixture namespaces |
| QOS-166 Durable inbound staging and acceptance | 163, 164, 205, 206 | P2-SAL-05..08, P2-POS-04..06, AC18..23 | J6 | operation pattern, sales acceptance | staging, checkpoints, recovery |
| QOS-167 Deterministic inbound fixture source | 163, 164 | P2-POS, P2-DATA, AC22..24 | J6 (simulated) | test harness, fixture isolation | fixture transport |
| QOS-168 Fault scenarios | 166, 167 | P2-POS-06, P2-SAL-07, AC21..24 | J6 | fixture | fault controls in tests only |
| QOS-169 Integrations setup, mapping, inbound review UI | 164, 166 | P2-UI-08, P2-POS, AC22..24, AC35 | J6 | integrations screen layout (mock today) | real integrations UI |
| QOS-170 Shared adapter contract tests | 163, 166, 168 | P2-POS, AC18..24, AC42 | J6 | vitest | contract test suite |
| QOS-177 Import diagnostics and recovery | 166, 169 | P2-IMP-10..12, P2-POS-06, P2-X-04 | J6 | audit | diagnostics UI and retries |
| QOS-162 Select POS source and obtain access (parallel track) | none (Todo) | P2-POS-01..04, AC24, AC42 | J6 | none | pending QOS-162 |
| QOS-178 Real POS read connection | 162, 163, 164 | P2-POS-01..04 | J6 | secret references | pending QOS-162 |
| QOS-179 Verify real mappings and semantics | 164, 178, 198, 199 | P2-POS-03..05, 03a, AC42 | J6 | mappings, recipes | pending QOS-162 |
| QOS-211 Import real sales | 166, 178, 179 | P2-POS-01, 03, 03a, 04..07, AC21..24, AC42 | J6 | pipeline | pending QOS-162 |
| QOS-181 Real adapter conformance | 170, 211 | P2-POS-04..07, AC23, AC24, AC42 | J6 | contract tests | pending QOS-162 |
| QOS-182 Verify J1 to J8 and Phase 1 regressions | 170, 177, 199, 200, 202, 203, 204, 206, 207, 208, 210 | J1..J8, AC01..46 | all | all | acceptance evidence |
| QOS-183 Database isolation, concurrency, recovery | 166, 170, 200, 201, 204, 206, 208 | AC02, AC06..17, AC18..24, AC29..31, AC46 | J1, J3, J4, J5, J6, J7 | integration harness | invariant tests |
| QOS-184 Test deployment and recovery runbook | 177, 181, 210 | P2-X, P2-DATA, J1..J8 | all | README, deploy scripts | runbook |
| QOS-185 Pass one real inbound POS to stock and report test | 181, 182, 183, 184 | P2-POS-07, AC18..27, AC42 | J4, J6, J8 | everything | real evidence (section 5.7) |
| QOS-186 Close Phase 2 | 182, 183, 184, 185 | AC01..46, J1..J8 | all | all | closure review |

### 3.3 Acceptance scenario coverage

Every AC maps to at least one implementation leaf plus QOS-182 and QOS-186. Implementation owners (from the live traceability blocks):

| AC | Implementation leaves | AC | Implementation leaves |
| --- | --- | --- | --- |
| AC01 | 160, 192 | AC24 | 162, 163, 167, 168, 169, 170, 181, 211 (+185) |
| AC02 | 192, 196, 201, 164 (+183) | AC25 | 201, 209, 210 (+185) |
| AC03 | 192, 196, 164 | AC26 | 205, 209, 210 (+185) |
| AC04 | 194 | AC27 | 197, 199, 209, 210 (+185) |
| AC05 | 194 | AC28 | 207 |
| AC06 | 200 (+183) | AC29 | 207, 208 (+183) |
| AC07 | 194 (+183) | AC30 | 208 (+183) |
| AC08 | 194 (+183) | AC31 | 208 (+183) |
| AC09 | 200 (+183) | AC32 | no implementation leaf cites it; 182 and 186 only (see gaps) |
| AC10 | 195 (+183) | AC33 | 207 (+182) |
| AC11 | 197, 199 (+183) | AC34 | 160, 192 |
| AC12 | 199, 206 (+183) | AC35 | 160, 169, 210 |
| AC13 | 197, 198, 199, 206 (+183) | AC36 | 196, 207, 208 |
| AC14 | 201, 202 (+183) | AC37 | 193 |
| AC15 | 203, 204 (+183) | AC38 | 193, 200 |
| AC16 | 204 (+183) | AC39 | 194, 200 |
| AC17 | 201, 202, 203, 204 (+183) | AC40 | 200 |
| AC18 | 205, 206, 163, 166, 170 (+183, 185) | AC41 | 209 |
| AC19 | 205, 163, 166, 170 (+183, 185) | AC42 | 199, 206, 162, 163, 170, 179, 181, 211 (+185) |
| AC20 | 203, 206, 163, 166, 170 (+183, 185) | AC43 | 198 |
| AC21 | 206, 211, 163, 166, 168, 170 (+183, 185) | AC44 | 200 |
| AC22 | 211, 163, 166, 167, 168, 169, 170 (+183, 185) | AC45 | 193, 194 |
| AC23 | 211, 181, 163, 166, 167, 168, 169, 170 (+183, 185) | AC46 | 193, 194, 164 (+183) |

Journey coverage: J1 is served by 192, 193, 194, 200 and 196 (warehouse) with branch confirmation decided in 161. J2 by 197, 198, 199, 207. J3 by 201, 202. J4 by 205, 206, 209. J5 by 203, 204. J6 by 164, 166, 167, 168, 169, 170, 177 (simulated) and 178, 179, 211, 181, 185 (real). J7 by 207, 208. J8 by 209, 210. Acceptance of all eight is owned by 182, runbook by 184, closure by 186.

### 3.4 Gaps and ambiguities

1. AC32 (every principal workflow has reachable permission-denied, loading, empty, validation, partial, conflict and success states) is cited only by the acceptance leaves. Each implementation leaf's own criteria imply it. Proposal: treat AC32 as a definition-of-done item for every UI leaf and verify it in QOS-182. No Linear change is required, but Nitesh may want to add AC32 to QOS-192 and QOS-210 traceability for visibility.
2. P2-UI-11 (Setup and Settings screen for branch mapping, business context, policies) is not assigned to a leaf. Proposal: QOS-192 owns the branch-mapping screen under the existing Settings area; QOS-201 surfaces the stock policy record; QOS-161 remains a decision issue.
3. P2-MENU-01 (recipe and cost panel on the existing product detail) is assigned to QOS-200 in Linear, while the data it shows is created by QOS-198 and QOS-199. Proposal: QOS-199 delivers the product detail panel because it owns the cost calculation; QOS-200 only has to preserve it. Nitesh may want to move P2-MENU-01 to QOS-199.
4. P2-CTX-07 (business timezone, currency and cutoff display) and P2-CTX-02 and 03 are covered only through the generic "P2-CTX" tag on QOS-161 and QOS-164. Proposal: QOS-192 shows tenant currency and the selected branch's timezone in the branch selector; QOS-201 and QOS-205 apply the cutoff.
5. QOS-205 (manual daily sales) is blocked by QOS-163 (inbound contract). This is intentional so manual and POS sales share one contract. QOS-163 depends only on QOS-160 and does not depend on provider access, so it does not import a provider blocker into manual sales.
6. QOS-192 is blocked only by QOS-160 and QOS-193 only by QOS-160. The order 192 then 193 is Nitesh's chosen sequence, not a dependency. They can be developed on independent branches; QOS-194 needs both merged.
7. The existing `channels/pos` route and the Integrations screen are mocks. QOS-169 replaces them. Until then QOS-192 must not present them as working integrations; it leaves the Phase 1 `SampleDataNotice` behaviour as is and does not add Phase 2 links into mock screens.
8. Provider facts (authentication, pagination, modifier semantics, tender fields) are pending QOS-162 and are not restated here.
9. No cycles were found in the live blocker graph; the two zero-blocker leaves are QOS-160 and QOS-162, matching the pack's change record.

## 4. Architecture and migration plan

### 4.1 Principles carried from the current code

- Every new table lives in schema `qos`, has `tenant_id`, composite foreign keys `(tenant_id, <fk>)` to the parent, a `public_id` unique per tenant where a record is addressed from the UI or an export, `created_at` and `updated_at`, `ENABLE` and `FORCE ROW LEVEL SECURITY`, a `<table>_tenant_isolation` policy and explicit grants to `qos_app`. Branch-scoped tables carry `location_id` with a composite FK to `locations`; branch authorisation stays in the service layer using the `assertAuthorizedLocations` pattern (administrators all, users by `staff_location_scopes`).
- All reads and writes run inside `withTenantContext`. Services take `(db, tenantId, membership, ...)` and are called from thin route handlers after `requireStaffIdentity` and the membership check, exactly as the catalogue routes do.
- Material writes record `tenant_audit_events` through `recordTenantAuditEventInTx` with `location_id` when branch scoped.
- Business operations that must happen once (apply, post, accept) use a durable operation row with a tenant-unique idempotency key, a status enum and a stored result, following `catalogue_import_operations` and `catalogue_menu_publish_operations`. Retries return the stored result. Concurrency is enforced by unique constraints and version columns, not by client flags.
- Versioned business records (recipes, conversions, costs, mappings) are append-only with `effective_from` and `effective_to`; posted history references the exact version id and stores a frozen snapshot.
- Fixtures use `provenance = synthetic_fixture` and the dev-only seed guard; no production code path reads `src/mocks` for Phase 2 screens.
- Sheet-level parsing and exports are stateless until QOS-194 persists a review operation. Opening stock is an intake draft, never a posting, when it arrives through the workbook.

### 4.2 Proposed modules

| Module (proposed path) | Leaf | Responsibilities |
| --- | --- | --- |
| `src/lib/staff/branch-context.ts` and `/api/tenants/[tenantId]/staff/branch-context` | 192 | permitted branches for the caller, All Branches eligibility, operational-branch guard |
| `src/lib/tenant/location-labels.ts` and `/api/tenants/[tenantId]/settings/branch-labels` | 192 | business label to location mapping, confirm and clear with audit |
| `src/lib/workbook/` (reader, template, export, profiles) and `/api/tenants/[tenantId]/catalogue/workbook/{template,export,parse}` | 193 | named-table reader, blank template, record export, profile detection |
| `src/lib/workbook/validation`, `/api/.../workbook/preview` and review UI | 194 | cross-sheet validation and preview operation |
| `src/lib/workbook/apply` | 200 | dependency-ordered handlers calling existing services |
| `src/lib/inventory/{units,conversions,suppliers,warehouses,categories,ingredients,costs}.ts` with matching `/api/tenants/[tenantId]/inventory/**` | 195, 196, 197 | master data |
| `src/lib/recipes/{recipes,versions,effects,costing}.ts`, `/api/tenants/[tenantId]/recipes/**` | 198, 199 | recipes and costing |
| `src/lib/stock/{ledger,postings,openings,receipts,waste,counts,policy}.ts`, `/api/tenants/[tenantId]/stock/**` | 201 to 204 | ledger and operations |
| `src/lib/kitchen/{guides,targets,observations}.ts`, `/api/tenants/[tenantId]/kitchen/**` | 207, 208 | prep workspace |
| `src/lib/sales/{closings,consumption,overlap}.ts`, `/api/tenants/[tenantId]/sales/**` | 205, 206 | sales and consumption |
| `src/lib/reports/*.ts`, `/api/tenants/[tenantId]/reports/**` | 209, 210 | report queries and XLSX export |
| `src/lib/pos/{contract,connections,mappings,staging,fixture}.ts`, `/api/tenants/[tenantId]/integrations/pos/**` | 163 to 177 | inbound foundation |
| `src/lib/pos/providers/<selected>` | 178 to 211 | real adapter, pending QOS-162 |

### 4.3 Proposed migrations in order

Numbers continue from 0053. The actual number is assigned when a PR is rebased onto `main`, so the sequence below is the intended order, not a reservation. Every migration is hand-written SQL plus a `_journal.json` entry, additive only, with RLS and grants as in 4.1, and a migration shape test under `src/db/`. Each must be applied manually by Nitesh with the admin connection before the matching image is deployed; nothing in CI or deploy applies them. "Reversible" means a documented down script can drop the new objects without touching Phase 1 data.

| Order | Proposed name | Tables and notable columns | RLS | Leaf | Reversible | Depends on decision |
| --- | --- | --- | --- | --- | --- | --- |
| 0054 | `location_business_labels` | `location_business_labels` (tenant_id, label text, location_id nullable composite FK, status unmapped or confirmed, confirmed_by_subject, confirmed_at, version, unique tenant plus label, unique tenant plus location_id where not null) | tenant isolation | 192 | yes, drop table | D1 (which labels), D2 (whether 192 persists mapping) |
| 0055 | `inventory_units_conversions` | `inventory_units` (code, name_en, name_ar, quantity_kind mass or volume or count, decimal_places, active), `ingredient_unit_conversions` (ingredient_id, from_unit_id, to_unit_id, factor numeric > 0, effective_from, effective_to, version) | tenant isolation | 195 | yes | D5 (precision) |
| 0056 | `suppliers_warehouses` | `suppliers` (public_id, name, contact fields, reference, status), `warehouses` (public_id, location_id composite FK, name, status, unique tenant plus location_id for the pilot one-per-branch rule) | tenant isolation | 196 | yes | D1 |
| 0057 | `inventory_categories_ingredients_costs` | `inventory_categories` (+ translations), `ingredients` (public_id, type raw or prepared, storage_unit_id, recipe_unit_id, recipe_units_per_storage_unit, default_supplier_id, status, provenance), `ingredient_translations`, `ingredient_reference_costs` (amount numeric, currency, unit_id, tax_basis net or gross or unconfirmed, effective_from, source, reference) | tenant isolation | 197 | yes | D6 (tax basis enum values) |
| 0058 | `recipes` | `recipes` (family identity, public_id), `recipe_versions` (recipe_id, version_number, status draft or approved or superseded, effective_from, effective_to, yield_quantity, yield_unit_id, approved_by, approved_at; unique recipe plus version), `recipe_lines`, `recipe_prep_steps` (+ translations), `recipe_sellable_links` (variant_id or ingredient direct-stock link with quantity, effective range; exclusion of overlapping approved links per variant enforced in service and by unique partial index) | tenant isolation | 198 | yes | D8 (eligibility and versioning rule) |
| 0059 | `recipe_modifier_effects` | `recipe_modifier_effects` (recipe_version_id, modifier_option_id, effect_type add or remove or replace, target_recipe_line_id, ingredient_id, quantity_per_sold_unit, unit_id; unique per version plus option plus target) | tenant isolation | 199 | yes | D9 (default selection semantics, pending 162 for provider payloads) |
| 0060 | `stock_ledger` | `stock_policies` (one row per tenant: valuation method, backdating rule, negative stock rule, precision, cutoff), `stock_operations` (public_id, type opening or receipt or consumption or waste or correction or count_adjustment or reversal, location_id, warehouse_id, status, idempotency_key unique per tenant, actor, effective_at, recorded_at, reversal_of_operation_id, result jsonb), `stock_movements` (operation_id, ingredient_id, warehouse_id, signed quantity in storage units, unit_id, unit_cost nullable, snapshot jsonb, effective_at, recorded_at; append only via revoked UPDATE and DELETE for `qos_app`) | tenant isolation; `REVOKE UPDATE, DELETE` on movements from `qos_app` | 201 | drop only if no movements exist | D3, D4, D5 (valuation, backdating, negative stock, precision), D7 (cutoff) |
| 0061 | `stock_openings_receipts` | `stock_opening_intakes` (+ lines), `stock_receipts` (supplier_id, reference, invoice fields, + lines with purchase unit and conversion snapshot) | tenant isolation | 202 | yes | D3 |
| 0062 | `stock_waste_corrections` | `stock_waste_entries`, `stock_corrections` drafts linked to operations with reason enums | tenant isolation | 203 | yes | D4 |
| 0063 | `stock_counts` | `stock_counts` (warehouse_id, cutoff_at, expected snapshot, status, version), `stock_count_lines` (observed quantity, counted_by, counted_at) | tenant isolation | 204 | yes | none beyond D3 to D5 |
| 0064 | `kitchen_prep_targets_observations` | `prep_targets` (warehouse_id, ingredient_id, recipe_version_id nullable, target_quantity, low_threshold, unit, container note, observation_valid_minutes, active), `prep_observations` (target_id, quantity, unit, counted_by, counted_at, revision) | tenant isolation | 208 | yes | D10 (freshness and priority rule) |
| 0065 | `sales_closings` | `sales_closings` (location_id, business_date, kind summary or itemised, source manual or pos, source_reference, status draft or reconciled or accepted or superseded, totals, version, unique tenant plus location plus business_date plus source), `sales_lines` (variant_id, quantity, unit price, discounts, tax), `sales_line_modifiers` (modifier_option_id, quantity), `sales_tenders` (method, mapped label, amount) | tenant isolation | 205 | yes | D6, D7, D12 (tender mapping) |
| 0066 | `sales_consumption` | `sales_consumption_operations` (closing_id, stock_operation_id, status, snapshot of recipe and effect versions), `sales_overlap_resolutions` | tenant isolation | 206 | drop only if none accepted | D8, D9 |
| 0067 | `workbook_import_operations` | `workbook_import_operations` (profile, schema version, context namespace, file fingerprint, status enum from P2-IMP-10, counts, idempotency key), `workbook_import_rows` (sheet, row, entity, action, outcome, diagnostics jsonb) | tenant isolation | 194 (rows), 200 (apply results) | yes | none |
| 0068 | `pos_connections_mappings` | `pos_connections` (provider enum loyverse or foodics or fixture, environment real or fixture, account reference, status, secret reference not the secret), `pos_identity_mappings` (connection_id, external type, external id, parent id, target type and id, location_id, version, status, active range) | tenant isolation; secrets never stored in plain columns | 164 | yes | pending QOS-162 for provider enum contents |
| 0069 | `pos_inbound_staging` | `pos_import_operations` (connection_id, period, timezone, checkpoint, coverage complete or partial or failed, status, idempotency key), `pos_staged_records` (source ids, version, raw reference, classification, accepted closing_id) | tenant isolation | 166 | yes | pending QOS-162 |

Reports (QOS-209) are expected to need no new tables; if query performance requires it, an additive materialised summary can follow as 0070 with its own decision.

### 4.4 Data flow and identity boundaries

- Three identities stay separate everywhere: workbook business keys (`*_key`), QOS canonical ids (`qos_*_id` or `public_id`) and provider ids (`external_id`). Names never confirm identity.
- Workbook flow: upload bytes to `parse` (stateless, QOS-193) to `preview` (persisted operation with rows, QOS-194) to `apply` (dependency-ordered handlers, per-entity outcomes, QOS-200). Apply writes drafts through existing services; publication, translation approval and stock posting remain separate actions.
- Stock flow: a draft document (opening intake, receipt, waste, count) is reviewed, then an explicit Post creates one `stock_operation` with a tenant-unique idempotency key and its `stock_movements` in one transaction. Retries return the stored result. Corrections create a linked reversal operation. Balances are computed from movements as of a cutoff; no editable balance column exists.
- Sales flow: a closing (manual or POS) is reconciled, then accepted; acceptance creates the consumption operation through the same ledger service with frozen recipe, effect, conversion and cost versions. Manual and POS representations for the same branch and business date are resolved to one accepted representation before posting.
- Inbound flow: retrieve pages to staging with checkpoints and coverage, map identities, review, then accept through the sales service. Fixture transport and the real adapter implement the same contract; fixture records carry a synthetic namespace and never flip QOS-185.
- Reports read accepted records only, apply branch, business date and as-of cutoff, and expose coverage states; exports are generated from the same query result with exceljs.

## 5. Test plan

Uses the repository's real tooling: vitest (unit and integration), the `hasIntegrationDatabase` gate with `resetAndMigrate`, `runAsRole` for RLS, the existing i18n audit list, the portal contrast test and the viewport grid test. Every leaf PR records exact commands and passed, failed or skipped counts.

### 5.1 Unit tests (no database)

- Pure logic per leaf: nav resolution (`nav.test.ts` pattern), locale parity (`locale.test.ts`), branch-context parsing and the All Branches guard (QOS-192), named-table reader against the real workbook bytes and modified copies (QOS-193), validation rules and action semantics (QOS-194), conversion math and dimension checks (QOS-195), cost and margin arithmetic with missing costs and unconfirmed basis (QOS-199), consumption preview including ADD, REMOVE, REPLACE and defaults applied once (QOS-199, 206), as-of balance arithmetic (QOS-201), reconciliation equation (QOS-205), report aggregation on small known datasets including multi-category products (QOS-209), XLSX export typing and leading-zero text (QOS-210), contract envelope tests (QOS-170).
- Command: `npx vitest run <paths>`; CI runs `npm test`.

### 5.2 Integration tests (real Postgres through the existing gate)

- Migration shape tests per migration (`to_regclass`, `pg_enum`, policy presence) following `src/db/catalogue-description-draft-migration.test.ts`.
- Service tests inside `withTenantContext` using `quotesTenantFixture` and `flowerTenantFixture` for cross-tenant denial, following `src/db/tenant-isolation.test.ts`.
- Route tests for every new API following `src/app/api/tenants/[tenantId]/catalogue/products/route.integration.test.ts`: 401 without session, 403 for user without scope, 404 for another tenant's id, success for administrator.
- Concurrency and recovery (QOS-201, 202, 204, 206, 166, 183): two concurrent posts with the same idempotency key produce one operation; interrupted apply or accept recovers the same logical operation; stale version returns conflict; restart recovery reuses the stored result. These run against the CI Postgres service, never against Azure.
- Command locally: `TEST_DATABASE_URL=postgresql://qos:qos@localhost:5432/qos npm test` with `docker compose up db -d` (README line 16). In CI the same happens automatically.

### 5.3 RLS and isolation

- For every new table: `runAsRole(sql, "qos_app", ...)` proves tenant A cannot read or write tenant B rows and that queries fail closed with no tenant context (pattern lines 66 to 80 of `tenant-isolation.test.ts`).
- Append-only guarantee for `stock_movements`: an `UPDATE` or `DELETE` as `qos_app` must fail.
- Location scope: a user with scope on branch A gets 403 for branch B on every branch-scoped route; administrator passes; All Branches posting is rejected by the shared guard at the service boundary.

### 5.4 End-to-end and browser evidence

- There is no browser harness in the repository (section 1.12). Options are in decision D11. Until decided, browser evidence for QOS-192 is produced manually against `next dev` with a local Postgres, recorded as screenshots plus the commands used, and labelled as manual verification.
- Journeys J1 to J8 are executed by QOS-182 against the real services. Fixture J6 stays labelled simulated.

### 5.5 Accessibility, locale and layout

- English and Arabic copy parity: add every new copy file to `src/lib/staff/staff-admin-i18n-audit.test.ts` and keep `STAFF_UI_COPY` keys in parity (`locale.test.ts`).
- RTL: verify `dir="rtl"` rendering of the branch selector, tables and forms; reuse the `[dir="rtl"]` CSS rules; no hard-coded left or right in new CSS (use logical properties as `PortalTopBar` does with `insetInlineEnd`).
- Narrow widths and zoom: extend the viewport grid approach in `src/lib/portal/overview-layout-qos150.test.ts` (360, 390, 414 px and zoom cells) to the Kitchen Prep and report screens; 150 to 200 percent zoom checks are performed in the browser evidence step and recorded.
- Contrast: new tokens or tones go through `src/design-system/tokens/portal-contrast.test.ts`.
- Keyboard and reduced motion: command palette and menus already have keyboard tests (`overlay.test.ts`); new dialogs (branch-change guard) must trap focus and close on Escape; respect `useAmbientMotion` and `prefers-reduced-motion`.

### 5.6 Fixture isolation

- Phase 2 fixtures are created only by test code or by the dev-only seed path guarded by `assertDevOnlySeedTarget`, carry `provenance = synthetic_fixture` or a fixture namespace, and are never rendered by production screens. The POS fixture transport (QOS-167) uses a synthetic connection environment and separate source namespace. Tests assert that switching any mode flag cannot surface fixture rows as tenant data.

### 5.7 Proving QOS-185 with real inbound provider evidence

QOS-185 cannot be satisfied by fixtures, simulators, screenshots or a successful login. The gate follows the acceptance matrix (`linear/04_Acceptance_Matrix.md`) and prompt 05:

1. Preconditions recorded: provider, account and environment (safely identified), authorised read scope, QOS tenant, confirmed branch mapping (D1), source business day and timezone (D7), agreed period, application commit and build, applied migration state, adapter and API version. All come from QOS-162, QOS-178, QOS-179 and QOS-161.
2. Retrieval through the implemented adapter (QOS-211) with retrieval timestamp, source-issued record ids, pagination and completeness evidence. Missing required coverage blocks the test.
3. Trace per record: source to staging to mapping to accepted closing and tenders to consumption with frozen recipe, effect and conversion versions to `stock_movements` to report rows to the exported XLSX.
4. Reconcile source counts and financial components (tax, discount, refund, tender) to QOS on the agreed basis (D6) with zero unexplained required differences; reconcile expected ingredient quantities to ledger and reports.
5. Reimport the same period: no new accepted revenue, closing or movement. Exercise manual and POS overlap for the same branch and period through the resolution flow. Exercise supported refund, void and correction semantics from authorised data only; anything not exercisable is recorded as unverified or blocked, never passed by fixture.
6. Record reviewer, date, passed, failed, unsupported and unverified cases with evidence links; redacted summaries go to Linear, sensitive evidence to the approved restricted location.

Provider findings needed for steps 1 and 2 are pending QOS-162.

## 6. Unresolved decisions for Nitesh

Each decision lists the options and the leaves it blocks. Nothing below is assumed in code until recorded in QOS-161 (or QOS-162 for provider items).

1. **D1 Branch label mapping.** Which existing Quotes location ids correspond to Dubai, Al Ain and Azur Cafe. Known candidates are fixture ids only (`loc_quotes_hbz` HBZ Stadium, `loc_quotes_hct` HCT Academic City, `loc_quotes_al_ain_zoo` Al Ain Zoo); the deployed ids are Unknown until read from the deployed `qos.locations`. Options: (a) map each label to an existing location and keep the historical name; (b) create new locations for labels that have no counterpart (for example Azur Cafe) through the existing `addTenantLocation` service; (c) leave a label unmapped. Blocks: QOS-196 warehouses, every posting leaf for the affected branch, QOS-185 branch choice. QOS-192 ships with all three labels Unmapped regardless.
2. **D2 Where mapping state lives for QOS-192.** Options: (a) persist confirmations in the proposed `location_business_labels` table with audit (recommended; QOS-196 and QOS-164 reuse it); (b) QOS-192 only displays Unmapped and persistence arrives with QOS-196. Blocks: QOS-192 scope and whether it carries migration 0054.
3. **D3 Stock valuation method and cost source.** Options: weighted average, FIFO, or reference cost only in Phase 2 with valuation deferred. Blocks: QOS-201 value columns, QOS-202 receipt value, QOS-209 stock value report. Posting is blocked, not defaulted, until decided.
4. **D4 Backdating and negative stock policy.** Options for backdating: not allowed, allowed with review, allowed within N days. Options for negative stock: blocked, allowed with warning, allowed. Blocks: QOS-201, 202, 203, 204, 206 posting paths.
5. **D5 Quantity precision and rounding.** Decimal places for storage and recipe units and rounding mode for display versus calculation. Blocks: QOS-195 unit definitions, QOS-201 movement precision.
6. **D6 Price and cost tax basis.** Whether variant prices are tax inclusive or exclusive, whether ingredient reference costs are net or gross, and the tax rate basis. Until confirmed, margins show "unavailable" and the basis is `unconfirmed`. Blocks: QOS-199 margin, QOS-205 reconciliation equation, QOS-209 margin report.
7. **D7 Business day cutoff and timezone.** Tenant timezone is `Asia/Dubai` in fixtures; the deployed value is Unknown. Confirm the business-day cutoff per branch (the prototype assumed 04:00, which is not a decision). Blocks: QOS-201 as-of logic, QOS-205 business date, QOS-209 period filters.
8. **D8 Recipe eligibility and versioning.** Who may approve a version, whether approval requires complete costs, whether backdated effective dates are permitted, and how prepared items are consumed (nested recipe explosion versus prepared-stock deduction; never both). Blocks: QOS-198, 199, 206 consumption.
9. **D9 Modifier default and selection semantics for the pilot.** Whether required default selections are applied once from configuration when a sale omits them, and the treatment of `free_options_count` (deferred, rejected on input). Provider payload semantics are pending QOS-162. Blocks: QOS-199, 206, 179.
10. **D10 Prep freshness and priority rule.** Freshness threshold per target, priority ordering (gap first, then stale, then missing), units and container sizes. Blocks: QOS-208.
11. **D11 Browser end-to-end tooling.** Options: (a) add Playwright as a devDependency in a separate small PR (changes `package.json` and the lockfile; conflicts with PR #14 until it is closed or rebased); (b) keep using an externally installed Playwright through `PLAYWRIGHT_MODULE_PATH` as `scripts/measure-overview-layout.mjs` does; (c) manual browser evidence only. Blocks: the browser-evidence requirement of QOS-192 and QOS-182.
12. **D12 Payment method and channel mapping.** The reporting labels for tenders (cash, card, delivery app settlements) and whether aggregator orders are a tender or a channel. Blocks: QOS-205 tenders, QOS-209 payments report, QOS-179.
13. **D13 Category reporting policy.** Reporting category per product, allocation rule, or non-additive category tags with the grand total from unique lines. Blocks: QOS-209 category totals.
14. **D14 New abilities inside the fixed roles.** Which of post stock, reverse, accept sales, manage integrations, apply imports are administrator-only versus any active member with location scope. Current code: publish and location administration are administrator-only; import preview and apply need any active membership. Blocks: every posting and apply leaf's permission checks.
15. **D15 Open PR hygiene.** Close or rebase PRs #4, #5 and #14 before QOS-193 touches the import code and before any `package.json` or lockfile change.
16. **D16 Branch naming for Phase 2 work.** Existing branches use `cursor/<topic>-<hash>`. Proposed: `qos-192/staff-nav-branch-context` and `qos-193/workbook-parse-export`, or the `cursor/` prefix if Nitesh prefers one convention.

## 7. Blockers

### 7.1 Provider-access blockers (QOS-162 track, parallel, not restated here)

- Leaves that cannot start until QOS-162 records authorised access: QOS-178 (blocked by 162 directly), and through it QOS-179, QOS-211, QOS-181, QOS-185, QOS-186 and QOS-184 (via 181).
- Facts pending QOS-162: provider choice (Loyverse or Foodics), account and branch mapping, authentication, read entitlements, pagination, source identifiers, line and modifier payload semantics, tenders, tax, discounts, refunds and voids, updated-record behaviour, limits, sandbox or approved read-only period.
- These do not block QOS-192, 193, 194, 195, 196, 197, 198, 199, 200, 201 to 204, 205, 206, 207, 208, 209, 210, or the fixture foundation QOS-163, 164, 166, 167, 168, 169, 170, 177.

### 7.2 Independent-work blockers

- Business decisions D1 to D14 (section 6). Each blocks only the posting or calculation named; menu, workbook, recipe-editing and inventory master-data work proceed.
- Deployed database state is Unknown (which migrations are applied, actual location ids). Resolved by Nitesh reading `drizzle.__drizzle_migrations` and `qos.locations` on the dev database.
- No browser end-to-end harness in the repo (D11).
- Full `npm test` was not executed in this session because it requires local Postgres; CI runs it with a Postgres service, so the baseline test result for the database suites is "not run here, expected to run in CI".
- The import panel column-mapping defect (section 1.13) is a source-inspected suspicion that needs confirmation in a running app; it affects QOS-193 planning, not QOS-192.
- Open PRs #4, #5 and #14 are conflicting drafts (D15).
- No Azure access was assumed or used. Shared-environment deployment is Nitesh's decision.

## 8. Exact first implementation proposal: QOS-192, then QOS-193

### 8.1 QOS-192 Extend staff navigation and branch context

**Branch (proposed):** `qos-192/staff-nav-branch-context` from `main` at `99d8106f` (or the `cursor/` prefix per D16). One PR, one leaf.

**Outcome:** the real staff shell gains a shared, server-validated branch context (single branch or authorised All Branches), Phase 2 entry points with honest unavailable states, a persisted and audited business-label mapping screen that starts Unmapped, and a reusable branch-change guard. No workbook parsing, no inventory tables, no sample-mode toggle.

**Files to change (existing):**

- `src/lib/staff/nav.ts`: add Phase 2 destinations to `STAFF_NAV_GROUPS`, `STAFF_MORE_NAV_GROUPS`, `STAFF_NAV_PATHS` and `PATH_MATCHERS` following the prototype's nesting (`phase2/Phase2.tsx` line 20): Inventory (Ingredients, Stock, Kitchen Prep), Finance (Sales input, Reports), Catalogue (Recipes, Import keeps its id), Settings (Branches). Every new destination points at one of the honest entry pages listed below, so there is no dead link. Mark destinations whose services do not exist yet with `availability: "soon"`: the command palette already honours that flag (`src/lib/staff/overlay.ts` line 85) and the More menu in `PortalTopBar.tsx` must be extended to render the existing `soon` copy key as a badge, because today it renders `STAFF_MORE_NAV_GROUPS` without checking availability. Keep the five header destinations unchanged (AC01).
- `src/lib/staff/nav.test.ts`: extend the href, More-group and active-path assertions for the new ids; assert that no Phase 1 destination moved.
- `src/lib/staff/locale.ts`: add English and Arabic copy for the new nav labels, "All branches", "Branch", "Unmapped", "Confirm mapping", "Save draft", "Discard", "Stay", "This area is not available yet", branch timezone and currency labels; extend `NAV_LABEL_KEYS`. `locale.test.ts` parity test covers the new keys.
- `src/components/portal/PortalTopBar.tsx`: add a branch picker next to the business picker (same `qos-menu` listbox pattern as lines 197 to 241) driven by new props `branches`, `activeBranch`, `allBranchesAllowed`, `onSelectBranch`; show timezone of the selected branch and tenant currency as secondary text (P2-CTX-07).
- `src/components/portal/portal-shell-context.tsx` and `src/components/staff/StaffAppShell.tsx`: load the branch context from the new API after the session loads; expose `branch` (selected location public id or `all`), `branches`, `allBranchesAllowed`, `setBranch`, `registerUnsavedWork` and `requestBranchChange` through the shell context; read the initial selection from the `branch` search parameter, then from `localStorage` key `qos-staff-branch:<tenantId>` as a preference only, and always validate against the server list (a stored or URL value that is not permitted falls back to the first permitted branch, or All Branches for administrators, with a visible notice).
- `src/lib/staff/staff-admin-i18n-audit.test.ts`: add every new component file to the audited list.
- `src/db/schema.ts`: add `locationBusinessLabels` (only if D2 option a; recommended).
- `drizzle/meta/_journal.json`: add the 0054 entry (only with D2 option a).

**Files to add (new):**

- `src/lib/staff/branch-context.ts`: types (`BranchContext`, `ALL_BRANCHES = "all"`), `listPermittedBranches(db, tenantId, membership)` (administrators: all active and suspended locations with status; users: locations joined through `staff_location_scopes`), `resolveBranchSelection(requested, permitted, role)`, `assertOperationalBranch(selection)` which throws `StaffAuthorizationError` for All Branches and for a location outside the permitted list, and `assertWarehouseBelongsToBranch` as an interface for later leaves (implemented when warehouses exist in QOS-196).
- `src/lib/staff/branch-context.test.ts` (unit) and `src/lib/staff/branch-context.integration.test.ts` (database).
- `src/app/api/tenants/[tenantId]/staff/branch-context/route.ts`: `GET` for any active member; returns permitted branches, `allBranchesAllowed` (administrators true; users true only for reads when they hold more than one scope, see note), tenant `baseCurrency`, and the label mappings. Note: whether a user with several scopes may use All Branches for reads is a D14 item; default proposal is yes for reads, never for postings.
- `src/app/api/tenants/[tenantId]/staff/branch-context/route.integration.test.ts`.
- `src/lib/tenant/location-labels.ts`: `listLocationLabels`, `confirmLocationLabel(db, tenantId, membership, { label, locationPublicId, expectedVersion })` (administrator only, rejects a location from another tenant, rejects a location already bound to another label, writes `tenant_audit_events` action `location.label.confirmed`), `clearLocationLabel` (audited). Seeds the three requested labels as Unmapped rows on first read for the tenant (idempotent insert) only if D2 option a.
- `src/lib/tenant/location-labels.integration.test.ts`.
- `src/app/api/tenants/[tenantId]/settings/branch-labels/route.ts` (`GET` any member, `PUT` administrator) and its integration test.
- `drizzle/0054_location_business_labels.sql` with RLS and grants per section 4.1, and `src/db/location-business-labels-migration.test.ts`.
- `src/components/staff/branch-change-guard.tsx`: `useUnsavedWork({ isDirty, saveDraft })` registration hook and the dialog built on `ConfirmDialog` or `Modal` from `src/design-system` offering Save draft, Discard and Stay. Save draft calls the registering screen's real save; if it fails the dialog stays open and the context is unchanged. Discard clears the registration; Stay cancels. Unit test with a fake registration.
- `src/app/tenants/[tenantId]/settings/branches/page.tsx` and `branch-mapping-screen.tsx`: table of the three labels with Unmapped or Confirmed state, the actual location list for confirmation, administrator-only actions, audit note, and an explanation that historical ids and transactions are not renamed (AC03). Uses `DataTable`, `StatusBadge`, `Select`, `PortalNotice`.
- Entry pages with honest states, no mock data: `src/app/tenants/[tenantId]/inventory/page.tsx`, `src/app/tenants/[tenantId]/kitchen/page.tsx`, `src/app/tenants/[tenantId]/sales/page.tsx`, `src/app/tenants/[tenantId]/reports/page.tsx`, `src/app/tenants/[tenantId]/catalogue/recipes/page.tsx`. Each renders `PortalPageHeader` plus an `EmptyState` that says the area arrives with its Phase 2 leaf (naming the leaf) and shows the current branch context; no buttons that pretend to work (AC35).

**Schema and migration:** one additive migration `0054_location_business_labels` if D2 option a is chosen; none if option b. Either way no change to Phase 1 tables. The migration is applied manually by Nitesh before deploying the API image.

**API changes:** two new read endpoints and one administrator write endpoint listed above. No existing endpoint changes. Deep links such as `/tenants/<id>/inventory?branch=<publicId>` are validated server-side on data loads; the branch query string never grants access.

**UI changes:** branch picker in the top bar; Phase 2 destinations under More and in the command palette; Settings, Branches mapping screen; five honest entry pages; branch-change guard dialog. Existing Phase 1 pages are untouched except that the shell now provides a branch context they may read later.

**Acceptance criteria mapping (live QOS-192 text to proposal):**

| Live criterion | How the proposal meets it | Evidence to record |
| --- | --- | --- |
| All existing Phase 1 views remain reachable; Catalogue, Menus and Integrations extended without duplicates | header unchanged, new ids added only; `nav.test.ts` asserts every id resolves and no duplicate ids | nav unit tests, screenshots of header and More |
| Dubai, Al Ain and Azur Cafe stay unmapped until an authorised user confirms; no rename or reassignment | labels are separate rows; confirmation requires administrator, same-tenant location, unique binding; `locations` rows are never updated | integration tests for confirm and clear, audit row assertion, cross-tenant 404 |
| Branch context survives compatible navigation and filters; unsaved work gets Save draft, Discard, Stay | selection in shell context plus URL `branch` param plus preference key; guard hook with the three actions | unit test for guard, browser evidence |
| All Branches only for permitted reads; every operational posting requires one branch and warehouse | `assertOperationalBranch` rejects `all`; API returns `allBranchesAllowed` per role | unit and integration tests calling the guard with `all` |
| Fresh real-data mode has no synthetic rows; disabling sample mode cannot expose fixtures | new pages render only server data or empty states; no `src/mocks` import; `catalogue-no-mocks.test.ts` pattern extended to the new pages | static test that new pages do not import mocks |
| Direct API access and deep links enforce tenant, branch and role; client role selector cannot grant permission | every route runs `requireStaffIdentity` and membership checks; user without scope gets 403; other tenant gets 404 | route integration tests |
| Branding, responsive shell, motion preference, keyboard focus, English and Arabic remain usable | reuse existing components and tokens; new copy in both locales; dialog focus and Escape; audit list extended | i18n audit test, contrast test, browser check at 360 px and RTL |

**Tests to add and exact commands:**

- `npx vitest run src/lib/staff/nav.test.ts src/lib/staff/locale.test.ts src/lib/staff/branch-context.test.ts src/components/staff/branch-change-guard.test.ts src/lib/staff/staff-admin-i18n-audit.test.ts src/__tests__/catalogue-no-mocks.test.ts`
- With local Postgres: `docker compose up db -d` then `TEST_DATABASE_URL=postgresql://qos:qos@localhost:5432/qos npx vitest run src/db/location-business-labels-migration.test.ts src/lib/tenant/location-labels.integration.test.ts src/lib/staff/branch-context.integration.test.ts "src/app/api/tenants/[tenantId]/staff/branch-context/route.integration.test.ts" "src/app/api/tenants/[tenantId]/settings/branch-labels/route.integration.test.ts"`
- Full gates before the PR: `npm run typecheck`, `npm run lint`, `npm test` (with the database), `npm run build`.
- Browser evidence per D11: sign in, switch branch, deep link with a forbidden branch, RTL at 360 px, reduced motion, keyboard through the guard dialog.

**Scope exclusions:** no workbook parser or export (QOS-193); no inventory, recipe, stock, sales or report tables or services; no change to the mock Orders, Customers, Analytics, Integrations, POS or Settings screens beyond adding the Branches sub-page under Settings; no sample-mode toggle (the real app has none; fixtures are governed by provenance and the dev-only seed guard); no changes to `package.json` or the lockfile; no deployment.

**Rough size:** about 22 files (9 changed, 13 added), roughly 1,300 to 1,800 lines including tests and the SQL migration.

**Redeploy targets:** API and web container `ca-qos-dev-api` only, after migration 0054 is applied manually. No video worker or AI worker change.

**Readiness statement:** QOS-192 is dependency-ready once this plan is accepted (its only blocker is QOS-160). It does not collide with PRs #4, #5 or #14.

### 8.2 QOS-193 Parse real workbooks and generate exports (separate PR, next)

- **Branch (proposed):** `qos-193/workbook-parse-export` from `main`; independent of the QOS-192 branch. QOS-194 later needs both merged.
- **Scope:** real byte parsing for two profiles: the legacy flat profile (unchanged behaviour and limits, CSV or first worksheet) and the named-table multi-sheet profile (headers at row 6, data from row 7, tables `QOS_*`, manifest `QOS_Workbook_Context`, `row_check` and guidance sheets excluded, formulas never evaluated, identifiers kept as text). Profile detection by the presence of `QOS_Workbook_Context` and the named tables, never by file name. Blank 31-sheet XLSX template generated with exceljs from the contract, with no invented tenant, brand, namespace, revision or timestamp. Current-record export of the supported existing entities (branches, categories, products, product categories, variants, branch prices, modifier groups, options, product modifiers, menus, menu branches, sections, items) with `qos_*_id`, source keys, `expected_revision` tokens and immutable context, generated through an authorised route. Unsupported and future sheets (Units through Combo Components until their services exist; Future Combos and Combo Components permanently in Phase 2) are reported as deferred or rejected, never as imported.
- **Reuse:** `catalogue-import-xlsx.ts` load and write helpers (extend with a named-table reader; the installed exceljs exposes `worksheet.getTables()`, `getTable(name)` and `addTable(...)` in `node_modules/exceljs/index.d.ts` lines 1361 to 1373), `IMPORT_LIMITS` for the legacy profile with new bounded limits for the expanded profile, `sanitizeSpreadsheetCell`, `catalogue-import-sample.ts` as the model for the template route, existing product, variant, category, modifier and menu read services for the export.
- **New:** `src/lib/workbook/{profiles,reader,manifest,template,export}.ts`, routes `GET /api/tenants/[tenantId]/catalogue/workbook/template`, `GET .../workbook/export`, `POST .../workbook/parse`, import landing screen changes in `src/app/tenants/[tenantId]/catalogue/import/` to offer the two profiles and the two downloads; fix the column-mapping panel defect from section 1.13 if confirmed.
- **Migrations:** none proposed for QOS-193 (stateless parse and export). QOS-194 introduces the persisted operation rows.
- **Tests:** real workbook bytes from the pack (copied into `fixtures/workbook/` with an edited copy proving that changed cells change parsed output), malformed file, wrong type, unknown schema version, oversize and empty inputs, leading-zero SKU retention, template validity reopened with exceljs, export authorisation (database test), unsupported-sheet classification. Legacy profile tests in `catalogue-import-parser.test.ts` must remain green.
- **Exclusions:** no server-side cross-sheet validation or review UI (QOS-194), no apply (QOS-200), no new tables.

## 9. Leaf sequencing from live relations

Waves are derived from the live `blockedBy` relations; within a wave the leaves are independent of each other. A wave starts when its blockers are merged, not when their PRs are opened.

1. QOS-160 (this plan) and QOS-162 (parallel discovery, separate agent).
2. After QOS-160: QOS-192 (first PR), QOS-193 (second PR, independent branch), QOS-161 (decision register, no code), QOS-163 (contract document and types).
3. After QOS-192: QOS-195 (also needs 160), QOS-196. After QOS-192 and QOS-193: QOS-194. After QOS-163: QOS-164. After QOS-163 and QOS-192: QOS-205.
4. After QOS-195 and QOS-196: QOS-197. After QOS-161, QOS-195 and QOS-196: QOS-201. After QOS-163 and QOS-164: QOS-167.
5. After QOS-197: QOS-198. After QOS-197 and QOS-201: QOS-202. After QOS-201: QOS-203. After QOS-201 and QOS-203: QOS-204.
6. After QOS-198: QOS-199. After QOS-192 and QOS-198: QOS-207. After QOS-196 and QOS-207: QOS-208.
7. After QOS-163, QOS-199, QOS-201 and QOS-205: QOS-206. After QOS-163, QOS-164, QOS-205 and QOS-206: QOS-166. Then QOS-168 (166, 167), QOS-169 (164, 166), QOS-170 (163, 166, 168), QOS-177 (166, 169).
8. After QOS-164, 194, 195, 196, 197, 198, 199 and 208: QOS-200 (expanded apply; must not start before every supported sheet has its target handler).
9. After QOS-199, 202, 203, 204 and 206: QOS-209. After QOS-192 and QOS-209: QOS-210.
10. Provider track, after QOS-162: QOS-178 (also 163, 164), QOS-179 (178, 164, 198, 199), QOS-211 (166, 178, 179), QOS-181 (170, 211).
11. Acceptance: QOS-182 (170, 177, 199, 200, 202, 203, 204, 206, 207, 208, 210), QOS-183 (166, 170, 200, 201, 204, 206, 208), QOS-184 (177, 181, 210), then QOS-185 (181, 182, 183, 184), then QOS-186 (182, 183, 184, 185), which unblocks QOS-154.

Deferred issues QOS-157, 165, 171 to 176 and 180 are outside this sequence and are not gates.

## Appendix A. Prototype discrepancy list

Source inspection of `reference/claude-prototype/` (paths relative to `qos/app/`). Each item is a behaviour the implementation must replace, grouped by the QOS-160 acceptance criterion that asks for it.

Fake import parsing and fixture leakage:

- `phase2/P2Import.tsx` 22 to 44: `demoRows()` hard-coded results; 59 to 70: `upload()` never reads bytes, rejects `.xlsx` by file name only; 72 to 86: `apply()` appends history, creates nothing; `reapply()` relabels rows Unchanged; 118 to 130: "template" is a sheet-index CSV, export uses SKU as `source_id` and omits ids, revisions and Arabic names; revalidate only drops Conflicting rows (180).
- `page.tsx` 31: `useP2(true)` seeds sample data on first load; `phase2/P2Setup.tsx` 116 to 118: turning sample off only flips a flag, reset reseeds sample; `p2-core.ts` 135 to 187: sample maps Dubai to `loc_hbz` while Phase 1 data places HBZ Stadium in Abu Dhabi (`prototype-data.ts` 19).
- `page.tsx` 26 and 53: the Phase 1 branch list and the Phase 2 branch picker share one state, so a Phase 1 value can carry into Phase 2 views.

Recipe selection and replacement:

- `p2-core.ts` 221 to 245 (`consumption()`): first recipe whose product matches and is not Superseded; may pick a Draft; ignores variant and effective date; matches modifiers by `optionName` text; REPLACE handled as ADD (`sign` only negative for REMOVE); effect quantity not divided by yield while base lines are; unknown units treated as recipe units; negative totals clamped to zero.
- `phase2/P2Recipes.tsx` 47, 132, 180, 195: lines, effects and steps edited on Approved versions; approval (104 to 108) supersedes by display name, stores no approver or timestamp; `replacesLineKey` declared but never set; "Add first step" inserts placeholder text; shared recipes and direct-stock links are display-only claims.

Draft reporting and as-of errors:

- `phase2/P2Reports.tsx` 28 to 29: closings filtered by date but not status (Drafts included); movements filtered by branch only, dates ignored; 83: stock report ignores as-of; margin report uses current costs with tax basis UNCONFIRMED; 46 to 56: `exportXlsx` writes CSV; drill-through exists for one report and loses the selected record.

Missing editors:

- Kitchen targets are seeded and read-only (`phase2/P2Kitchen.tsx`); no supplier, ingredient or unit edit or archive actions (`P2Inventory.tsx`, archive only mentioned at 84); no sales correction editor (`P2Sales.tsx` 194 toast only); no unsaved-change guard on branch change (admitted in `PHASE2_HANDOVER.md` line 28); no Arabic UI mode (`layout.tsx` 22 `lang="en"`, `dir=rtl` only on three data fields).

Simulated POS and stock concurrency:

- `phase2/P2Pos.tsx` 26 to 58: simulated connection and fixed import (14 November 2026, 42 records, AED 1,860); overlap is explanatory text (147 to 148); proof record hard-coded Not run and never written.
- `phase2/P2Stock.tsx` 27 to 42: posting checks only that a warehouse exists, All Branches warning does not block, `setTimeout` posting, op keys checked client-side before the delayed write; waste and correction keys use `Date.now()` so retries duplicate; opening rejected whenever any opening exists (129 to 130); count "Reconcile" moves the cutoff to now (216); reversal of any movement including openings (45 to 52); `balances()` ignores valuation policy and units (`p2-core.ts` 249 to 260); negative-stock check per row against current balance only, skipped for sales and reversals.
- `phase2/P2Kitchen.tsx` 33 and 76: conflict simulation is dead code or fires when `rev > 1`; Reload does not refresh the baseline.
- `phase2/P2Sales.tsx` 36: reconciliation difference ignores tax; status jumps Draft to Posted; one free-text modifier per line.

`PHASE2_HANDOVER.md` coverage labels (lines 21 to 49) are claims, not test evidence; the handover itself lists the gaps above at lines 28, 32, 41, 47 and 86 to 94.

## Appendix B. Commands executed for this plan

All commands ran in `/workspace/qos-phase2/work-qos160` unless stated. No database connection was opened, no migration, seed, import or verify script was run, no network call to a provider was made, nothing was committed or pushed.

| Command | Purpose | Outcome |
| --- | --- | --- |
| `git log -1 --format='%H%n%s%n%ad%n%an'`, `git status --porcelain`, `git branch --show-current`, `git remote -v`, `git branch -a`, `git tag`, `git log --oneline -25` | baseline | values in section 1.1 |
| `git log -1 origin/<branch>` and `git diff --stat main...origin/<branch>` for the three PR heads | collision check | section 1.5 |
| `cat package.json`, `.github/workflows/ci.yml`, `AGENTS.md`, `CLAUDE.md`, `drizzle.config.ts`, `vitest.config.ts`, `tsconfig.json`, `README.md`, `docs/README.md` | baseline | sections 1.2 to 1.7 |
| `ls drizzle`, `python3 -I` read of `drizzle/meta/_journal.json`, `grep` for RLS statements | migrations | section 1.6 |
| `node --version` | local runtime | v24.22.1 (CI uses 22) |
| `npm ci --no-audit --no-fund` | install from lockfile | exit 0, 669 packages added in 10 s, deprecation warnings only, lockfile unchanged |
| `npm run typecheck` | baseline | exit 0 |
| `npm run lint` | baseline | exit 0, 0 errors, 34 warnings |
| `npx vitest run src/components src/__tests__ src/design-system src/app/tenants src/app/dev src/lib/staff/nav.test.ts src/lib/staff/locale.test.ts src/lib/staff/workspace.test.ts src/lib/staff/overview.test.ts src/lib/staff/staff-admin-i18n-audit.test.ts src/lib/staff/post-sign-in.test.ts src/lib/staff/overlay.test.ts src/lib/staff/config.test.ts src/lib/catalogue/catalogue-import-parser.test.ts src/lib/catalogue/catalogue-import-validation.test.ts src/lib/catalogue/import-report.test.ts src/lib/catalogue/finedine-menu-extract.test.ts src/lib/audit/tenant-audit-action-label.test.ts src/lib/tenant/tenant-status.test.ts src/lib/tenant/repository.test.ts` | unit-only baseline, no database suites | exit 0, 36 test files passed, 298 tests passed, 6.99 s |
| `npm test` (full suite) | not run | 86 suites would attempt a localhost Postgres connection; forbidden in this session |
| `npm run build`, `npm run build:worker`, `npm run build:ai-worker`, `npm run audit:ci` | not run | not needed for planning |
| `python3 -I` with `zipfile` and `re` over `requirements/QOS_Menu_and_Operations_Template.xlsx` | real workbook bytes: sheet names, table names, ranges, columns | section 1.14 |
| `python3 -I` with `json` over `requirements/QOS_Workbook_Data_Contract.json` | contract layout, sheets, rules, formulas | section 1.14 |
| Read-only inspection (Read, Grep, Glob) of `src/**`, `drizzle/**`, `docs/**`, `scripts/**`, the pack and the live Linear export; three read-only exploration subagents for schema and auth, staff app and import, and the prototype, whose findings were spot-checked against the files cited in this document | evidence | sections 1 to 3 and Appendix A |
