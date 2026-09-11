# QOS Phase 1 — Cursor Development Handover & Implementation Brief

## Purpose

Use this document as the authoritative starting brief for developing QOS Phase 1 in Cursor.

QOS is a reusable, multi-tenant business operating system and headless platform. Customer-facing websites are not bespoke deployments. They run on a shared QOS Storefront Platform.

Quotes is Customer #1 and must become the first branded configuration of the shared Storefront Platform.

A synthetic flower shop will be Customer #2 and will be used to prove that the same application image, Azure Container App, Front Door route and core APIs can serve a second tenant with different branding and content.

---


# 0. Linear Is the Executable Source of Truth

This handover is **not** the backlog.

Use it for:
- architecture
- Azure/deployment baseline
- product boundaries
- security/tenancy guardrails
- development conventions
- the execution protocol

Use **Linear** for:
- what to build next
- issue scope
- dependency/blocker relationships
- milestone/order
- acceptance criteria
- decisions and issue comments
- implementation evidence
- completion state

Linear document:
- `Cursor Execution Protocol — Phase 1`
- https://linear.app/qosapp/document/cursor-execution-protocol-phase-1-2b0b2ec7ac62

When the handover and current Linear state differ, do not blindly follow a hard-coded sequence in this document. Refresh Linear and follow the current approved issue/dependency state.

## Source-of-truth precedence

1. Explicit owner decisions recorded in the Phase 1 Product Discovery and Decision Register and later Linear issue updates/comments.
2. Current Linear issue description, relations, milestone, labels, status and acceptance criteria.
3. This handover for architecture/infrastructure/guardrails.
4. Repository documentation/code after checking whether it is stale.

Do not invent a product decision to resolve a conflict.

## The repeated Cursor command

The owner should be able to say:

> **Work on the next thing.**

Every time that instruction is given, Cursor must:

1. Refresh the QOS project in Linear.
2. Read the full candidate issue, comments, linked decisions and `blockedBy` / `blocks` relationships.
3. Select the next eligible issue based on dependency order first, then milestone need, then priority.
4. Never select an issue simply because its number is lowest or because it appears next in this handover.
5. If the issue is blocked by an unresolved owner decision, credential, external account or required source artifact, do not guess.
6. Move only the selected issue into active work using the team's current Linear status.
7. Before coding, inspect the relevant code/database state and map the implementation plan directly to the issue acceptance criteria.
8. Implement the smallest coherent solution that satisfies the issue.
9. Run typecheck, lint, tests, build and all issue-specific migration/security/API checks.
10. Update the Linear issue with implementation evidence, test results, deployment/validation evidence and known exclusions.
11. Mark the issue Done only when the actual acceptance criteria are met.
12. Re-query Linear before choosing the next issue.

If an issue is blocked but another issue is genuinely independent and unblocked, Cursor may proceed with that issue. It must not bypass a prerequisite that would make downstream work unsafe.

Items labelled `Needs decision` may only be implemented to the extent explicitly allowed by Linear. Mocks/fixtures may be used only where the issue says they are allowed.

## Current starting point

At the time this handover was updated:

- `QOS-5` — **Record the existing QOS source, migration and deployment baseline** — is unblocked and blocks the first tenant/data implementation work.
- `QOS-7` — **Add the one-owner tenant/location migration with runtime isolation tests** — is blocked by QOS-5 and blocks much of the tenant-dependent Phase 1 backlog, including Storefront work.

Therefore the expected initial path is:

`QOS-5 -> refresh Linear -> QOS-7 if still next/eligible -> refresh Linear -> next eligible issue`

This is an initial state, not a permanently hard-coded backlog order.

---

# 1. Current State

Development has not materially started yet. The repository is still essentially a skeleton.

The development infrastructure is already established and working.

## Azure development baseline

Subscription:
- QOS Development
- Subscription ID: `164f1f74-6340-4704-ab96-3224a3552606`

Resource group:
- `rg-qos-dev-core`

Region:
- UAE North

Existing services:
- QOS API Container App: `ca-qos-dev-api`
- Shared Storefront Container App: `ca-qos-dev-storefront`
- Container Apps Environment: `cae-qos-dev`
- ACR: `qosdevacr`
- PostgreSQL Flexible Server: `psql-qos-dev`
- Database: `qos_db`
- PostgreSQL schema: `qos`
- Storage: `stqosdev`
- Admin/legacy Key Vault: `kv-qos-dev`
- Runtime Key Vault: `kv-qos-dev-runtime`
- Storefront managed identity: `id-qos-dev-storefront`

Azure Front Door:
- Profile: `afd-qos-dev`
- Endpoint: `qos-dev-storefront`
- Route: `route-qos-dev-storefront`
- Origin group: `og-qos-dev-storefront`
- Origin: `origin-qos-dev-storefront`

Customer development hostname:
- `quotes.dev.qosapp.com`

Verified end-to-end health:
- `https://quotes.dev.qosapp.com/api/health`
- returns HTTP 200
- response: `{"status":"healthy","service":"qos-storefront"}`

Caching is currently disabled at Front Door.

Do not redesign or replace this infrastructure unless explicitly requested.

---

# 2. Existing Deployment Scripts

Preserve the existing deployment scripts and their established purpose.

QOS repository:
- `C:\Dev\qosapp`

Scripts:
- `C:\Dev\qosapp\deploy\build-and-push-to-acr.ps1`
- `C:\Dev\qosapp\deploy\deploy-to-acr.ps1`

The build script already supports using a different `ImageName`, `ImageTag` and `ProjectRoot`.

The deploy script updates an EXISTING Azure Container App. It does not create the Container App, identity, ingress, environment variables, scaling configuration or Azure resources.

Do not replace these scripts with a new deployment mechanism without a deliberate architectural decision.

---

# 3. Target Architecture

## Shared SaaS deployment model

Default Phase 1 model:

- ONE shared QOS API.
- ONE shared Storefront Web runtime.
- ONE shared Storefront Web image.
- ONE shared Azure Container App for standard storefront tenants.
- Multiple tenant/customer domains routed to the same renderer.
- One shared QOS database with strict tenant isolation.
- No per-customer database by default.
- No per-customer Container App by default.
- Storefront runtime never connects directly to PostgreSQL.
- Storefront runtime receives no admin database, OpenAI, payment-admin or unrelated platform secrets.

Customer content publication must produce a new immutable `StorefrontRelease`.

Publishing customer content must NOT deploy a new application/container revision.

Application deployments and tenant Storefront Releases are separate concepts.

---

# 4. Important Development Principle

## Yes: backend foundations come first.

However, do NOT build every database table in the entire product before writing any APIs.

Use thin backend vertical slices:

1. Define the minimum domain model required for the capability.
2. Add the versioned database migration.
3. Add repository/service/domain logic.
4. Add API contract.
5. Add authorization and tenant-isolation enforcement.
6. Add automated tests.
7. Only then build UI/client behavior on top of the stable contract.

The first meaningful code should therefore be database/migration foundations and APIs, before building the QOS admin UI or converting Quotes into the dynamic multi-tenant renderer.

---

# 5. Recommended Development Sequence

## Stage 0 — Repository and Database Discovery

Before changing code, Cursor must inspect:

- existing source structure
- `package.json`
- `drizzle.config.ts`
- `src/db/index.ts`
- `src/db/schema.ts`
- `drizzle/`
- API route structure
- auth/middleware structure
- test structure
- environment/config loading
- Dockerfile/deployment structure
- current database objects in the `qos` schema

Important known fact:

- the checked-in Drizzle schema currently contains no real tables
- the checked-in `drizzle/` directory contains no generated migration history

Therefore Cursor must NOT assume that:
- PostgreSQL is empty, or
- the checked-in schema accurately describes the deployed database.

Before creating migration `0000`, inspect the actual development database schema and determine whether:
1. the database is effectively empty and can begin from a clean baseline, or
2. existing objects must first be represented/baselined into Drizzle.

Do not use `drizzle-kit push` as the production migration strategy.

Use versioned migrations.

---

# 6. Stage 1 — QOS Core Multi-Tenant Foundation

Create the minimum shared platform entities needed before business features.

The model must support:

`Tenant -> Organization -> Brand -> Location`

and staff access to the appropriate scope.

Required foundations include:

- Tenant
- Organization
- Brand
- Location
- Staff identity/membership
- fixed Phase 1 roles:
  - Administrator
  - User
- scope assignments
- audit event
- timestamps
- stable internal IDs
- opaque public/external IDs where exposed

## Authorization requirements

Never trust a client-supplied `tenantId` as authorization.

Tenant context must come from authenticated server-side membership/session context.

Foreign-tenant associations must fail server-side.

Administrator-only operations include:
- manage staff
- manage locations
- manage integrations
- approve translations
- manage prices
- manage coupons
- manage fees
- publish menus
- temporary stop-sale / live unavailability

User role may:
- create/edit permitted drafts
- manage permitted content/media
- prepare catalogue/menu changes

User role may NOT:
- change live prices
- publish
- change live availability
- approve translations

---

# 7. Stage 2 — Storefront Platform Data Model

Implement Linear QOS-50 after the core tenant/brand/location model exists.

Required concepts:

## Storefront

A Brand may have more than one Storefront.

Do not enforce:
- one tenant = one storefront
- one brand = one storefront

Suggested responsibilities:
- internal ID
- public opaque ID
- tenant ownership
- brand ownership
- name
- slug/code
- status
- default locale
- supported locales
- active release reference
- optimistic version/concurrency field
- audit metadata
- timestamps

## StorefrontDomain

Maps a verified hostname to a Storefront.

Examples:
- `quotes.dev.qosapp.com`
- later `flowers.dev.qosapp.com`

Requirements:
- globally unique normalized hostname
- tenant/storefront ownership
- domain type
  - platform subdomain
  - custom domain
- verification lifecycle
- active/inactive lifecycle
- primary-domain flag
- audit metadata

Unknown hosts must never default to Quotes.

## StorefrontLocation

Explicitly maps locations that a Storefront is allowed to expose.

A storefront may expose:
- one location
- multiple locations

Do not infer all tenant locations are automatically public.

## StorefrontRelease

Represents an immutable published storefront configuration.

A published release must never be modified in place.

Editing a draft must not mutate the active release.

A release should carry/snapshot the allowlisted storefront configuration required by clients, including:
- release identifier
- storefront identifier
- brand/theme configuration
- supported locales
- navigation
- page/content block configuration
- allowed locations
- feature flags
- published collection/menu references
- publication metadata

Pricing/product authority remains in QOS APIs rather than allowing arbitrary price data in the theme/configuration payload.

---

# 8. Stage 3 — Storefront APIs

Implement APIs before refactoring the customer-facing website.

The exact route structure should follow the existing project conventions discovered by Cursor, but semantically the platform needs:

## Administrative Storefront APIs

Examples of capabilities:
- create storefront
- update storefront draft metadata
- assign locations
- manage domains
- manage theme/content drafts
- validate draft
- publish storefront release
- list releases
- activate/rollback release

All write operations must enforce:
- tenant isolation
- role authorization
- concurrency/version rules
- audit logging

## Public Host Resolution API

The shared Storefront Web runtime must be able to resolve the incoming hostname.

Semantic contract:

`hostname -> StorefrontDomain -> Storefront -> Tenant/Brand -> Active StorefrontRelease`

Requirements:
- normalize hostnames
- reject unknown hosts
- reject inactive/unverified host mappings
- no Quotes-specific hostname `if` statements
- never trust a public tenant ID from the browser
- return only public/allowlisted information

## Public Storefront Manifest API

Implement Linear QOS-51.

The manifest is a versioned semantic contract for:
- shared web renderer
- future native Android client

Example shape:

```json
{
  "schemaVersion": "1",
  "storefrontId": "opaque-public-id",
  "releaseId": "opaque-release-id",
  "brand": {
    "name": "Quotes"
  },
  "locales": ["en", "ar"],
  "locations": [
    {
      "id": "opaque-location-id",
      "slug": "hbz-stadium",
      "name": "HBZ Stadium"
    }
  ],
  "navigation": [],
  "pages": [],
  "theme": {},
  "features": {
    "accounts": true,
    "basket": true,
    "checkout": true
  }
}
```

This is configuration, not a duplicate product database.

---

# 9. Stage 4 — Catalogue and Menu Foundations

Once tenant/storefront foundations are stable, implement shared business catalogue capability.

Required Phase 1 areas:
- supplier foundation
- material foundation
- unit foundation
- recipe foundation
- products
- variants
- modifiers
- price options
- discounts
- availability
- menu / collection structure
- location assignments
- publication state
- media associations

The QOS menu management UI should follow the supplied FineDine reference behavior, but the data model must remain generic QOS domain logic.

Quotes-specific categories or coffee assumptions must not be embedded into core tables.

---

# 10. Stage 5 — Publication Model

Implement draft/live publication semantics before exposing dynamic live content.

Important rules:
- drafts are editable
- releases are immutable
- Administrators publish
- Users may prepare permitted drafts
- publication creates a new release/version
- rollback activates a previous immutable release
- publication history remains auditable
- scheduled publication and stop-sale behavior must not mutate historical releases

Arabic rule:
- if a bilingual release requires Arabic and the required Arabic content is missing/unapproved, block the NEW release
- keep the previous approved release live
- do not silently fall back to English after the customer explicitly selected Arabic

---

# 11. Stage 6 — Refactor Quotes into the Shared Renderer

Only after host resolution and manifest APIs work should the Quotes frontend be changed.

Quotes repository:
- `https://github.com/niteshrajgopal-dev/quotes.git`

Target change:

From:
- bespoke Quotes application

To:
- reusable `qos-storefront` renderer
- Quotes supplied as tenant/storefront configuration

Incoming request:

`quotes.dev.qosapp.com`

must resolve dynamically to:

- Quotes tenant
- Quotes brand
- Quotes storefront
- active StorefrontRelease
- allowed Quotes locations
- Quotes theme/content

No code such as:

```ts
if (host === "quotes.dev.qosapp.com") {
  return quotesConfig;
}
```

is acceptable as the final architecture.

---

# 12. Quotes Customer #1 Configuration

Known Quotes brand palette:
- Espresso `#2F2322`
- Mocha `#4A3836`
- Latte `#CBB792`
- Cream `#F5F1E9`
- Black `#000000`

Typography:
- Recoleta Bold headings
- Inter body

Known Quotes locations/menu mappings:

HBZ Stadium
- FineDine menu ID: `67484e5e5df4f98ece1ab9ce`

HCT Academic City
- FineDine menu ID: `6a8bc60f1f68af6caa145e1a`

Al Ain Zoo
- FineDine menu ID: `6a964bc62c6dddd8bd3c2fa7`

Do not claim that full production catalogue/pricing data has already been imported.

---

# 13. Stage 7 — Customer Authentication and Basket

Customer-facing auth:
- email/password
- Google
- Microsoft

Browsing and anonymous basket:
- allowed

Checkout:
- verified sign-in required

Required customer data:
- name
- verified email

Optional:
- phone

Not required in Phase 1:
- customer address

Basket rules:
- account basket recovery
- never silently merge anonymous and account baskets
- if both exist, user must explicitly choose:
  - keep account basket
  - use current basket
  - review/merge
- never merge across:
  - tenant
  - storefront
  - branch/location
  - currency

---

# 14. Stage 8 — Authoritative Quote and Stripe Sandbox

Backend must calculate the authoritative commercial quote.

Do not trust browser-calculated totals.

Phase 1:
- AED
- coupon capability
- service/delivery fee capability
- configurable/versioned pricing rules
- Stripe sandbox only

Open items that must NOT be guessed:
- tax rate
- tax inclusive/exclusive treatment
- service fee amount
- service fee mode
- final stacking rules beyond approved Phase 1 defaults

No real charges.

---

# 15. Stage 9 — Customer #2 Portability Proof

After Quotes works dynamically through host resolution and manifest rendering, add a synthetic flower customer.

Create:
- second tenant/brand
- flower locations/content/products
- flower storefront
- flower domain

Expected development hostname:
- `flowers.dev.qosapp.com`

Then prove:

`quotes.dev.qosapp.com`
- Quotes configuration

`flowers.dev.qosapp.com`
- Flower configuration

while both use:
- same application code
- same Storefront Web image
- same Azure Container App
- same Azure Front Door profile/route pattern
- same QOS API
- same shared database platform
- tenant-isolated data

This is the main architectural proof that the Storefront Platform is reusable.

---

# 16. Security Requirements

## Storefront runtime

Must NOT receive:
- PostgreSQL credentials
- database connection string
- admin Key Vault access
- OpenAI admin secret
- unrelated tenant secrets

Storefront accesses business data through QOS APIs.

## Azure Front Door hardening

Current custom-domain routing is working.

Later hardening:
- validate `X-Azure-FDID`
- then restrict origin access appropriately
- do not break the existing health/deployment path before replacement validation exists

Do not hard-code stale Front Door IP ranges.

---

# 17. Caching Rules

Front Door caching is currently disabled.

Do not enable broad shared caching until the tenant-safe cache contract is implemented.

If/when enabled, public cache keys must account for appropriate dimensions such as:
- tenant/storefront
- location
- locale
- currency
- release
- path

Never shared-cache:
- authenticated account routes
- basket
- checkout
- payment result/status
- personalized responses

---

# 18. Logging / Observability

Structured logs should be designed to include non-secret identifiers such as:
- request_id
- tenant_id
- storefront_id
- resolved domain
- location_id
- locale
- active release ID

Never log:
- passwords
- access tokens
- payment secrets
- connection strings
- full secret values

---

# 19. AI / OpenAI Rule

OpenAI paid calls are disabled until the owner explicitly approves:
- budget
- models
- quotas
- secret provisioning

Development may implement:
- adapter/interfaces
- mocked provider
- fixtures
- review/provenance model
- tests

Do not add a real OpenAI key or make paid calls without explicit approval.

Never commit secrets.

---

# 20. Android

Android is a Phase 1 stretch goal.

Future client:
- React Native / Expo
- signed APK

It should consume the same semantic Storefront Manifest and business APIs.

Do not make web implementation decisions that prevent a native client.

Do not substitute a PWA for the requested Android APK.

---

# 21. Development Guardrails for Cursor

Cursor must:

1. Inspect before modifying.
2. Preserve working Azure/deployment infrastructure.
3. Preserve existing deployment scripts unless explicitly approved.
4. Use versioned database migrations.
5. Never use client-provided tenant identifiers as authorization.
6. Keep Quotes-specific styling/config out of core domain logic.
7. Keep storefront runtime database-free.
8. Keep release publication separate from app deployment.
9. Add automated tests for tenant isolation and authorization.
10. Avoid introducing technology or infrastructure not required by the approved architecture.
11. Do not invent product decisions that are explicitly still open.
12. Do not silently rewrite unrelated working code.
13. Prefer small, reviewable commits / changesets.
14. Before each implementation stage, explain:
    - files to change
    - schema/API impact
    - migrations
    - tests
    - rollback implications
15. After each stage, run:
    - typecheck
    - lint
    - tests
    - build

---

# 22. Initial Cursor Task

When development officially starts, give Cursor this instruction:

> Read the QOS Phase 1 Cursor Development Handover and connect to/refresh the QOS project in Linear. Linear is the executable source of truth; the handover is architecture and guardrails. Do not modify code yet. Determine the next eligible Linear issue from the current dependency graph and read its full description, comments, linked decisions and relations. Produce a plan mapped to that issue's acceptance criteria. For the current recorded state, QOS-5 is expected to be first because it is unblocked and blocks the tenant foundation, but verify that in Linear before proceeding. Do not use `db:push`, do not create migrations during discovery, do not change Azure infrastructure unless the selected Linear issue explicitly requires it, and do not touch the Quotes repository unless the selected issue requires it.

After reviewing Cursor's first plan, implementation can begin.

For every subsequent cycle, the owner can simply say:

> **Work on the next thing.**

Cursor must then follow the Linear execution loop defined in Section 0.

---

# 23. First Implementation Slice After Discovery

Unless repository/database discovery reveals a reason to change the order, the first implementation slice should be:

1. establish versioned Drizzle migration baseline
2. create Tenant / Organization / Brand / Location foundation
3. create Staff membership / Administrator/User role model
4. add tenant-context resolution server-side
5. add authorization helper/service
6. add audit-event foundation
7. add minimal administration APIs
8. add cross-tenant negative tests
9. verify runtime `qos_app` permissions
10. deploy and validate without changing storefront behavior

Then proceed to Storefront / Domain / Release.

---

# 24. Relevant Linear Work

Key Storefront Platform issues:
- QOS-50 — Storefront, Domain and immutable Storefront Release entities
- QOS-51 — versioned Storefront Manifest
- QOS-52 — refactor Quotes into tenant #1 of reusable renderer
- QOS-53 — resolve verified hostnames to correct storefront and reject unknown hosts
- QOS-54 — shared Development storefront runtime
- QOS-55 — Azure Front Door in front of shared storefront runtime
- QOS-56 — tenant subdomains and verified custom-domain lifecycle

Infrastructure for QOS-54 through QOS-56 has been substantially established.

The next development work is the application/data foundation that enables QOS-50 through QOS-53.

---

# 25. Definition of Success for the Storefront Foundation

The foundation is successful when:

1. Quotes is represented as tenant/storefront data, not a code special case.
2. `quotes.dev.qosapp.com` resolves to Quotes through persisted domain mapping.
3. Unknown hostnames are rejected.
4. Quotes renders from a published Storefront Manifest/release.
5. Editing a draft does not change the live release.
6. A second flower tenant can be created without schema changes or new application code.
7. `flowers.dev.qosapp.com` renders the flower configuration using the same shared runtime.
8. Cross-tenant access fails at server/API/database boundaries.
9. No storefront runtime has direct database credentials.
10. Customer content publishing does not create an Azure application deployment.
