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
- [x] Prove subpixel pine-edge coverage loss and retain the 1.05-pixel stroke with a bounded cone-only corner miter; actual moving capture inspection remains in Task 3.

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
