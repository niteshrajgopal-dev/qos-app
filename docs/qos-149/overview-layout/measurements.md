# Overview layout measurements (summary)

Dense grid: widths 681, 731, 768, 800, 853, 900, 960, 1024, 1100, 1180, 1280, 1366, 1440, 1536, 1600, 1680, 1800, 1920; heights 500, 550, 600–1100 step 25; plus zoom viewports 853×533 (1280@150%), 731×457 (1280@175%), 960×600 (1440@150%), 823×514 (1440@175%).

Full per-cell results: `measurements-main-dense.json`, `measurements-branch-dense.json`.

## Counts

| Dataset | Total cells | PASS | FAIL |
| --- | ---: | ---: | ---: |
| `origin/main` CSS | 418 | 167 | 251 |
| This branch CSS | 418 | 418 | 0 |

## Main-PASS cells stacked on branch

Count: **0** (target **0**).

## Stack boundaries (from main dense grid)

A single global `max-height` cannot cover all widths (e.g. 1024px needs stacking through 849px tall while 1280px absolute layout passes from 875px). CSS uses width bands; each `max-height` is **one pixel below** the lowest main PASS height in that band.

- **681–767px** → stack when viewport height **≤ 874px**
- **768–959px** → stack when viewport height **≤ 874px**
- **960–1023px** → stack when viewport height **≤ 874px**
- **1024–1180px** → stack when viewport height **≤ 849px**
- **1181–1599px** → stack when viewport height **≤ 874px**
- **1600–∞px** → stack when viewport height **≤ 974px**

Zoom cells on branch: 1280@150% 853×533 → PASS; 1280@175% 731×457 → PASS; 1440@150% 960×600 → PASS; 1440@175% 823×514 → PASS.

