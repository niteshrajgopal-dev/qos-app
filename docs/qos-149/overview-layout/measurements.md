# Overview layout overlap measurements

Playwright bounding-box checks on `/dev/overview-layout-harness` (fixture data only). Pairs checked: rail×storefronts, rail×dock, rail×hero, rail×footer, hero×dock.

## `origin/main` CSS (before fix)

| Width | Height | Pass | Overlaps |
| --- | --- | --- | --- |
| 1920 | 900 | **FAIL** | hero×dock |
| 1920 | 800 | **FAIL** | rail×storefronts; rail×dock; hero×dock |
| 1920 | 600 | **FAIL** | rail×storefronts; rail×dock; hero×dock |
| 1600 | 900 | **FAIL** | hero×dock |
| 1600 | 800 | **FAIL** | rail×storefronts; rail×dock; hero×dock |
| 1600 | 600 | **FAIL** | rail×storefronts; rail×dock; hero×dock |
| 1440 | 900 | PASS | — |
| 1440 | 800 | **FAIL** | rail×storefronts; rail×dock; hero×dock |
| 1440 | 600 | **FAIL** | rail×storefronts; rail×dock; hero×dock |
| 1366 | 900 | PASS | — |
| 1366 | 800 | **FAIL** | rail×storefronts; rail×dock; hero×dock |
| 1366 | 600 | **FAIL** | rail×storefronts; rail×dock; hero×dock |
| 1280 | 900 | PASS | — |
| 1280 | 800 | **FAIL** | rail×storefronts; rail×dock; hero×dock |
| 1280 | 600 | **FAIL** | rail×storefronts; rail×dock; hero×dock |
| 1200 | 900 | PASS | — |
| 1200 | 800 | **FAIL** | rail×storefronts; rail×dock; hero×dock |
| 1200 | 600 | **FAIL** | rail×storefronts; rail×dock; hero×dock |
| 1100 | 900 | PASS | — |
| 1100 | 800 | **FAIL** | rail×storefronts; rail×dock; hero×dock |
| 1100 | 600 | **FAIL** | rail×storefronts; rail×dock; hero×dock |
| 1024 | 900 | PASS | — |
| 1024 | 800 | **FAIL** | rail×storefronts; rail×dock |
| 1024 | 600 | **FAIL** | rail×storefronts; rail×dock; hero×dock |
| 960 | 900 | PASS | — |
| 960 | 800 | **FAIL** | rail×storefronts; rail×dock |
| 960 | 600 | **FAIL** | rail×storefronts; rail×dock |
| 901 | 900 | PASS | — |
| 901 | 800 | **FAIL** | rail×storefronts; rail×dock |
| 901 | 600 | **FAIL** | rail×storefronts; rail×dock |
| 900 | 900 | PASS | — |
| 900 | 800 | **FAIL** | rail×storefronts; rail×dock |
| 900 | 600 | **FAIL** | rail×storefronts; rail×dock |
| 853 | 900 | PASS | — |
| 853 | 800 | **FAIL** | rail×storefronts; rail×dock |
| 853 | 600 | **FAIL** | rail×storefronts; rail×dock |
| 800 | 900 | PASS | — |
| 800 | 800 | **FAIL** | rail×storefronts; rail×dock |
| 800 | 600 | **FAIL** | rail×storefronts; rail×dock |
| 731 | 900 | PASS | — |
| 731 | 800 | **FAIL** | rail×storefronts; rail×dock |
| 731 | 600 | **FAIL** | rail×storefronts; rail×dock |
| 681 | 900 | PASS | — |
| 681 | 800 | **FAIL** | rail×storefronts; rail×dock |
| 681 | 600 | **FAIL** | rail×storefronts; rail×dock |
| 680 | 900 | PASS | — |
| 680 | 800 | PASS | — |
| 680 | 600 | PASS | — |
| 640 | 900 | PASS | — |
| 640 | 800 | PASS | — |
| 640 | 600 | PASS | — |
| 480 | 900 | PASS | — |
| 480 | 800 | PASS | — |
| 480 | 600 | PASS | — |
| 390 | 900 | PASS | — |
| 390 | 800 | PASS | — |
| 390 | 600 | PASS | — |
| 320 | 900 | PASS | — |
| 320 | 800 | PASS | — |
| 320 | 600 | PASS | — |

Raw JSON: `measurements-main.json`

## This branch (after fix)

Stacking applies only via:

```css
@media (min-width: 681px) and (max-height: 801px),
       (min-width: 1600px) and (max-height: 900px) { … }
```

| Width | Height | Pass | Overlaps |
| --- | --- | --- | --- |
| 1920 | 900 | PASS | — |
| 1920 | 800 | PASS | — |
| 1920 | 600 | PASS | — |
| 1600 | 900 | PASS | — |
| 1600 | 800 | PASS | — |
| 1600 | 600 | PASS | — |
| 1440 | 900 | PASS | — |
| 1440 | 800 | PASS | — |
| 1440 | 600 | PASS | — |
| 1366 | 900 | PASS | — |
| 1366 | 800 | PASS | — |
| 1366 | 600 | PASS | — |
| 1280 | 900 | PASS | — |
| 1280 | 800 | PASS | — |
| 1280 | 600 | PASS | — |
| 1200 | 900 | PASS | — |
| 1200 | 800 | PASS | — |
| 1200 | 600 | PASS | — |
| 1100 | 900 | PASS | — |
| 1100 | 800 | PASS | — |
| 1100 | 600 | PASS | — |
| 1024 | 900 | PASS | — |
| 1024 | 800 | PASS | — |
| 1024 | 600 | PASS | — |
| 960 | 900 | PASS | — |
| 960 | 800 | PASS | — |
| 960 | 600 | PASS | — |
| 901 | 900 | PASS | — |
| 901 | 800 | PASS | — |
| 901 | 600 | PASS | — |
| 900 | 900 | PASS | — |
| 900 | 800 | PASS | — |
| 900 | 600 | PASS | — |
| 853 | 900 | PASS | — |
| 853 | 800 | PASS | — |
| 853 | 600 | PASS | — |
| 800 | 900 | PASS | — |
| 800 | 800 | PASS | — |
| 800 | 600 | PASS | — |
| 731 | 900 | PASS | — |
| 731 | 800 | PASS | — |
| 731 | 600 | PASS | — |
| 681 | 900 | PASS | — |
| 681 | 800 | PASS | — |
| 681 | 600 | PASS | — |
| 680 | 900 | PASS | — |
| 680 | 800 | PASS | — |
| 680 | 600 | PASS | — |
| 640 | 900 | PASS | — |
| 640 | 800 | PASS | — |
| 640 | 600 | PASS | — |
| 480 | 900 | PASS | — |
| 480 | 800 | PASS | — |
| 480 | 600 | PASS | — |
| 390 | 900 | PASS | — |
| 390 | 800 | PASS | — |
| 390 | 600 | PASS | — |
| 320 | 900 | PASS | — |
| 320 | 800 | PASS | — |
| 320 | 600 | PASS | — |

Raw JSON: `measurements.json`

Screenshots (1024, 960, 853, 731 × 900) are kept as local run artifacts only, not in the repo.
