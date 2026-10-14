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
- [ ] Require successful remote unit/browser/build checks and live deployment before concluding.

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
- [ ] Capture the remaining T-shirt rear-quarter edge against scenery and an enforced plain background; add no speculative neckline ink.
- [ ] Review the final diffs, verify remotely, inspect native captures and retain exact deployed loading artwork before completion.

### Task 6: Desktop loading foreground

- [x] Identify the giant foreground street-lamp pole in the actual wide loading image.
- [x] Trim only near-camera authored lamp parts during the static artwork export; restore every shared instance buffer after each shot.
- [x] Verify with the actual seeded world and approved camera; retain background lighting and non-lamp props.
- [x] Extend static boot checks to 1920×1080 and 2560×1080.
- [ ] Inspect the regenerated wide artwork and boot screenshots before final completion.
