# Completion pass — 10 September 2026

This pass is **not full completion of the supplied brief**. The implemented milestones are preserved and the remaining work is listed explicitly below. Feature expansion stopped to reserve the remaining usage for visual correction, regression checks and a stable handoff.

## Implemented

- **Shoulders:** garment sleeves start inside the torso yoke, closing the shoulder gap without moving the anatomical shoulder. Tees have separate loose sleeves and overlapping bare arms; outerwear has fuller sleeves.
- **Visor and lights:** the helmet visor outline and Sport headlight boundaries follow the actual mesh rows/columns. Increasing subdivisions alone did not remove the stepped material edges; the final meshes explicitly align those edges with their curved outlines. Full-face shape and helmet scale are retained.
- **Supermoto:** steering head, double-cradle frame, engine relationship, subframe, substantial swingarm, shock/coil, radiator/shrouds, seat/tail, fork guards and compact mask were rebuilt around the supplied reference relationships. One exhaust side remains.
- **Sport:** broader connected front cowl and headlights, intake, curved windscreen, mirrors, tank, full side/lower fairings and tail. No copied motorcycle logos or registration plates.
- **Garments:** distinct tee/hoodie/zip/outerwear volumes, longer tee sleeves, shorter zip fit, waist/armpit/pants folds, hem overlap, zip-hood sponsor clearance and windbreaker collar. Selected-color artwork lookup and low-contrast print extraction were repaired. Prints remain garment textures, never floating planes.
- **Controls:** A/Left and D/Right steer; S/Down hold wheelie; W/Up/swipe-up/LIFT produce a brief grounded front-wheel lift. Mobile wheelie remains a hold/release control. Tutorial, help and pause hints match.
- **Airborne restriction:** the engine accepts one lane change per ramp flight. Extra inputs are ignored, road-edge commands do not spend the allowance, pause does not reset it, and actual landing restores steering.
- **Rider motion:** independently solved left/right arm and leg IK drives skinned curved garment/limb meshes. Wheelies shift hips rearward, steering moves the torso/shoulders, and landings compress the rider/chassis. Hands and feet retain bike contacts; all four limb lengths, torso length, shoulder/hip widths and helmet scale remain shared across motorcycles. Pause freezes the animation. Skinned geometry is reused and skeleton resources are disposed when changing appearance.
- **Maneuver:** manual lift never launches the motorcycle, cannot be extended by repeated commands and has a recovery interval. It clears a low raised road edge when timed correctly; vehicles still collide. Roadwork wedges launch automatically with speed-dependent vertical velocity. Cleared hazards award once and reset on pool reuse. Saved `jumps` remains the count of real ramp launches, preserving schema 1.

## Visual review

- All three motorcycles: exact side, front, front three-quarter and rear three-quarter in the running Garage. Supermoto/Sport were compared to the supplied photographs. Töffli silhouette and tire/fender clearance were verified, with no large moped rebuild.
- All nine equippable tops: front/back in the persistent Garage viewer beside the real product photographs. Keep Up tee/hoodie/zipper, Racing Zipper, Ziptie Windbreaker, Streetphotographer tee/hoodie and Signs tee/hoodie. Research covered all 35 color appearances; the final 3D review used one representative color per top, including faint gray ink where available. It does not claim every color was rendered in 3D.
- Riding: independent shoulder/hip motion viewed from a side inspection camera during a real wheelie and lane change. This is also checked through the rendered scene's joint positions, without production test controls.
- Merriweather: existing real-font tests render 23, 32 and 37 in the proof and garment CanvasTexture and check oldstyle descenders. Preview/equip separation remains intact.
- Screenshots are generated under `outputs/`: `final-{125,450,701}-{side,front,three-quarter,rear}.png`, `garment-*-{FRONT,BACK}.png`, `source-*-{FRONT,BACK}.png`, `rider-wheelie-side.png`, and `rider-lane-response.png`.

## Validation

- Typecheck: passed (`npm run typecheck`).
- Lint: passed (`npm run lint`).
- Unit tests: **32 passed**, six files (`npm test`). Covers immutable skeleton/skin binding, maneuver timing, collision/near-miss/reward rules, airborne restrictions, deterministic stepping, saves, progression and catalog coverage.
- Browser tests: **12 passed** (`npm run test:browser`), including menu/start, keyboard/touch controls, real ramp approach, independent rider motion/pause, all nine tops, all bike inspection views, Merriweather 23/32/37, preview/equip persistence, narrow screens, console/assets, crash/reward/restart and navigation.
- Production build: passed (`npm run build`). The existing Three.js bundle-size advisory remains nonblocking.
- No blocking runtime errors were observed in the tested flows. The asset/console regression completed without failed asset requests or console errors.

Tests use the actual production build on port 5190, Edge and emulated mobile touch. The ramp control test follows an ordinary deterministic spawn through the real UI; it does not inject an airborne state into the production engine. Changed files are listed in `docs/CHANGED-FILES.txt`.

## Unfinished

1. **P7: world/environment and actual tunnels.** The current repeated streets and short overhead structures remain. There is no meaningful tunnel section with entrance, walls, roof, interior lighting and exit. The new road-section helper schedules roadwork hazards; it does not claim a corresponding completed environment renderer.
2. **P3 finer product construction:** source-derived washed/acid-washed fabric variation, distinct split/kangaroo pocket construction and finer product-specific cuffs/hem finish. Current volume/folds/artwork are improved, but these details are not finished.
3. Physical iOS/Android device performance and extended gameplay/economy tuning. Browser mobile tests emulate touch/viewport in Edge.

No external authentication, cloud save or real-world reward implementation was added; existing replaceable service boundaries remain.
