# Prompt for Cursor

Paste everything below the line into Cursor (Agent mode), with this `design_handoff_qos_platform/` folder added to the workspace.

---

You are implementing the QOS platform UI from a high-fidelity HTML/React design reference. The reference lives in `design_handoff_qos_platform/`. Read `design_handoff_qos_platform/README.md` fully before writing code, then `design-system/DESIGN_SYSTEM.md`.

**Goal:** recreate the design pixel-for-pixel in this codebase (Next.js App Router + React + TypeScript, `qosapp`). The HTML prototype is a reference, not production code: do not ship Babel-in-browser, `window.*` globals or the prototype toggle bar.

**Run the reference first.** Serve the folder (`npx serve design_handoff_qos_platform`) and open `/prototype/`. Use URL params `?skipLogin=1&start=orders`, `?device=mobile`, `?surface=storefront` to reach each view. Compare your build against it side-by-side at 1440px, 1180px, 768px and 402px widths.

**Implementation rules**
1. **Design system first.** Port `design-system/` into `src/design-system/`:
   - Copy `tokens/*.css`, `components/components.css` and `styles.css` verbatim; import `styles.css` once in `src/app/layout.tsx`. Do not rename CSS variables or `.qos-*` classes.
   - Convert each `components/**/X.jsx` to `X.tsx` using its `X.d.ts` as the prop contract and its `X.prompt.md` as usage notes. Keep markup and class names identical so `components.css` applies unchanged.
   - Export everything from `src/design-system/index.ts`.
   - Icons: Lucide 0.469.0 glyphs applied as a CSS mask (see `primitives/Icon.jsx`). You may switch to `lucide-react` only if size/stroke render identically.
2. **Screens.** `prototype/QOSApp.jsx` is the single source of truth for every screen (the file is split by `/* ---- Name.jsx ---- */` banners). Port each section into its own route/component as mapped in README → "Route map". Keep every string, number, spacing value and state exactly as written.
3. **Data.** Move the `data.js` section (TENANTS, NAV, ORDERS, PRODUCTS, LOCATIONS, CHANNELS, INTEGRATIONS, RELEASES, BLOCKS, trends, storefront menu) into `src/mocks/*.ts` with types that follow `src/db/schema.ts`. Screens read from these mocks via a thin data hook so they can be swapped for API calls later.
4. **Styling.** Use the tokens (`var(--surface-*)`, `--text-*`, `--border-*`, `--space-*`, `--radius-*`, `--shadow-*`, `--dur-*`, `--ease-*`). No raw hex in components except where the prototype hard-codes the prototype-only toggle bar. No Tailwind overrides on DS components.
5. **Theme.** Light is default. `data-qos-theme="dark"` on the shell root flips everything; persist in `localStorage` key `qos-theme`. Login is always dark.
6. **Behaviour to reproduce exactly** (details in README → Interactions): collapsible side nav (248px ↔ 64px, persisted, overlay with scrim below 768px), ⌘K command palette, AI anomaly → confirm → toast flow on Home, order exception drawer, product editor dirty-state banner, Online Store publish → progress → release history → rollback confirm, integration connect wizard (4 steps), location hours editor, team invite + roles matrix, storefront browse → modifiers sheet → cart drawer → checkout → confirmation, mobile platform tab app.
7. **Copy rules.** Sentence case, British spelling, no emoji, no exclamation marks; state words only from `QOS_STATES` (`primitives/StatusBadge.jsx`).
8. **Accessibility.** Keep focus rings, `aria-label` on every IconButton, ≥44px touch targets on mobile, status always icon + word.

**Work order:** tokens + CSS → primitives → navigation (SideNav, TopBar, TenantSwitcher, CommandPalette) → AppShell layout → Login → Home → Orders → Catalogue → Sales Channels/Online Store → Locations → Integrations → Analytics → Customers → Team → Settings → Storefront (desktop + mobile) → Mobile platform. After each screen, screenshot it next to the reference and fix discrepancies before moving on.

Ask me before inventing any screen, state or copy that is not in the reference.
