# Cursor prompt — QOS Portal (exact replication)

Paste everything below the line into Cursor (Agent mode) with this folder open as the workspace root.

---

This workspace contains the complete, approved source and assets for the QOS Portal prototype. Your job is to make it run exactly as supplied. The design is final: do not redesign, restyle, refactor, rename classes, reformat CSS, substitute icons or fonts, or "improve" anything.

## Files (already in place — do not rewrite)

- `app/page.tsx` — all ten views, copy, interactions, state, hash routing, Cmd/Ctrl+K search, motion toggle.
- `app/globals.css` — layout, typography, glass panels, breakpoints (1600 / 1200 / 960 / 680), scene dolly/parallax, reduced-motion rules.
- `app/light-effects.css` — translucent glass buttons, rotating conic rims, specular sweeps, dock lighting.
- `app/LightWave.tsx` — travelling cyan/violet/pink wave on a curved SVG path (13.6s, stroke-dasharray/dashoffset), with a separate mobile path.
- `app/prototype-data.ts` — synthetic seed data, modules, branches.
- `app/layout.tsx` — root layout importing `globals.css`.
- `components/ui/*` — shadcn components (radix-ui). `lib/utils.ts` — `cn()`.
- `vendor/shadcn-tailwind-4.13.0.css` — imported by globals.css.
- `public/assets/` — `qos-portal-scene.png` (background, use unchanged), `brand/qos-logo-original.png`, `fonts/*.otf` + licence, `icons/`, `tokens.css` (fonts + tokens). `public/favicon.svg`.
- Config: `package.json`, `tsconfig.json` (`@/*` → root), `postcss.config.mjs` (Tailwind 4), `next.config.ts`.
- `docs/DESIGN_SPEC.md` — full approved specification. `docs/reference-overview.jpg` and `docs/QOS_Portal_Preview.jpg` — visual references.

## Steps

1. Run `npm install` (or pnpm). Do not add other UI libraries.
2. Run `npm run dev` and fix only genuine build errors (for example, missing types or version resolution). Any fix must be minimal and must not change the rendered result. If a pinned version fails to resolve, use the nearest compatible version of the same package.
3. Keep every `/assets/...` path as it is; files are served from `public/`.
4. Do not edit `globals.css`, `light-effects.css`, `LightWave.tsx`, or `page.tsx` markup/classNames unless a build error requires it. Keep the root `data-qos-motion` attribute, the `qos-motion` and `qos-portal-v1` localStorage keys, and every `pointer-events:none` / `aria-hidden` on decorative layers.

## Acceptance checks (verify each in the browser)

- Opens on Overview. Header 94px high, white QOS logo (`brightness(0) invert(1)`) with WORKSPACE beneath it. Fonts: QOS Display for serif headings, QOS Sans for UI.
- Hero: "Your business." / "In perspective." with "perspective." in the lavender-to-peach gradient. Business Pulse rail (82%, AED 24,860, 186 orders, 3/3 branches, 96.4%).
- Background: 22s dolly (scale 1.03→1.13), pointer parallax with a 1.6s transition, 11s light breathing.
- Glass buttons: blur(18px) saturate(145%). Primary rim rotates in 8s (3.5s on hover), specular sweep in 7s.
- Dock: selection advances every 3.4s. The light wave visibly travels along the SVG path in a 13.6s cycle. Hover/focus holds the cycle. Leaving the dock resumes it.
- Motion toggle pauses all motion, including inside dialogs and sheets. `prefers-reduced-motion` is respected.
- All ten views work: Overview, Orders (status progression, CSV export), Catalogue, Menus (Arabic approval, Administrator-only publishing), Storefronts, Inventory, Finance, Integrations, Branches, Settings (role preview, demo reset). Browser back/forward follows the hash.
- At about 390px wide: stacked hero, full-width metrics, 2×2 dock with the mobile wave path, and no horizontal page overflow.

All data is synthetic and stored in the browser only. Do not connect real services.
