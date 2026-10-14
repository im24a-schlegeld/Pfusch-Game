# Moving Ride Contours Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore missing necessary contours while riding without changing the rider or gameplay.

**Architecture:** Reuse the existing material cuff ink and pooled exterior shells. Investigate the reported T-shirt and crown gaps with actual geometry and production-camera render captures before changing shader math.

**Tech Stack:** TypeScript, Three.js, Vitest, Playwright, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-14-moving-ride-contours.md`

## Global Constraints

- Immutable skeleton and original geometry buffers; preserve gameplay and palette.
- Hero limits: 32 shells / 10 hard contours; tree forms: three fixed borrowed-buffer draws.
- No triangle wireframes or false creases on smooth clothes.
- Heavy rendering runs on CI to conserve local battery.

## Review Focus

- Rear and oblique T-shirt views retain clean silhouettes without sleeve interior ink.
- Tree crowns against bright sky stay outlined while trunks retain existing wood shading.
- Lane changes and wheelies use the production camera and posed source skeleton.
- Pool recycling keeps shell counts and transforms synchronized; disposal preserves borrowed buffers.
- Tiny distant objects remain fogged; no full-screen pass or per-frame geometry allocation.

### Task 1: Actual tree forms

**Files:** `app/game/worldView.ts`, `app/game/worldFoliageOutline.ts`, `tests/world-foliage-outline.test.ts`.

**Interfaces:** `makeWorldFoliageOutline(sources)` retains `sync`, `resize`, `dispose`; add `round:trunk` to its sources.

- [x] Require a shell for both crowns and actual trunks; observe missing trunk failure.
- [x] Add the third borrowed-buffer batch and retain source material/pool ownership.
- [x] Run the four focused actual-pool tests; check crown silhouette coverage without speculative shader changes.
- [x] Prove subpixel pine-edge coverage loss and retain a bounded cone-only corner miter; subsequent user feedback reduces the uniform stroke to 0.8 CSS pixels.

### Task 2: Actual rider boundaries

**Files:** `app/game/cartoonStyle.ts`, `app/game/cartoonOutline.ts`, `tests/rider-cartoon-outline.test.ts`.

**Interfaces:** `applyCartoonHeroStyle` and `createCartoonOutline` remain unchanged.

- [x] Prove all five real bike fixtures have open trouser cuffs with no authored boundary ink.
- [x] Opt `continuous-trouser-leg` into the existing UV cuff stroke; retain skin buffers and posed shell bindings.
- [x] Run five actual-bike regressions through opposite steer and wheelie poses.
- [x] Prove shoulder lighting normals leave actual visible silhouette gaps; add separate face-derived seam-welded outline normals while retaining the shared geometry and source lighting.

### Task 3: Production moving-camera verification

**Files:** `tests/browser-pwa/cartoon.spec.ts`.

- [x] Add actual rendered captures after engine ticks advance through left/right inputs and wheelie; never substitute the inspection camera.
- [x] Add moving-frame assertions for posed rider shells, trunk/crown batches, valid shaders and bounded draw counts; native frame inspection remains pending CI.
- [x] Obtain independent review and run focused checks before commit/push under standing authorization.
- [x] Require successful remote unit/browser/build checks and live deployment before concluding: run 38572345668 passes 147 files / 1,368 unit tests and all 19 browser tests; Oxygen deployment and routability succeed.

### Task 4: Distant traffic detail

**Files:** `app/game/trafficContours.ts`, `tests/traffic-contour-distance.test.ts`.

**Interfaces:** `createTrafficContour` keeps one cloned/shared line draw.

- [x] Observe the distance-fade regression fail against the old opaque contour.
- [x] Tag small interior segments once; fade their alpha at camera depths 24–62 metres while primary boundaries stay opaque.
- [x] Verify near/far shader behavior, unchanged geometry sharing, fog and depth-write policy with the lightweight focused probe.
- [x] Review transparency/order, shared resources and installed Three.js shader semantics; native traffic inspection remains pending CI.

### Task 5: Native image findings and requested wheel details

- [x] Inspect the first successful CI's real moving frames; identify transparent clouds overpainting depth-free exterior ink.
- [x] Make tree ink depth-writing after all coloured crowns and guard that ordering in focused tests and browser measurements.
- [x] Apply the same opaque-depth protection to hero shells and hard edges; keep translucent source materials intact.
- [x] Merge actual brake and Sport windscreen border geometry into compatible existing contour owners, retaining the 10-draw ceiling and correct moving rig transforms.
- [x] Correct actual Sport wheel finish noise and Scooter outer rim/tire classification with focused imported-model regressions.
- [x] Remove demonstrated coplanar tunnel body caps without removing real portal/rib caps or changing pooled instance counts.
- [x] Capture the remaining T-shirt rear-quarter edge against scenery and an enforced plain background; both native captures retain continuous exterior ink without speculative neckline ink.
- [x] Review the final diffs, verify remotely, inspect native captures and retain exact deployed loading artwork before completion.

### Task 6: Desktop loading foreground

- [x] Identify the giant foreground street-lamp pole in the actual wide loading image.
- [x] Trim only near-camera authored lamp parts during the static artwork export; restore every shared instance buffer after each shot.
- [x] Verify with the actual seeded world and approved camera; retain background lighting and non-lamp props.
- [x] Extend static boot checks to 1920×1080 and 2560×1080.
- [x] Inspect the regenerated wide artwork and 1920×1080 / 2560×1080 boot screenshots; the foreground lamp bar is absent and the brand/caption remain inside the viewport.

### Task 7: Latest user refinements

- [x] Refine the actual Sport rim hoop's uneven circular chords; preserve spokes, hub, original profile and a single draw, then inspect new front/rear views.
- [x] Reuse the existing black fabric material for the visible sock strip without changing leg geometry or bones.
- [x] Offer a dismissible installation hint after login, with a truthful offline status and no prompt inside an embedded or installed app; login return, recovered session, dismissal, native prompt and standalone cases pass remotely.
- [x] Use the actual GameBrand artwork including the clipped octagonal STOP sign for app icons; check maskable bounds and the generated PNGs.
- [x] Explain the discount task with actual dynamic goals and remaining progress; put detailed qualifying rules behind an accessible disclosure.
- [x] Remove clipboard/manual-link sharing fallbacks while retaining native sharing and a WhatsApp draft option; keep revive native-only.
- [x] Repair the isolated-background browser observer for the scene's real null background; require the complete remote browser/build/deploy gate.

### Task 8: Final visual feedback after the successful deployment

- [x] Put both Sport soles on the actual authored footpeg bars through the same fixed-length IK, retaining visible socks and the existing ankle/shoe offsets; real sole/peg raycasts and fixed-bone checks pass.
- [x] Apply the requested slight heel-up Sport foot angle about the actual supported sole point; rotate the same ankle target and keep all shared human dimensions unchanged.
- [ ] Correct the Scooter rim's pale edge at the tire boundary on the actual long front/rear faces, and inspect a native rear-wheel close-up.
- [x] Extend only the static loading-world rear street to the fogged horizon; keep the approved camera and gameplay pools untouched, with bounded static instance counts and preserved buffers.
- [x] Close the unexpected dark near-road gap using the existing headlight optics and two-light budget; actual road coverage and physical wheelie motion pass for all five bikes.
- [x] Add clean black boundaries to the existing reusable explosion SVG without changing its timing or pooling; existing lifecycle and stroke regressions pass.
- [x] Keep installation available after dismissing the login hint under Settings → App & Offline, including browser-menu instructions when no native prompt is available.
- [ ] Briefly inspect every bike's front/side native views, the new Sport foot contact, night beam, explosion and final wide loading crop; require successful remote checks/deployment and retain the resulting artwork.
