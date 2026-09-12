# Handoff: QOS Design System → Cursor

## Where this lands

Unzip the whole folder to `qos-app/design-system/`, then:

| From the bundle | To |
| --- | --- |
| `handoff/qos-tokens.css` (all ten token files flattened, in order) | `src/app/qos-tokens.css` |
| `components/components.css` | `src/app/qos-components.css` |
| `assets/*.png` | `public/brand/` |
| `CURSOR_HANDOFF.md` | `docs/` (this file) |
| everything else | stays under `design-system/` as reference |

`design-system/` holds references, not shipped code — keep it out of `src/` so it is never mistaken for the implementation. Add `design-system/**` to your lint/type-check ignores; the `.jsx` files are deliberately untyped and are not meant to compile.

## Overview

This folder is the **QOS design system**: brand assets, design tokens, a component library, foundation documentation and a high-fidelity interactive recreation of the QOS staff-side platform. It is the visual and interaction source of truth for the QOS admin UI that will be built on top of the `qosapp` API.

## About the design files

The files here are **design references authored in HTML/JSX** — prototypes that show intended look and behaviour. They are not production code to copy verbatim. The task is to recreate them inside `qosapp`'s existing environment (Next.js App Router, React 19, Tailwind v4, TypeScript) using its established patterns.

Two parts transfer differently:

1. **`tokens/*.css` transfers almost literally.** These are plain CSS custom properties with no build dependency. Copy them into `qosapp/src/app/` (or `src/styles/tokens/`) and `@import` them from `globals.css` above the Tailwind import. Then map the semantic tokens into Tailwind's `@theme inline` block so utilities resolve to QOS tokens instead of zinc:

   ```css
   @import "./tokens/colors.css";
   @import "./tokens/typography.css";
   /* …the rest, in the order listed in styles.css… */
   @import "tailwindcss";

   @theme inline {
     --color-canvas: var(--surface-canvas);
     --color-surface: var(--surface-default);
     --color-ink: var(--text-primary);
     --color-ink-muted: var(--text-secondary);
     --color-border-subtle: var(--border-subtle);
     --color-action: var(--action-primary);
     --font-sans: var(--font-sans);
     --font-mono: var(--font-mono);
     --radius-card: var(--radius-card);
   }
   ```

   Delete the existing `--background` / `--foreground` pair and the `prefers-color-scheme` block — QOS theming is explicit (`data-qos-theme`), not OS-driven.

2. **`components/**/*.jsx` are references, not deliverables.** They are deliberately thin, untyped, and styled through the `.qos-*` classes in `components/components.css`. Rebuild each as a typed React Server/Client component in `qosapp/src/components/`, keeping:
   - the **props contract** from the sibling `<Name>.d.ts` (that is the API to implement),
   - the **usage rules** from the sibling `<Name>.prompt.md`,
   - the **exact numeric values** from `components/components.css` — paddings, heights, radii, font sizes, line-heights. Do not round them to Tailwind's default scale.

   `components.css` itself can be shipped as-is if you prefer classes over utilities; it references only semantic tokens and contains every interactive state.

## Fidelity

**High-fidelity.** Colours, typography, spacing, radii, shadows, motion and interaction states are final. Recreate the UI to match. Where a value is not documented, read it out of `components/components.css` or the relevant screen file rather than inventing one.

## What to build, in order

1. **Tokens + `globals.css`** as above. Verify both themes by putting `data-qos-theme="dark"` on `<html>`.
2. **Primitives** — `Button`, `IconButton`, `Input`/`Field`, `Textarea`, `Select`, `Checkbox`, `Radio`, `Switch`, `SegmentedControl`, `Chip`, `Tag`, `Badge`, `StatusBadge`, `Avatar`, `Tooltip`, `Icon`.
3. **`StatusBadge` + `QOS_STATES` first among those.** It is the single source of truth for state wording, tone and icon, and it maps directly onto the schema enums in `src/db/schema.ts` (`tenant_status`, `location_status`, `product_status`, `storefront_status`, `storefront_domain_verification_status`, `menu_publish_operation_status`, `menu_public_link_status`, `access_request_status`, `invitation_status`, `provisioning_operation_status`, `translation_approval_status`). Add a mapping layer from DB enum → `QOS_STATES` key so no screen ever renders a raw enum string.
4. **Shell** — `SideNav`, `TopBar`, `TenantSwitcher`, `PageHeader`, `Breadcrumbs`, `Tabs`, `Menu`, `CommandPalette`. Navigation order is fixed platform-wide: Home, Orders, Catalogue, Customers, Sales Channels, Locations, Integrations, Analytics, Team, Settings.
5. **Data + feedback** — `Card`, `KpiCard`, `DataTable`/`TableToolbar`/`TableBulkBar`, `Pagination`, `TrendChart`/`Sparkline`/`BarChart`/`ChartLegend`, `EmptyState`, `Skeleton`, `Timeline`, `ProgressBar`, `Alert`, `Banner`, `Toast`, `Modal`/`ConfirmDialog`, `Drawer`.
6. **`IntelligenceCard`** last of the library — it depends on Button and Badge.
7. **Screens**, against `ui_kits/qos-platform/`. Each screen file is a complete layout specification.

## Screens

All in `ui_kits/qos-platform/`, composed by `index.html`. Every screen uses the shell in `AppShell.jsx` (248px nav, 56px top bar, 1440px max canvas, 24px gutter) and starts with a `PageHeader`.

| File | Screen | Purpose | Notes for implementation |
| --- | --- | --- | --- |
| `LoginScreen.jsx` | Login → business selection | Authenticate, then choose tenant | Two-column 1.15fr/1fr split; left panel is the brand moment (`assets/motif-orbital-hero.png`, navy scrim, 40/48 headline); right panel is the form on `--surface-default`. Stays deep navy in both themes. Tenant list comes from staff memberships, never from a client-supplied `tenantId`. |
| `HomeScreen.jsx` | Command centre | Answer: what is happening, what needs attention, what changed | Order is deliberate: **exceptions and AI anomaly first**, then KPI row (4 across), then trend + channel health (2fr/1fr), then activity timeline. Contains the full flow 8: anomaly → `ConfirmDialog` naming the consequence → success `Alert` + `Toast`. |
| `OrdersScreen.jsx` | Orders list + order drawer | Operational triage | Dense grid, `row.exception` tints problem rows so they outrank healthy ones. Default view is **Exceptions**, not All. Drawer tabs: Lifecycle / Items / Integration events, with the raw request log in the last tab only. |
| `CatalogueScreen.jsx` | Product grid + product editor | Catalogue management at scale | Grid: toolbar → bulk bar → table → pagination (1,583 rows). Editor is sectioned cards, not one form: Details, Pricing (variants + location overrides), Modifiers, Availability (per-location switches), Media, Channels. Unsaved changes raise a `Banner`, never a silent autosave. |
| `ChannelsScreen.jsx` | Channels overview + Online Store management | Channel configuration and publishing | Contains flows 3 and 7. Tabs: Overview, Appearance, Pages, Menus, Branches & fulfilment, Domains, Payments, Publishing history. Draft edits never mutate the active release; publishing creates an immutable `StorefrontRelease`; rollback re-activates a previous release without a deployment. `StorePreview` is a **deliberately schematic** stand-in for the customer storefront — replace it with a real iframe preview of the storefront runtime. |
| `LocationsScreen.jsx` | Location list + detail | Branch-level operational control | Detail tabs: Details, Hours, Fulfilment, Catalogue availability, Channels, Integrations, Orders. The right rail holds live controls (accepting orders, delivery enabled, busy mode) that take effect immediately — everything else is save-gated. |
| `IntegrationsScreen.jsx` | Integration centre + connect wizard + provider detail | POS-agnostic connectivity | 4-up card grid by state. Wizard: Connect → Configure → Map locations → Verify, with AI-suggested location mapping presented for review, never auto-applied. Detail tabs: Connection, Configuration, Mapping, Locations, Sync health, Activity & logs. |
| `AnalyticsScreen.jsx` | Analytics | Business and operational reporting | Same token and chart language as the rest of the product, not a separate BI skin. Operational reliability (push success rate, failed publishes, held orders) is reported alongside revenue. |

`data.js` holds the fixture data; its object shapes intentionally mirror the real domain objects so swapping in API responses is a rename, not a restructure.

## Interactions & behaviour

- **Navigation**: side nav groups expand in place; the active item takes `--surface-selected` + `--text-brand`; sub-items sit in a 22px-indented list with a left hairline.
- **Theme**: `data-qos-theme="light" | "dark"` on the shell root (in production, on `<html>`), persisted. Both token sets are complete; nothing else needs to change per theme.
- **Search**: top-bar trigger opens the ⌘K palette. Results are grouped, and AI-derived suggestions are marked with the intelligence accent and sit in their own group, above system records.
- **Save model**: two kinds. `Switch` = takes effect immediately (live controls). Everything else = dirty state raises the unsaved-changes `Banner` and waits for Save.
- **High-impact actions** — publish, rollback, disconnect, delete, approve an AI action — always go through `ConfirmDialog` with the object named and the consequence spelled out, then a `Toast` plus an audit entry. Never a silent change.
- **Motion**: 140ms hover/focus/press, 200ms toggles and tabs, 320ms modals/drawers/toasts, 480ms publish/sync confirmation; easing `cubic-bezier(.2,0,.2,1)`; `prefers-reduced-motion` zeroes all durations.
- **Loading**: skeletons that match the shape of the content, inside an already-rendered shell. Publishes and syncs show real progress because the wait is real.

## State management

Per screen, the prototypes model exactly what the real UI needs:

- shell: `screen`, `tenant`, `theme`, command-palette `open` + `query`
- lists: `filters`/`view`, `selectedIds`, `sortKey`, `sortDirection`, `page`
- editors: `activeTab`, `dirty`, the draft entity, `confirmAction`, `toast`
- Online Store: `activeRelease`, `draftDirty`, `publishing`, `inspectedRelease`
- integrations: wizard `step`, `connectedIds`

Server state (orders, products, locations, releases, integration health) should come from the QOS API with tenant context resolved **server-side from authenticated membership** — the handover document is explicit that a client-supplied `tenantId` is never authorisation.

## Design tokens

Do not re-derive these; import the files. Anchors: Deep Navy `#0B0F1A`, Electric Blue `#3B82FF`, Cyan `#00E5FF`, Violet `#A855FF`, Soft Slate `#94A3B8`, Cloud `#F8FAFC`. Gradient: `linear-gradient(90deg,#A855FF,#3B82FF 52%,#00E5FF)`, used only on intelligence surfaces, brand moments and AI progress.

Spacing 4px scale (`--space-1`…`--space-12`); nav 248/64px, top bar 56px, canvas max 1440px, content 1120px, form column 720px, drawer 480px. Radii: control 8px, card 12px, surface/modal 16px, pill only for tags/chips/badges/toggles/avatars. Shadows `--shadow-xs`…`--shadow-xl` (navy-tinted, shallow). Type: Inter, product scale page title 600 24/32, section 600 16/24, body 16/24, body-sm 14/20, label 500 13/18, meta 12/16, overline 600 11/14 `.14em`, KPI 600 30/36 tabular. Full listing: `readme.md` → VISUAL FOUNDATIONS, and the specimen cards in `guidelines/`.

## Assets

`assets/` — all derived from the two supplied brand files, nothing drawn by hand:

- `logo.png` — approved wordmark, tight-cropped, transparent (light backgrounds)
- `logo-on-navy.png`, `logo-dark-bg.png`, `logo-light-bg.png` — supplied background-specific cuts. The navy cut is a raster with its own near-black ground (`rgb(5,9,17)`), so `Logo variant="navy"` presents it on a matching plaque. **Replace with vector artwork when available** and the plaque can go.
- `app-icon.png` — supplied 512×512 app icon
- `motif-*.png` — brand imagery for login, onboarding, empty states, launch screens
- `source/` — the two original uploads

**Icons are a substitution to confirm.** No icon files were supplied, so the system uses Lucide 0.469.0 (24px grid, 2px stroke, rounded caps) loaded per glyph from unpkg and masked to `currentColor`. In production use `lucide-react` instead of the CDN mask: `npm i lucide-react`, then replace `Icon.jsx` with a mapped wrapper. If QOS has real icon SVGs, they take precedence.

Fonts: Inter and Geist Mono are currently pulled from Google Fonts in `tokens/fonts.css`. `qosapp` already loads both through `next/font/google` in `src/app/layout.tsx` — keep that and drop the `@import`, so the tokens read from the `--font-geist-sans`/`--font-geist-mono` variables the app already sets (or switch those to Inter, which the brand guide specifies as the primary typeface).

## Files

- `styles.css` — the single entry point; `@import` lines only, in dependency order
- `tokens/` — `fonts`, `colors`, `typography`, `spacing`, `radius`, `elevation`, `motion`, `semantic-light`, `semantic-dark`, `base`
- `components/components.css` — every `.qos-*` rule, all interactive states
- `components/<group>/<Name>.jsx` + `.d.ts` + `.prompt.md` — 40 components in `brand`, `primitives`, `data`, `feedback`, `navigation`, `intelligence`
- `ui_kits/qos-platform/` — `index.html`, `AppShell.jsx`, `data.js`, and the eight screen files
- `guidelines/` — 20 foundation specimen cards (colour ramps, type scales, spacing, radius, elevation, motion, icons, motifs, contrast pairs)
- `templates/app-screen/` — a minimal shell + dashboard starting point
- `readme.md` — brand context, content fundamentals, visual foundations, iconography, full index
- `SKILL.md` — lets this folder act as an Agent Skill in Claude Code

## Open questions for the QOS team

1. Real icon SVGs — or confirm the Lucide substitution.
2. Vector logo artwork and font binaries.
3. Inter vs. Geist as the shipped product typeface (the guide says Inter; the codebase currently loads Geist).
4. The storefront runtime was not supplied, so there is no storefront UI kit — only the schematic preview inside the Online Store screens.
