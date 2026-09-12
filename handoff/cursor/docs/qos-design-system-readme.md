# QOS Design System

**Ideas today. Impact tomorrow.**

QOS is a multi-tenant, POS-agnostic SaaS platform — the central management and orchestration layer through which a business configures and operates its digital commerce: catalogue, sales channels, locations, orders, integrations and a shared storefront renderer. The brand guide describes it as "a modern quality platform for orchestrating testing, intelligence, and outcomes"; the product architecture in the codebase implements that as `Platform → Tenant → Organization → Brand → Location → Channels → Catalogue → Orders → Integrations`.

QOS is a reusable platform, not one customer's app. **Quotes is Customer #1**, and a synthetic flower shop ("Petal & Stem" in this kit) is Customer #2 — both served by one shared application image, one shared storefront runtime and one database with strict tenant isolation. Customer storefronts consume published configuration from QOS rather than being bespoke applications.

This design system translates the approved QOS identity into a production-oriented product design language: tokens, components, patterns and full high-fidelity screens ready for a React team.

## Sources used to build this

| Source | What it gave us |
| --- | --- |
| `uploads/ChatGPT Image Sep 12, 2026, 01_56_00 PM (1).png` | **The approved QOS logo** — authoritative. Copied to `assets/source/qos-logo-source.png` and tight-cropped to `assets/logo.png`. |
| `uploads/ChatGPT Image Sep 12, 2026, 01_56_02 PM (2).png` | **The QOS brand guide** — colours, typography, iconography direction, visual motifs, UI element samples, messaging. Copied to `assets/source/qos-brand-guide.png`; individual assets cropped out of it (see `assets/`). |
| Attached codebase `qosapp/` (local path recorded in its docs as `C:\Dev\qosapp`) | Domain model and state vocabulary (`src/db/schema.ts`), product boundaries and publishing/tenancy rules (`docs/QOS_Cursor_Phase1_Development_Handover_v2.md`), the few existing staff screens (`src/app/tenants/[tenantId]/catalogue/…`, `src/app/platform/onboarding`, `src/app/staff/request-access`). |

Referenced in the handover but **not accessible** from here (kept for whoever has access): Linear project `QOS` — document *Cursor Execution Protocol — Phase 1*, `https://linear.app/qosapp/document/cursor-execution-protocol-phase-1-2b0b2ec7ac62`; Azure dev resources `rg-qos-dev-core` (`ca-qos-dev-api`, `ca-qos-dev-storefront`, `psql-qos-dev`, `afd-qos-dev`); dev hostname `quotes.dev.qosapp.com`.

### Precedence
Approved logo → brand guide → written brief → design interpretation. Where the brief and the guide disagreed, the guide won (example: Violet is `#A855FF` per the guide, not `#A855F7`).

### What the codebase did *not* provide
`qosapp` is an API-first Next.js skeleton. Its UI is unstyled Tailwind scaffolding (zinc palette, Geist font, `globals.css` with two variables) built for API testing, not product UI — so it is **not** a visual source of truth. It is the source of truth for *domain language, object model, states and permissions*. The customer-facing storefront runtime (`ca-qos-dev-storefront`) was not attached, so this system contains no storefront UI kit — only a deliberately schematic storefront preview inside the Online Store screens, marked as such in the code.

---

## CONTENT FUNDAMENTALS

**Voice.** Operational, precise, unexcited. QOS tells an operator what is true, what changed, and what they can do about it. Marketing language belongs to the brand surfaces (login, onboarding, launch); the working product is quiet.

- **Person.** Address the operator as *you*; QOS refers to itself as *QOS*, never *we*. "You have unpublished changes." "QOS is holding orders rather than dropping them."
- **Casing.** Sentence case everywhere — page titles, buttons, table headers as UPPERCASE-tracked overlines only. Never Title Case buttons: "Save changes", not "Save Changes".
- **Buttons** are verb-first and name the object when there is any doubt: "Publish", "Roll back to Release 41", "Approve and reconnect", "Resend to POS". Never "OK", "Submit" or "Yes".
- **Consequence before confirmation.** Every high-impact dialog states what will happen to whom: "Release 42 will stop being served. Customers will see Release 41 within a few seconds. Nothing is deleted."
- **State words are fixed** and come from `QOS_STATES` — Live, Draft, Published, Unpublished, Connected, Disconnected, Synced, Out of sync, Configuration required, Active, Paused, Suspended, Processing, Syncing, Warning, Error, Failed, Verified, Pending. Do not invent synonyms ("Offline" ≠ "Disconnected").
- **Numbers are specific.** "9 orders have not reached the POS since 14:02", not "some orders failed". Always give the scope: how many, where, since when.
- **Errors explain, then offer the next step.** Cause, blast radius, action. Never blame the user, never leak internals into the headline (the stack trace lives in the Logs tab).
- **AI copy is labelled by epistemic status**: *System fact* → *AI interpretation* → *AI recommendation*. AI never states an interpretation as fact, and never says "I".
- **Slogans are rationed.** "Ideas today. Impact tomorrow." appears on login, onboarding and brand communications. Supporting lines ("Turn complexity into clarity", "Orchestrate better outcomes", "Intelligence in motion") are for marketing moments only — never in product chrome.
- **No emoji.** No exclamation marks. No "Oops". British spelling in prose (*organisation*, *catalogue*, *authorised*) — matching the brand guide and the codebase's `catalogue*` tables.
- **Empty states** say what the thing is for and how to start: "No sales channels yet — connect a channel to start taking orders."
- **Metadata reads left to right, coarse to fine**: "Online Store · Marina Walk · Delivery · 14:06".

---

## VISUAL FOUNDATIONS

### Colour
Six anchors, formalised in `tokens/colors.css`: Deep Navy `#0B0F1A` (trust and depth), Electric Blue `#3B82FF` (innovation, primary interactive), Cyan `#00E5FF` (acceleration, active states, highlights), Violet `#A855FF` (intelligence, AI), Soft Slate `#94A3B8` (secondary content), Cloud `#F8FAFC` (the light application canvas). Each anchor sits in a 50–900 tonal ramp; **components consume only the semantic layer** (`--surface-*`, `--text-*`, `--border-*`, `--action-*`, `--status-*`, `--intelligence-*`, `--viz-*`). Raw hex never appears in a component.

Light mode is the primary operating environment: Cloud canvas, white cards, navy ink, restrained hairline borders, blue interactive elements. Deep Navy is used *selectively* — global navigation, login, splash, command surfaces and branded dashboards — via `[data-qos-theme="dark"]` on any ancestor. Both themes are complete token sets; dark elevates with layered navy surfaces plus a hairline, not with glow.

### Gradient
One signature gradient, Violet → Electric Blue → Cyan (`--qos-gradient`). It is allowed on: the 2px top rule of an intelligence surface, the intelligence button, tenant/avatar marks, indeterminate AI progress, the login and launch surfaces, and empty-state washes (`--qos-gradient-soft`). It is **not** allowed on operational buttons, card backgrounds, headers, tables or charts. Most of the product has no gradient at all.

### Type
Inter throughout (brand guide section 03); Geist Mono for identifiers, domains, release hashes and log output — inherited from the codebase. Two scales: a marketing scale (H1 700 56/64, H2 600 40/48, H3 500 28/36) for brand surfaces, and a compressed product scale (page title 600 24/32, section 600 16/24, body 16/24, body small 14/20, label 500 13/18, metadata 12/16, overline 600 11/14 tracked `.14em`). Hierarchy comes from weight, colour and space rather than many sizes. All numbers use tabular figures; KPI values are 600 30/36 with `-0.02em`.

### Space and layout
4px base scale (`--space-1` … `--space-12`). Side navigation 248px (64px collapsed), top bar 56px, canvas max 1440px, content max 1120px, form column 720px, drawer 480px, panel 360px. Gutters 24 / 20 / 16px (desktop / tablet / mobile). Card padding 20px, compact 16px; table cells 16×12px, dense 16×8px; controls 36px tall (28 small, 44 large — and 44px is the minimum touch target on tablet and mobile). Sibling groups are laid out with flex/grid plus `gap`, never margins on inline siblings.

### Radius
Moderate and consistent: controls 8px, cards 12px, surfaces and modals 16px. Fully rounded pills are reserved for tags, filter chips, status badges, toggles, avatars and selected AI interactions — never for buttons, cards or inputs.

### Borders, shadows, transparency
Borders do most of the structural work: 1px `--border-subtle` on cards and dividers, `--border-default` on controls, `--border-strong` on hover. Shadows are navy-tinted and shallow — `--shadow-sm` for resting cards, `--shadow-md` on hover, `--shadow-lg`/`xl` for drawers, modals and menus only. No inner shadows on inputs. Transparency and blur are not decorative: alpha is used for scrims (`rgba(11,15,26,.48)`), dark-theme surface layering, and focus rings. No frosted-glass panels over content, and no glow behind operational UI — the only glows in the system are the focus ring, `--glow-intelligence` on an AI-variant focus, and the supplied brand imagery itself.

### Cards
White surface, 1px `--border-subtle`, 12px radius, `--shadow-sm`. Optional header row with a 1px bottom divider, 16px vertical padding. Interactive cards gain `--shadow-md` and `--border-default` on hover and translate 1px down on press. No coloured left borders. Intelligence cards are the only tinted variant: a soft gradient wash from the top-left plus a violet border.

### Motion
Restrained and causal, all easing standard-out (`cubic-bezier(.2,0,.2,1)`), never bouncy: 80ms colour swaps, 140ms hover/focus/press, 200ms toggles and tabs, 320ms modals, drawers and toasts, 480ms publish and sync confirmation, 12s ambient gradient drift on brand surfaces only. Loading uses a shimmer skeleton or an indeterminate bar; publishes and syncs animate progress because the delay is real. `prefers-reduced-motion` zeroes every duration.

### Interaction states
Hover = one step darker background for filled controls, `--border-strong` plus `--surface-hover` for outlined and ghost ones (never opacity fades). Press = the next darker step, plus 1px translate on cards only. Focus = a 3px `rgba(59,130,255,.32)` ring (cyan in dark mode), always visible, never removed. Selected = `--surface-selected` tint with `--text-brand` ink and, for tabs, a 2px blue underline. Disabled = `--surface-disabled` fill, `--text-disabled` ink, no shadow, `not-allowed` cursor. Every interactive component defines default, hover, focus, active, selected, disabled, loading and error where relevant.

### Imagery and background
Backgrounds in the working product are flat — Cloud canvas, white surfaces, no patterns or textures. The brand's imagery is a separate register: cool, deep-space luminous renders in violet/blue/cyan on near-black, with soft bloom and floating capsule/orbital forms (`assets/motif-*.png`). Those appear on login, onboarding, empty states, launch screens, premium-feature introductions and brand communications — and nowhere near a table or a form. Photography, if introduced, should be cool-toned and low-noise to sit with them.

### Data visualisation
Series colours follow `--viz-1…6` in order (Electric Blue, Violet, Cyan 600, Navy 600, then tints). Hairline `--viz-grid` gridlines, `--viz-axis` labels at 11px tabular, 2px stroke lines with round joins, a single low-opacity area fill per series. Charts carry a legend whenever there is more than one series, and never a decorative gradient behind the plot.

### Accessibility
Target WCAG AA. Body text is navy on Cloud (16.9:1); white on Electric Blue is used at control scale (3.9:1) and never for small body text on blue; Cyan is a stroke and highlight colour, never small text on light surfaces. State is never colour alone — every status carries an icon and a word. Focus is always visible, disabled controls keep 3:1 against their surface, and touch targets are ≥44px on tablet and mobile. Charts pair colour with labels and direct value labels.

### Responsive
Desktop-first (1440px canvas). Tablet (768–1180px): navigation collapses to 64px icons, KPI grids go 4→2, detail pages stack their side panel under the main column, tables scroll horizontally with a sticky first column. Mobile (<768px): navigation becomes a bottom-sheet menu, the product is for monitoring and focused actions — approve an AI recommendation, pause a location, resolve an order — not for the full configuration workflows, which stay desktop-only rather than being compressed.

---

## ICONOGRAPHY

The brand guide's icon set is simple, expressive, single-weight outline work on a 24px grid (automation, testing, analytics, workflows, integrations, governance, insights, people). **No icon files were supplied** — only the rasterised guide — so the system uses **Lucide 0.469.0** as the closest CDN match (same 24px grid, 2px stroke, rounded caps and joins). **This is a substitution: flagged for approval.** If QOS has real icon SVGs, drop them into `assets/icons/` and point `components/primitives/Icon.jsx` at them; nothing else changes.

- Icons load per glyph from `https://unpkg.com/lucide-static@0.469.0/icons/<name>.svg` and are applied as a CSS mask so they always inherit `currentColor`. No icon font, no sprite sheet.
- Sizes: 13–14px inside dense tables and small buttons, 15–16px default, 17–18px for card and channel marks, 28px in empty-state art. Never scale a glyph above 28px in operational UI.
- Icons are decorative by default (`aria-hidden`); pass `label` when the icon is the only carrier of meaning. `IconButton` requires a label.
- The platform-object vocabulary is fixed so the same object always looks the same: Home `layout-dashboard`, Orders `receipt`, Catalogue `package`, Customers `users`, Sales Channels `store`, Locations `map-pin`, Integrations `plug`, Analytics `bar-chart-3`, Team `shield-check`, Settings `settings`, Intelligence `sparkles`, Publish `upload-cloud`, Sync `refresh-cw`, Domain `globe`, Payments `credit-card`, Delivery `truck`, Publishing history `history`.
- No 3D or filled icons in operational UI. No emoji, and no Unicode glyphs standing in for icons (the one exception is the `×` in a removable `Tag`).
- The three-dimensional, luminous objects from the brand guide are *imagery*, not icons, and are used as described in Visual Foundations.

---

## Index

### Root
- `styles.css` — the single entry point consumers link. `@import` lines only.
- `thumbnail.html` — homepage tile for this design system.
- `SKILL.md` — Agent Skills wrapper, so this folder works as a Claude Code skill.
- `readme.md` — this file.

### `tokens/`
`fonts.css` (Inter + Geist Mono via Google Fonts), `colors.css` (anchors, ramps, gradient), `typography.css`, `spacing.css` (scale + layout metrics), `radius.css`, `elevation.css` (shadows, rings, the two permitted glows), `motion.css`, `semantic-light.css`, `semantic-dark.css`, `base.css` (resets, link colours, focus).

### `assets/`
`logo.png` (approved wordmark, tight-cropped, transparent), `logo-on-navy.png` and `logo-dark-bg.png` (supplied dark-background cuts), `logo-light-bg.png`, `app-icon.png` (supplied 512 app icon), `motif-clarity.png`, `motif-connect.png`, `motif-tomorrow.png`, `motif-orbital-hero.png`, `motif-planet-banner.png`, and `source/` with both original uploads. Logo usage: minimum 24px wordmark height, clear space equal to twice the height of the `O` on all sides, never recoloured, redrawn, stretched or rebuilt as a standalone `Q` mark. A reduced icon exists only as the supplied `app-icon.png`; any other reduced mark is a candidate requiring brand approval.

### `guidelines/`
Foundation specimen cards rendered in the Design System tab: brand anchors, blue / cyan / violet / neutral ramps, status colours, signature gradient, dark surfaces, brand and product type scales, numerical type, spacing scale, layout metrics, radius, elevation, motion, icon set, visual motifs, brand hero, contrast pairs.

### `components/`
`components.css` holds every `.qos-*` rule (states included); each component is a thin JSX wrapper with a `.d.ts` contract and a `.prompt.md` usage note.

- **brand/** — `Logo`
- **primitives/** — `Icon`, `Button`, `IconButton`, `Input`, `SearchInput`, `Field`, `Textarea`, `Select`, `Checkbox`, `Radio`, `Switch`, `SegmentedControl`, `Chip`, `Tag`, `Badge`, `StatusBadge` (+ `QOS_STATES`), `Avatar`, `Tooltip`
- **data/** — `Card`, `KpiCard`, `DataTable`, `TableToolbar`, `TableBulkBar`, `Pagination`, `TrendChart`, `Sparkline`, `BarChart`, `ChartLegend`, `EmptyState`, `Skeleton`, `SkeletonText`, `Timeline`, `ProgressBar`
- **feedback/** — `Alert`, `Banner`, `Toast`, `ToastStack`, `Modal`, `ConfirmDialog`, `Drawer`
- **navigation/** — `SideNav`, `TopBar`, `TenantSwitcher`, `Tabs`, `Breadcrumbs`, `PageHeader`, `CommandPalette`, `Stepper`, `Menu`
- **intelligence/** — `IntelligenceCard`, `AiBadge`

**Intentional additions** (no counterpart in the attached sources, added because the platform cannot be designed without them): `Icon` wrapper for the substituted glyph set; `StatusBadge`/`QOS_STATES` to make the codebase's state enums a single design decision; `IntelligenceCard`/`AiBadge` for the AI pattern the brief requires; `TenantSwitcher` because every screen is tenant-scoped; `Logo` so the approved artwork is never redrawn.

### `ui_kits/qos-platform/`
Interactive recreation of the staff-side platform — open `index.html`. Login → business selection → shell, then seven connected screens: Home (command centre with the AI anomaly → approval flow), Orders (exception list, order drawer, integration events), Catalogue (product grid, product editor with modifiers and per-location availability), Sales Channels (channel overview and full Online Store management: overview, appearance, homepage blocks, menus, branches, domains, payments, publishing history with rollback), Locations (list and detail: hours, fulfilment, catalogue availability, channels, integrations), Integrations (centre, connect wizard, provider detail with health, mapping and logs), Analytics. `data.js` holds the fake data, named after the real domain objects.

The whole shell — left navigation included — is themeable: the sun/moon control in the top bar flips `data-qos-theme` on the shell root, so every surface, border, status colour and the navigation itself resolve from the light or dark token set (the choice persists in `localStorage`). Login stays deep navy in both themes; it is a brand moment, not an operational screen.

### Patterns encoded in the kit
Forms (section cards, 720px column, label/hint/error shell), tables (toolbar → bulk bar → grid → pagination; exceptions tinted so problems outrank healthy rows), filtering (chips above the grid), search (top-bar button opening ⌘K palette), navigation (fixed platform order, expandable groups, dark shell), publishing (draft banner → confirm with consequence → progress → release history → rollback confirm), status (single `QOS_STATES` vocabulary), AI (fact / interpretation / recommendation, nothing applied without approval), integration health (state badge + plain-language health line + technical detail one tab away), empty states (what it is for, how to start).
