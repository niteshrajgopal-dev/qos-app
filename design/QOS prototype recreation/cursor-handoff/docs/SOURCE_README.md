# QOS Portal prototype

An interactive QOS staff workspace adapted from the architectural portal screen recording supplied on 28 September 2026.

## Included
- Cinematic overview with original portal artwork, slow camera drift, pointer parallax, animated target ring and sequential glass dock lighting.
- Orders: branch scope, status tabs, search, detail sheet, fulfilment progression and CSV export.
- Catalogue: categories, search, product creation/editing, price and availability controls.
- Menus: create drafts, assign branch/products, Arabic approval and role-gated simulated release publishing.
- Storefronts: Quotes preview, content settings, languages and simulated publication.
- Inventory: material levels, low-stock state and stock receipts.
- Finance: period controls, sample chart and transaction table.
- Integrations: sandbox connection state and simulated sync.
- Branches: opening information, availability control and branch orders.
- Settings: Administrator/User preview, motion toggle and local demo reset.

## Run
Use Node 22 or later and the checked-in pnpm lockfile. Install dependencies with `pnpm install`, then `pnpm dev`. Use `pnpm build` for the configured Sites runtime. The default application lives in `app/page.tsx`; `app/prototype-data.ts` contains the synthetic seed records and `app/globals.css` contains responsive presentation and motion.

## Assets
`public/assets/` includes the original generated architectural scene, the selected QOS logo, licensed fonts, Lucide SVG icons and design tokens. See `ASSET_GUIDE.md` for prompts, licences and motion values. No external fonts or images are fetched at runtime. The logo geometry is unchanged; a CSS filter supplies the white treatment.

## Data boundary
All data is synthetic and demo actions are browser-local, backed by localStorage. This is not an authenticated QOS client and has no QOS, Azure, payment or external integration credentials. Publishing simulates version increments; a production implementation must connect immutable release snapshots, server role checks and audit logs to the existing QOS backend. No production files, database, storefront or infrastructure were changed.

The previous `design_handoff_qos_platform.zip` was unavailable in this session. The feature coverage is based on the recovered QOS development handover and established conversation context, not a verified audit of every current production screen.

## Reference adaptation
Architecture, serif hierarchy, translucent metric rail and active module dock follow the supplied recording. Background movement is authored image-layer camera motion, not an extracted reference video. Mobile rearranges the metric rail and dock into stacked controls. Reduced-motion settings and a visible pause control are supported.

## Validation
TypeScript compilation passed. Browser inspection covered the desktop composition, 390px mobile layout, order New → Preparing, blocked menu publication without Arabic approval, and successful approval → version increment. The optional WebMCP navigation action is feature-detected; this browser did not expose modelContext, so its runtime validation was unavailable. This does not affect human UI navigation.

## Glass and light enhancement
`app/light-effects.css` and `app/LightWave.tsx` add refractive button surfaces, rotating rim highlights, a travelling cyan/violet/pink wave across the dock, hover/focus reflections, and an alternate two-row mobile path. Ambient pause and system reduced-motion settings apply.
