# QOS design system — Cursor drop-in

Everything Cursor needs, nothing it doesn't. **No HTML and no loose `.jsx` files** in this
bundle — inline `<script>` blocks are what makes antivirus flag the full archive. What's here is
CSS, Markdown, PNGs, and three plain-text source bundles Cursor unpacks in one step.

## Install

This folder mirrors your repo layout. Unzip it and merge the four top-level folders into the
root of `qos-app`:

```
src/app/qos-tokens.css        →  already at the right path, just copy it in
src/app/qos-components.css    →  same
public/brand/*.png            →  same
docs/*.md                     →  same
design-system/**              →  reference sources; keep out of src/
```

Nothing collides with an existing repo file, so a plain merge is safe.

Then unpack the three source bundles — give Cursor this:

> In `design-system/`, unpack `components-part1.txt`, `components-part2.txt` and `screens.txt`.
> Each holds multiple files delimited by lines of the form `===== FILE: <path> =====`. Write every
> block to its path relative to `design-system/`, creating directories as needed, then delete the
> three `.txt` bundles.

That yields `design-system/components/**` (40 components × `.jsx` + `.d.ts` + `.prompt.md`) and
`design-system/screens/**` (8 screens + `AppShell.jsx` + `data.js`).

Then in `src/app/globals.css`, above the Tailwind import:

```css
@import "./qos-tokens.css";
@import "./qos-components.css";
@import "tailwindcss";
```

…and delete the existing `--background` / `--foreground` pair and the `prefers-color-scheme`
block. QOS theming is explicit (`data-qos-theme="light" | "dark"` on `<html>`), not OS-driven.

Add `design-system/**` to your ESLint and `tsconfig` excludes — those `.jsx` files are untyped
design references and are not meant to compile.

## Then tell Cursor

> Read `docs/CURSOR_HANDOFF.md` and implement the QOS design system. The files under
> `design-system/` are design references, not production code — rebuild each component as a
> typed React component in `src/components/`, keeping the props contract from its `.d.ts`, the
> usage rules from its `.prompt.md`, and the exact numeric values from `src/app/qos-components.css`.
> Start with `StatusBadge` and `QOS_STATES`.

## What's in here

| Path | Contents |
| --- | --- |
| `src/app/qos-tokens.css` | All ten token files flattened in dependency order. Transfers literally. |
| `src/app/qos-components.css` | Every `.qos-*` rule with all interactive states. Transfers literally. |
| `design-system/tokens/` | The same tokens as ten separate files, if you prefer them split. |
| `design-system/components-part1.txt` | 51 files — `Logo` and all 17 primitives. |
| `design-system/components-part2.txt` | 72 files — data, feedback, navigation, intelligence. |
| `design-system/screens.txt` | 10 files — 8 screens, `AppShell.jsx`, `data.js` fixtures. |
| `public/brand/` | 10 PNGs — logo cuts, app icon, brand motifs. |
| `docs/CURSOR_HANDOFF.md` | The implementation brief: build order, screen specs, state model, open questions. |
| `docs/qos-design-system-readme.md` | Brand context, content fundamentals, visual foundations, iconography. |

## Not in here

- The interactive prototype and the 28 specimen cards — all HTML. They live in the design system
  itself; they are documentation, not deliverables.
- Icons. The system uses Lucide 0.469.0; in production run `npm i lucide-react` rather than the
  CDN mask in `Icon.jsx`. **This is a substitution awaiting brand approval** — no icon files were
  supplied with the QOS brand assets.
- Font binaries. `qos-app` already loads Geist via `next/font/google`; the brand guide specifies
  Inter as the primary typeface. Pick one and set `--font-sans` accordingly.
