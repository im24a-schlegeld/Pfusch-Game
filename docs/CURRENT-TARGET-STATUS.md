# Current target checkpoint — 10 September 2026

This is a validated visual-repair checkpoint, **not completion of the full current target**. The active Codex goal and the user's authoritative request at `C:/Users/dario/.codex/attachments/9fe43898-1d4b-462e-872b-323d835aefc8/pasted-text.txt` remain in effect. Later steering prioritized Sport wheel/front-shell/fender repairs and moving the Töffli front wheel forward. Do not resume from the earlier completion report alone.

## Completed in this checkpoint

- Töffli: front axle moved forward 120 mm. The retained steering-head target gives a visibly raked fork. Wheel/fender move together with existing tire size and clearance preserved.
- Sport: corrected 17-inch rim size, independent front/rear tire crown and sidewall profiles, 1441 mm axle spacing, ground-level wheel placement, aligned fork covers, twin front/smaller rear brake discs with stationary calipers. The front fender is shorter and concentric with its tire. Upper nose and side surfaces now share their curved boundary; separate lower panel, belly pan and radiator replace the uninterrupted slab. See `SPORT-REFERENCE-AUDIT.md` for internet references and exact dimensions.
- Helmet: fuller rear shell down toward the neck, removed strong rear undercut and visor recess, shared 6.5% scale increase and slight forward/downward tilt. All bikes retain identical helmet scale.
- Clothing: directional local armpit/hip/elbow/cuff folds, less inflated sleeve starts, loose short-sleeve opening and layered thin folded hem. The concealed pants waistband sits inside the shirt; its former excessive depth caused the dark patch protruding through the lower back. These modify garment mesh shape, never skeleton dimensions.
- Racing Zipper: exact supplied `tribal-racing.png` copied unchanged to `public/images/artwork/tribal-racing.png`. SHA-256: `1700D3D4773351D7B789DD93C7B41FE8D148CD82B77C975E99595D9B3D10D9AE`. It replaces the small photographic sleeve crops in the material compositor. Mirrored outer-sleeve UV placement follows sleeve curvature, flame toward elbow/upper arm and checker toward cuff. Side/front/rear-three-quarter inspection confirms the placement; no artwork planes.
- Preserved: immutable skeleton/fixed-length IK, integrated torso artwork, real Merriweather oldstyle 23/32/37, persistent Garage, temporary locked preview/explicit Equip, current controls and airborne restriction, no registration plates.

## Visual QA

- All bikes: side, front, front three-quarter and rear three-quarter in the production Garage. Sport compared to BMW's official photograph and technical data, and supplied references. Töffli checked against the supplied fork screenshot and Ciao reference.
- All nine tops: current front/back views with real product photos beside the viewer. Additional side/front-three-quarter/rear-three-quarter views for Racing Zipper, Keep Up tee and hoodie. Checked shoulders, sleeve length, hem overlap and helmet rear.
- Current evidence: `outputs/final-*-*.png`, `outputs/garment-*-FRONT.png`, `outputs/garment-*-BACK.png`, `outputs/garment-detail-*.png`, and `outputs/current-clothing-review-{1,2,3}.jpg`.
- These are stylized procedural models. Product-specific washed fabric, pockets and fine seam construction remain partial. This report does not claim photorealistic or exact licensed motorcycle replicas.

## Gameplay and audio status — do not mistake preservation for completion

The existing S/Down hold-wheelie, mobile hold/release, W/Up timed grounded lift and physical ramp flight are retained and regression tested. One lane change per airborne period remains enforced. **The requested replacement balance physics is not implemented.** W/Up is still lift, not forward-weight correction; current wheelie uses heat/lock behavior. Arbitrary launching ramps still exist. Do not mark the new gameplay acceptance tests complete.

Audio still uses the existing generic oscillator. There are no three engine identities or tunnel acoustics, and no new audible identity QA was performed. The world still uses repeating streets/overhead structures; the road-section helper only schedules hazards. It is not the requested procedural rendered world.

## Exact remaining priorities

1. Finish cloth material/construction realism: source-derived washed fabric, tee shoulder seams, hoodie pockets, split zipper pockets, product-specific cuffs/hem, waist layering from more poses. Preserve the new sleeve graphic and immutable skeleton.
2. Supermoto: correct drive-side chain/sprockets with tangent runs, actual rotor annuli instead of the extra solid front discs, correct rear caliper/rotor, road-wheel/rim proportions and final frame/swingarm mechanical QA. Sport may still benefit from finer tank, cockpit and fairing construction after the corrected wheel layout; keep the new dimensions and short fender.
3. Cap: keep hip location, orient crown rear near pants and brim rearward/side/down; curved brim plus real design. Bag: rearward orientation, attachment and actual artwork. These were not changed in this checkpoint.
4. Distinct tuned 50cc two-stroke, four-stroke single, 1000cc inline-four procedural/legal audio with rev/load variation; audibly compare all three.
5. Replace timed lift/heat wheelie with deterministic angle/angular-velocity balance: S/Down rearward/throttle, W/Up forward correction; bike-specific balance/torques, recovery, overrotation crash and skill scoring. Remove generic lift/jump action and arbitrary launching ramps; retain one lane change only for legitimate physical airborne periods. Update keyboard/mobile/tutorial/tests together.
6. Add forward/rearward rider response to the new inputs, steering and road response through fixed-length IK. Preserve existing skinned mesh reuse, pause and contact targets.
7. Fair motorcycle road events and optional risk lines with reachable paths and reaction time. Bounded seeded authored-segment selection with logical transitions and nonrepeating run sequences.
8. Actual tunnels with entrance/walls/roof/interior/exit, variable durations including rare long tunnels; continuous bridges over visible water with rails, supports and coherent land transitions; day/golden/night/dawn variation and environment-dependent traffic.
9. Tunnel audio response preserving each motorcycle identity. Subtle blue actual-ink emissive mask only for the three matching Keep Up garments in dark environments.
10. Remove unrelated global slogan uses. Current incomplete occurrences: `app/ui/GameApp.tsx` menu heading; `app/game/SceneView.tsx` sign; `app/domain/config.ts` final rank label; `app/ui/Screens.tsx` ranking kicker; `index.html` title/description; historical homepage-slogan note in `docs/CATALOG.md`. Catalog/product artwork, product names and product-specific review documentation are legitimate matches. No claim is made that all occurrences are product-specific yet.
11. Full gameplay/world/audio/visual regression after those systems, then typecheck/lint/unit/browser/build and owner-private publishing. Physical iOS/Android testing remains unavailable; current mobile QA is Edge touch/viewport emulation.

Optional chase events are last, only after the entire required core is stable.

## Validation

Typecheck, lint, 34 unit tests in seven files and production build pass. All 12 browser cases are verified: the final full run passed 11, with the garment case encountering local preview connection resets/refusals; its targeted rerun passed with zero console/asset errors. An earlier full run before the final concealed-waistband adjustment passed all 12 together. The updated riding side view confirms the waistband no longer protrudes through the garment. Production preview: `http://127.0.0.1:5190`. The Sites build helper encountered a Windows npm shim resolution error; the established `npm run build` completed successfully. No dependency or watcher configuration was changed to bypass the helper issue.

Current checkpoint file list: `CURRENT-CHANGED-FILES.txt`. Prior validated repairs already committed in `7569938` are described in `COMPLETION-PASS.md`; the current goal supersedes its unfinished list.
