Build a faithful, interactive reproduction of the approved QOS Portal prototype using the attached QOS_Claude_Design_Handoff.zip. This is an implementation request: deliver a working preview with all screens and animations.

The design is already approved. Preserve its composition, artwork, typography, colours, spacing, glass materials, and motion. The attached source is the implementation reference. Reuse it directly wherever possible; adapt only the framework setup, imports and asset paths required by your environment.

Reference: https://qos-portal.chantalnitz.chatgpt.site
The reference may require its owner's sign-in. If inaccessible, continue from the attachment. It contains the approved source, exact assets and a detail screenshot of the enhanced buttons. Do not make access to the hosted reference a prerequisite.

1. Read the attachment before building

- Read README.md and reference-source/app/page.tsx for the complete screen structure, copy and interactions.
- Read reference-source/app/globals.css for exact layout, typography, component styling, breakpoints and background motion.
- Read reference-source/app/light-effects.css and reference-source/app/LightWave.tsx for the approved glass buttons and travelling light wave. These effects are essential; copy their actual implementation.
- Read reference-source/app/prototype-data.ts for synthetic records, module names and branches.
- Reuse reference-source/components/ui/, reference-source/lib/utils.ts and reference-source/vendor/ where supported.
- Copy reference-source/public/ into your application's public asset directory. Retain the local fonts and their licences. Preserve the /assets/ paths or update every dependent reference consistently.
- Treat source code as authoritative for precise timings and dimensions if an asset guide is approximate. QOS_Portal_Preview.jpg is a scrolled detail view of the buttons, not the complete hero composition.

2. Product identity and scope

QOS is a POS-agnostic, multi-tenant staff back office for orders, catalogue, menus, storefront management, inventory, finance, integrations and branches. Quotes is the selected sample business and its customer-facing brand. Menu management belongs to QOS.

Use the supplied QOS logo with its exact geometry. The current header renders it white with brightness(0) invert(1), with WORKSPACE beneath it. Do not add an expanded meaning for QOS.

Build all ten views: Overview, Orders, Catalogue, Menus, Storefronts, Inventory, Finance, Integrations, Branches and Settings. Start directly on Overview. Preserve hash navigation, browser back/forward behaviour and the working controls in the source. This is a browser-local demonstration with synthetic data and simulated publishing/payment/integration states; do not connect production systems.

3. Match the approved visual composition

Use public/assets/qos-portal-scene.png unchanged as the fixed, full-bleed background. It depicts a dark architectural wall, a large oval portal opening onto peach-gold sunset clouds, reflective ground and a small human silhouette. Preserve the quiet dark left side for copy and the portal on the right. The image contains no interface; render all text, metrics and controls as real UI above it.

Use the bundled QOS Display (Nimbus Roman) for the large serif headings and QOS Sans (Nimbus Sans) for the interface. Load the supplied font files; keep their weights and letter spacing.

Use the exact tokens and CSS: night #151b24, surface #202733, text #f4f3f5, muted #b1b7c4, violet #b3a1ef, cyan #99dfe9, peach #eec9b4, fine translucent borders and smoky glass panels. Large panels have approximately 20–24px radii. Preserve the layered gradients and opacity values from the source.

Desktop composition:
- A 94px header, approximately 4.1% horizontal padding, white QOS mark at left; Overview, Orders, Catalogue, Menus, Storefronts and More centrally; search, notifications, Quotes workspace picker and NR profile at right.
- The overview occupies the remaining viewport with a 680px minimum and 1100px maximum height. Preserve its 4.2% side margins.
- Upper-left hero: MONDAY, 28 SEPTEMBER; Good afternoon, Nitesh.; then the exact two-line headline “Your business.” / “In perspective.” The word “perspective.” uses the lavender-to-peach text gradient. Heading size is clamp(64px, 6.5vw, 112px), regular serif, 0.99 line-height and -0.043em tracking.
- Supporting copy: “Every order, every location, every detail.” / “A clear view of what’s next.”
- A glass pill labelled Manage orders, with its separate circular glass arrow inset. Beside it, the understated underlined View performance action. Below, the dynamic orders-needing-attention link.
- Right-side BUSINESS PULSE glass rail, 218px wide at the base desktop breakpoint: 82% of daily target, AED 24,860 revenue, 12.8% vs yesterday, 186 orders, 3/3 branches open, and 96.4% fulfilment. Use the real SVG progress ring and slim progress bar. Keep the rail sufficiently dark for readability over the sunset.
- Four-button glass dock near the bottom: Orders / Keep every order moving.; Catalogue / Curate your offering.; Menus / Make every menu yours.; Storefronts / Bring your brand to life. Preserve icons, arrows, 01–04 labels, padding and the active lighting. Base desktop dock: 121px high, 81px from the overview's bottom, 7px internal padding.
- Preserve the small portal caption, prototype label, Your day at a glance scroll control and Ambient motion toggle.
- Below the hero, retain “Everything, connected.” with Recent activity, Across your branches and “A fresh menu. One release away.” cards, including the branch filter and working links.

4. Reproduce the motion exactly

Use the supplied CSS/SVG motion implementation. The approved background motion is authored over a still image; do not replace it with a different generated scene or video.

- Scene dolly: 22s ease-in-out, infinite alternate, scale 1.03 to 1.13, horizontal translation -0.7% to +0.7%, transform-origin 64% 60%.
- Pointer parallax: source formula (clientX / innerWidth - 0.5) × 10px horizontally and (clientY / innerHeight - 0.5) × 8px vertically, with a 1.6s transform transition. Disable for touch and reduced motion.
- Ambient light breathes over 11s. Entrances fade and rise 18px: hero 0.9s after 0.18s, metrics 1s after 0.32s, dock 1s after 0.48s.
- Buttons must look like translucent glass with blur(18px) saturate(145%), layered cyan/lavender reflections, a thin masked conic-gradient rim, inset bevel highlights and soft shadows. Preserve the real transparency and CSS layering.
- Primary button rim rotates over 8s; a specular reflection sweeps over 7s. Hover/focus accelerates the rim to 3.5s and adds a subtle lift/glow. Secondary-button rim and reflection activate on hover/focus, as in the supplied CSS.
- Dock selection advances every 3.4s through all four modules. Each selected card has a 4s rotating luminous rim, a 3.4s glass reflection wash and an illuminated icon enclosure.
- The light wave must physically travel along the supplied curved SVG path across the dock over 13.6s. Preserve its blurred tail, narrow luminous core and bright point, with cyan, violet and pink colour transitions. Copy LightWave.tsx and its stroke-dasharray/stroke-dashoffset animation exactly. A static glow or simple colour fade is insufficient.
- Mount LightWave once inside the dock, before the buttons. Preserve required class names, selector relationships and layering. All decorative effects must have pointer-events:none and remain hidden from accessibility navigation.
- Hover or keyboard focus selects that module, holds the automatic cycle and travelling wave, and intensifies the selected rim. Leaving the dock resumes it.
- The visible motion toggle must pause scene and button effects, including buttons rendered inside portalled dialogs/sheets. Preserve the root data-qos-motion attribute and local motion preference. Respect prefers-reduced-motion throughout.

5. Preserve the operational prototype

Copy the supplied view logic and seed data. Keep the shared header, subdued blurred architectural background on internal screens, serif titles, translucent panels, search/filter controls, tables, dialogs, sheets, badges and feedback toasts.

- Orders: branch scope, status tabs, search, details, New → Preparing → Ready → Completed and CSV export.
- Catalogue: category filters, search, product creation/editing, price and availability controls.
- Menus: drafts, branch/product assignment, Arabic approval, Administrator-only simulated publishing and version increments.
- Storefronts: Quotes preview, name/language settings and simulated releases.
- Inventory: stock levels, low-stock indicators and receiving stock.
- Finance: reporting-period controls, sample chart and transactions.
- Integrations: simulated connection and sync states for Stripe, POS connector and FineDine.
- Branches: HBZ Stadium, HCT Academic City and Al Ain Zoo; hours, availability and branch orders.
- Settings: Administrator/User preview, ambient motion control and confirmed demo reset.
- Global search via button and Cmd/Ctrl+K; notifications, workspace picker and profile controls must work.

Use browser-local persistence as supplied. Preserve role-sensitive and disabled states. Keep any operational copy describing production-safe releases as demo presentation; production authentication, immutable releases and server enforcement are outside this prototype.

6. Responsive behaviour and completion

Preserve the supplied 1600px, 1200px, 960px and 680px breakpoints. On small screens, use the stacked hero, compact full-width metrics panel and two-by-two dock. Switch to the supplied mobile SVG path, which travels across both rows. Maintain usable navigation, overlays and horizontally contained tables without page overflow.

Use React with TypeScript, Tailwind 4 and the supplied accessible component structure where supported. Adapt to your preview environment without changing the visual result. Hosting-specific files are intentionally excluded; they are not required to reproduce this UI. The original dependency manifest is provided as reference, not as mandatory hosting configuration.

Verify desktop and approximately 390px mobile layouts, font/image loading, all navigation, order progression, menu approval/publishing, and both motion controls. Watch the dock for a complete 13.6s wave cycle. Check keyboard focus and reduced-motion behaviour. Deliver the working interactive preview and organised editable source. Continue through implementation and verification without stopping at a design plan or static mockup.
