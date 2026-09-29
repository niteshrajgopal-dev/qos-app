# QOS Portal — asset kit

Created 28 September 2026 from the supplied 8.5-second architectural portal reference.

## Files
- qos-portal-scene.png: original 1672 × 941 cinematic background, created with built-in image generation. No embedded interface.
- brand/qos-logo-original.png: recovered selected QOS logo, unchanged. For the dark interface a CSS brightness/invert treatment renders its exact geometry in white. The original remains available.
- fonts/: bundled Nimbus Roman display and Nimbus Sans interface fonts with licence.
- icons/: twelve Lucide interface SVG assets with licence. Icons are deterministic vectors, not raster approximations.
- tokens.css: colour, typography, surface and motion tokens.
- motion/light-effects.css and motion/LightWave.tsx: reusable glass buttons and travelling spectrum wave source.

## Adaptation
The reference governs architectural composition, large serif hierarchy, glass rail, cyan/violet dock light and camera drift. QOS remains a multi-tenant staff back office. Quotes is the selected sample business; menu management belongs to QOS.

## Motion specification
- Scene: 22-second alternating dolly from scale 1.03 to 1.13, X translation -0.7% to 0.7%; pointer offset at most 8 pixels. CSS layer, not a generated video.
- Intro: type at 220 ms, metrics at 360 ms, dock at 480 ms; each fades and rises 18 pixels over 850 ms.
- Dock: highlight advances every 3.4 seconds. A cyan/violet/pink SVG light wave travels across the buttons on a 13.6-second loop, with a blurred tail, bright core and highlight point. The mobile dock uses a separate path across both rows. Hover/focus pauses the travelling wave and intensifies the focused button.
- Buttons: translucent, blurred glass, inset bevel reflections, animated conic rim (8 seconds for primary actions, 4 seconds for the active dock card), and a travelling specular reflection. Secondary buttons brighten on interaction.
- Mount LightWave once inside the dock, before its buttons. Load light-effects.css after the base design styles. All effect layers have pointer-events:none. Ambient pause freezes the wave and button light; OS reduced motion disables them.
- Workspace: fade/rise 350 ms. Detail sheet: native accessible sheet, 300–500 ms.
- Reduced motion: disables dolly, pointer offsets, cycling and entrances; visible pause control available.

## Image prompt
Original cinematic architectural background, landscape 16:9. An immense monolithic slate wall with a giant vertical oval opening at approximately 63% width. Luminous warm sunset cloud layers and distant hazy mountains through the opening. Tiny solitary human silhouette at the threshold. Wet reflective floor in the lower quarter. Quiet dark left 42% and subdued right edge. Photorealistic futuristic architectural visualization; tactile concrete, graphite blue-gray, lavender reflections, peach-gold rim, restrained bloom. Background only; no UI, letters, labels, logos, metrics or watermarks. The supplied reference frame was used for mood and composition.

## Prototype boundaries
All operational records are synthetic demonstration data. Local changes are saved only in the current browser. Publishing and payment controls simulate workflows and never publish to QOS or charge customers.
The previous design_handoff_qos_platform.zip was unavailable in this session. Module coverage is grounded in the recovered QOS development handover and the conversation's established features. This is a new design prototype, not a verified reproduction of every current production screen.
