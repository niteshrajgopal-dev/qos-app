# Handoff: QOS platform + storefront prototype

## Overview
QOS is a multi-tenant, POS-agnostic commerce orchestration platform (catalogue, sales channels, locations, orders, integrations, shared storefront). This package covers:
- **Platform (staff app), desktop:** Login → business selection → shell with Home, Orders, Catalogue, Customers, Sales Channels / Online Store, Locations, Integrations, Analytics, Team, Settings.
- **Platform, mobile:** monitoring-and-action app (home, orders, alerts, locations) inside a 402×874 phone frame.
- **Storefront (customer-facing), desktop + mobile:** browse menu → product modifiers → cart → checkout → confirmation.

Tenants in the mock data: **Quotes** (hospitality, 12 locations) and **Petal & Stem** (retail, 3 locations). Currency AED.

## About the design files
Everything here is a **design reference built in HTML/React (Babel in the browser)**. It shows the intended look and behaviour; it is not production code. Recreate it in the target codebase (`qosapp`: Next.js + React + TypeScript) using its patterns. Port the design-system CSS verbatim and convert the components to TSX.

## Fidelity
**High fidelity.** Final colours, type, spacing, copy and interactions. Match pixel-for-pixel. Exceptions (placeholders): product/hero imagery in the storefront (dashed placeholder boxes), and Catalogue sub-items (Menus, Modifier groups, Categories) + Sales Channels → POS, which reuse the Catalogue and Integrations screens pending their own design.

## How to run the reference
```
npx serve design_handoff_qos_platform
# open http://localhost:3000/prototype/
```
URL params: `device=desktop|mobile`, `surface=platform|storefront`, `skipLogin=1`, `start=<screen id>` (home, orders, catalogue, customers, channels, store, locations, integrations, analytics, team, settings).
A dark pill bar fixed at the bottom centre switches Platform/Storefront and Desktop/Mobile; it is a **prototype-only control** — do not build it.

## Folder contents
```
CURSOR_PROMPT.md            prompt to paste into Cursor
README.md                   this file
prototype/
  index.html                standalone runner (React 18.3.1 + Babel 7.29 from unpkg)
  QOSApp.jsx                ALL screens + mock data in one file (source of truth)
  assets/                   logo.png, logo-light-bg.png, logo-dark-bg.png, logo-on-navy.png,
                            app-icon.png, motif-orbital-hero.png, motif-clarity.png
design-system/
  DESIGN_SYSTEM.md          full design-system guide (voice, visual rules, iconography)
  styles.css                entry point (@imports only)
  tokens/                   fonts, colors, typography, spacing, radius, elevation, motion,
                            semantic-light, semantic-dark, base
  components/components.css every .qos-* rule incl. states
  components/**/X.jsx       readable component source (+ X.d.ts contract, X.prompt.md notes)
  _ds_bundle.js             pre-built bundle of the components (window.QOSDesignSystem_913581) — used by the runner only
```
`QOSApp.jsx` is split into sections by banners `/* ---- Name.jsx ---- */`: data.js, AppShell, LoginScreen, HomeScreen, OrdersScreen, CatalogueScreen, ChannelsScreen, LocationsScreen, IntegrationsScreen, AnalyticsScreen, TeamSettingsScreen (Team, Settings, Customers), StorefrontScreen, ios-frame (phone bezel — reference only), MobileApp, QOSPrototype (router + toggle bar).

## Route map (suggested)
| Screen id | Component in QOSApp.jsx | Route |
|---|---|---|
| login / tenant | `LoginScreen` (step) | `/login`, `/select-business` |
| home | `HomeScreen` | `/t/[tenant]` |
| orders | `OrdersScreen` | `/t/[tenant]/orders` |
| catalogue | `CatalogueScreen`, `ProductEditor` | `/t/[tenant]/catalogue`, `/catalogue/[productId]` |
| customers | `CustomersScreen` | `/t/[tenant]/customers` |
| channels / store | `ChannelsScreen`, `OnlineStore`, `StorePreview` | `/t/[tenant]/channels`, `/channels/online-store` |
| locations | `LocationsScreen`, `LocationDetail` | `/t/[tenant]/locations`, `/locations/[id]` |
| integrations | `IntegrationsScreen`, `ConnectWizard`, `IntegrationDetail` | `/t/[tenant]/integrations`, `/integrations/[id]` |
| analytics | `AnalyticsScreen` | `/t/[tenant]/analytics` |
| team | `TeamScreen` | `/t/[tenant]/team` |
| settings | `SettingsScreen` | `/t/[tenant]/settings` |
| storefront | `StorefrontApp` (`mobile` prop) | storefront runtime app |
| mobile platform | `MobilePlatform` | responsive `<768px` staff experience |

## Global layout (AppShell)
- Root: `display:flex; height:100vh; overflow:hidden; background:var(--surface-canvas)`, carries `data-qos-theme`.
- **Side nav:** `SideNav` component, 248px expanded / 64px collapsed, dark navy surface. Groups from `NAV`: (Home, Orders[9]) · **Commerce** (Catalogue ▸ Products 1583 / Menus 6 / Modifier groups 24 / Categories 18, Customers, Sales Channels ▸ All channels / Online Store / POS, Locations[12]) · **Platform** (Integrations[2], Analytics, Team, Settings). Brand slot: wordmark `Logo` 17px tall when expanded, `assets/app-icon.png` 28×28 radius 8 when collapsed. Footer: avatar + "Jamie Doyle / Administrator" (avatar only when collapsed).
- **Collapse behaviour:** toggle `IconButton` first in the top bar (`panel-left-close` / `panel-left-open`, labels "Collapse navigation" / "Expand navigation"). State persisted in `localStorage["qos-nav-collapsed"]` ("1"/"0"); default collapsed when viewport < 1180px. Below 768px the nav column stays 64px and the expanded nav overlays content (`position:absolute`, `--shadow-xl`) over a scrim `rgba(11,15,26,.48)`; clicking the scrim or a nav item collapses it.
- **Top bar (56px):** nav toggle · `TenantSwitcher` · search button (max 380px, 34px tall, radius `--radius-md`, `--border-default`, `--surface-subtle`, placeholder "Search businesses, orders, products, locations…", `⌘K` kbd) · right cluster gap 6: `Badge tone="processing" dot pulse` "Development", theme toggle (sun/moon), Help, Notifications (7px red dot `--status-error-solid` with 1.5px surface border at top 5/right 5), Avatar.
- **Main:** scrolls; inner `max-width: var(--layout-canvas-max)` (1440), `margin:0 auto`, `padding: 24px var(--layout-gutter) 64px`.
- **Command palette:** ⌘K / Ctrl+K opens; groups "Suggested by QOS Intelligence" (AI anomaly item), Orders, Catalogue, Locations; selecting navigates to the item's screen.
- Helpers: `Section` (title 16/24 semibold + action, margin-top `--section-gap` 32px, header margin-bottom 12), `Grid` (`repeat(n, minmax(0,1fr))`, gap 16), `DefinitionList` (grid `auto 1fr`, gap 10px 20px, 13px; dt `--text-secondary`, dd medium).

## Screens
Exact copy, numbers and structure are in `QOSApp.jsx`; replicate verbatim. Summary of purpose and key behaviour:

1. **Login** (always dark): 2 columns `1.15fr 1fr`. Left: `motif-orbital-hero.png` cover at 0.9 opacity with a navy vertical gradient overlay, Logo 26px, H1 "Ideas today. / Impact tomorrow." 40/48 600 −0.02em. Right: sign-in card → **Select business** step listing tenants → enters app.
2. **Home (command centre):** exceptions first, then KPIs and a 24h "Orders and revenue" `TrendChart` (2 series, height 188). `IntelligenceCard` anomaly "9 orders failed to reach Lightspeed" (system fact → AI interpretation → recommendation). "Approve and reconnect" opens `ConfirmDialog` with a DefinitionList (Integration, Scope, Orders to replay, Approved by) → success `Toast`, card switches to resolved. Range `SegmentedControl` (Today …).
3. **Orders:** view chips (Exceptions default / All), `TableToolbar` + `TableBulkBar` + `DataTable` + `Pagination`; exception rows tinted. Row opens a 480px `Drawer`: failure `Alert`, `Tabs` Lifecycle / Items (3) / Integration events (error tone), `Timeline`, "Resend to POS" → toast.
4. **Catalogue:** product table with state badges → `ProductEditor` (tabs incl. details, modifiers, availability per location). Editing sets dirty → unsaved `Banner` with Save; save → toast.
5. **Customers:** table + detail drawer.
6. **Sales Channels:** channel cards (Online Store, Lightspeed POS error, Deliveroo, Talabat paused, Kiosk, WhatsApp). **Online Store** tabs: overview, appearance, homepage blocks, menus, branches, domains, payments, publishing history. Draft banner → Publish confirm (consequence copy) → publishing modal with progress → release history (`RELEASES`) → rollback `ConfirmDialog`. `StorePreview` (Desktop/Mobile 260px) is intentionally schematic.
7. **Locations:** list (Marina Walk warning/error, Downtown, Al Quoz, JBR paused) → `LocationDetail` tabs: hours (Mon–Sun editor), fulfilment, catalogue availability, channels, integrations; dirty → save → toast.
8. **Integrations:** centre grid with state badges and plain-language health line → `ConnectWizard` (`Stepper`: Connect, Configure, Map locations, Verify) → `IntegrationDetail` (connection / health / mapping / logs; opens on health when state is error).
9. **Analytics:** range control, `TrendChart`, `BarChart`, `ChartLegend`, breakdown `DataTable`, `IntelligenceCard` insight.
10. **Team:** tabs Members / Roles (permissions matrix) / Activity; invite `Drawer`; role change confirm.
11. **Settings:** tabs starting "general"; forms in 720px column section cards; save → toast.
12. **Storefront (`StorefrontApp`):** category chips (default "Coffee"), product grid with `Placeholder` images, product sheet with modifiers (Radio/Checkbox groups, note, qty), cart drawer (seeded: Flat white ×2, "Oat milk, extra shot", 24 AED), checkout (fulfilment, details, payment), confirmation with order `Timeline`. `mobile` prop: renders inside the phone; sheet and cart stay inside the phone viewport and content clears the status bar.
13. **Mobile platform (`MobilePlatform`):** bottom tab bar (home, orders, …), `MHeader` 56px min, `MCard` (radius 12, `--border-subtle`), KPI cards, alert approval via `ConfirmDialog`, pause-location `Switch`, order detail with resolve action. Monitoring and focused actions only.

## Interactions & motion
- Easing `cubic-bezier(.2,0,.2,1)`; 80ms colour swaps, 140ms hover/focus, 200ms toggles/tabs/nav collapse, 320ms modals/drawers/toasts, 480ms publish/sync progress. `prefers-reduced-motion` zeroes durations.
- Hover: filled controls one step darker; outlined/ghost `--border-strong` + `--surface-hover`. Cards: `--shadow-md` on hover, 1px translate on press. Focus ring `0 0 0 3px rgba(59,130,255,.32)` (cyan in dark).
- Toasts auto-dismiss; confirm dialogs always state consequence before the action button.
- Theme toggle persists (`qos-proto-theme` in the prototype; use `qos-theme`).
- Chips, badges, segmented items, tags, buttons and nav counts are `white-space:nowrap; flex-shrink:0` (global rule in the runner — keep it).

## State (per screen, local unless noted)
Global: `tenant`, `theme`, `navCollapsed`, `commandOpen`, auth stage. Home: `range`, `confirm`, `toast`, `resolved`. Orders: `view`, `selection[]`, `openOrder`, `drawerTab`, `toast`. Catalogue: `product`, `selection`, editor `tab`, `dirty`. Online Store: `tab`, preview `device`, draft/publish/rollback dialogs, publishing progress. Locations: `loc`, detail `tab`, `dirty`. Integrations: `detail`, `wizard`, wizard `step`. Storefront: `cat`, `cart[]`, open product, cart open, checkout step. Mobile: `tab`, `order`.

## Design tokens (key values; full set in `design-system/tokens/`)
- **Anchors:** Deep Navy `#0B0F1A`, Electric Blue `#3B82FF`, Cyan `#00E5FF`, Violet `#A855FF`, Soft Slate `#94A3B8`, Cloud `#F8FAFC`.
- **Light semantic:** canvas `#F8FAFC`, surface `#FFFFFF`, sunken `#EDF1F7`, selected `#F2F7FF`; text primary `#0B0F1A`, secondary `#475569`, tertiary `#64748B`, brand/link `#2E6BE0`, intelligence `#7B2BD1`; borders subtle `#E2E8F0`, default `#CBD5E1`, strong `#94A3B8`; primary action `#3B82FF` / hover `#2E6BE0` / active `#2154B8`; danger `#CE2138`.
- **Status fg/bg:** success `#0F7A50`/`#DCF6EA`, warning `#8A5200`/`#FDF0D8`, error `#B01C2E`/`#FDE5E8`, info `#2154B8`/`#E4EDFF`, processing `#005E6B`/`#E4FCFF`, neutral `#475569`/`#EDF1F7`.
- **Gradient** (AI + brand surfaces only): `linear-gradient(90deg,#A855FF 0%,#3B82FF 52%,#00E5FF 100%)`.
- **Type:** Inter; Geist Mono for IDs/domains/hashes. Page title 600 24/32 −0.015em; section 600 16/24; body 16/24; body-sm 14/20; label 500 13/18; table 13/18; meta 12/16; overline 600 11/14 +0.14em uppercase; KPI 600 30/36 −0.02em, tabular figures.
- **Spacing:** 4px scale (4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96). Nav 248/64, top bar 56, drawer 480, panel 360, form 720, gutter 24/20/16, card padding 20 (compact 16), table cells 16×12 (dense 16×8), controls 28/36/44.
- **Radius:** controls 8, cards 12, surfaces/modals 16, pills 999 (tags, chips, badges, toggles, avatars only).
- **Shadows:** sm `0 1px 2px rgba(11,15,26,.06), 0 1px 3px rgba(11,15,26,.05)`; md `0 2px 4px rgba(11,15,26,.05), 0 6px 16px rgba(11,15,26,.07)`; lg `0 8px 24px rgba(11,15,26,.10), 0 2px 6px rgba(11,15,26,.05)`; xl `0 24px 56px rgba(11,15,26,.16), 0 4px 12px rgba(11,15,26,.06)`.

## Assets
- `assets/logo*.png` — approved QOS wordmark (light/dark cuts). Never redraw or recolour; min 24px height in brand use (17px in nav chrome as designed).
- `assets/app-icon.png` — reduced mark, used only for the collapsed nav.
- `assets/motif-*.png` — brand imagery for login/empty states only.
- Icons: Lucide 0.469.0 from `https://unpkg.com/lucide-static@0.469.0/icons/<name>.svg`, applied as CSS mask (substitution pending brand approval).
- Storefront product/hero images: placeholders — supply real photography.
