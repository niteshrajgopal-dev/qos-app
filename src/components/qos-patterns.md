# QOS staff UI patterns

Source of truth: `docs/CURSOR_HANDOFF.md` plus `design-system/`. Tokens live in `src/app/qos-tokens.css`. Component CSS lives in `src/app/qos-components.css`. Do not restyle the Quotes storefront with these classes.

## Tokens and primitives

Use the typed wrappers in `src/components/` instead of page-local zinc styles:

| Pattern | Use |
| --- | --- |
| Button / ButtonLink / IconButton | `qos-btn` / `qos-iconbtn` via the typed components |
| Field + Input | labelled controls; `qos-input`, `qos-textarea`, `qos-select` |
| PageHeader | one title per staff screen |
| Card | sectioned editors, lists, and publishing panels |
| Alert | error / success / warning / permission copy |
| EmptyState | zero-result lists |
| StatusBadge | schema-backed states only (`map-db-status` + `qos-states`) |

Raw `className="qos-*"` is allowed on existing editors so business logic stays untouched.

## App shell

Authenticated tenant pages render inside `StaffAppShell` + `StaffScreen`. Auth pages (sign-in, request access, invitation accept, platform onboarding) use `StaffAuthFrame`.

Navigation order is fixed: Home, Orders, Catalogue, Customers, Sales Channels, Locations, Integrations, Analytics, Team, Settings. Unbuilt destinations stay visible and disabled with **Soon**. Do not invent Orders, POS, or analytics dashboards.

## Forms and editors

Product, menu, modifier, import, location-price, availability, and storefront theme/content editors use:

- `qos-card` for each section
- `qos-input` / `qos-textarea` / `qos-select` for fields
- `qos-btn` primary for the committing action, secondary for load/preview, danger for destructive row actions
- `qos-alert` `data-tone="error"` for request failures

Do not rewrite save/load/publish logic when applying these classes.

## Lists and tables

Menus, products, import preview grids, audit events, and access requests use cards or `qos-table` / overflow wrappers. Empty lists use `EmptyState`. Status chips use `StatusBadge`, not raw enum strings.

## Publication and approval

Menu publish, storefront publish/rollback, and translation approve/reject stay server-enforced. Hide or disable controls from the API role, then explain with `qos-alert` `data-tone="warning"` when the session is not Administrator. Never enable a publish/approve control only because it is styled.

## Locale and RTL

`StaffLocaleProvider` persists `en` | `ar` and sets `document.dir`. Shell labels and the sign-in form read `staffUiCopy` / `staffNavLabel`. Arabic uses `--font-arabic` (Noto Sans Arabic). Representative screens: sign-in, tenant Home, sidenav, and the Arabic translation review column (`dir="rtl"`).

## Permission states

Styling is not authorization. Protected routes and mutations still go through staff session + tenant membership + role checks. Client chrome may show **Soon** or a warning alert; the server must still reject unauthorized actions.

## Deferred surfaces

Command palette, modal/drawer kit, Orders, Customers, Categories, Integrations/POS, Analytics, and Settings are not implemented as staff workflows. Each has a linked Linear follow-up from QOS-59. Keep those nav items disabled until the follow-up lands.
