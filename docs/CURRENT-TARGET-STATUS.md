# PFUSCH current target — 15 September 2026

IMPLEMENTATION AND LOCAL VALIDATION COMPLETE. This status is recorded immediately before release. It covers the reference correction goal after checkpoint `71654c73ef56777580b7606aebf215fd672906ca`; earlier completion reports describe earlier releases.

## Completed in the existing priority order

1. Connected steering, forks, supports, engine and exhaust parts; improved restrained engine detail. Reduced garment inflation, improved the front and seated waist transition, and retained the requested bottom hem.
2. Corrected Supermoto and Sport against the supplied references and subsequent user feedback. Larger chassis retain the identical adult skeleton. Supermoto has larger wheels/rims, shorter seat, longer plastic tail and a supported forward-tucked silencer. Sport has a fully replaced pointed front, curved smoke screen, rounded tank, short rearward-wrapping front fender and subframe rails/mounts below the plastics. Mirrors removed. Inboard chains and Töffli belt preserved.
3. Added Roller between Töffli and Supermoto, with distinct geometry, small wheels, open floorboard, closed CVT, audio, progression, free preview and explicit Equip. Its pointed front follows the user's chosen gray Yamaha reference. Four-bike rider contacts use the same fixed-length IK.
4. Rebuilt the motocross shell, chin, real eye aperture, separate goggles and broad strap. The user clarified that the upper peak was the rejected part; it now has a narrower sculpted root, swept supports, tapered edge, small ridge and real relief openings. Above/front/side/rear and mobile Garage views were inspected. Full-face geometry remains preserved.
5. Increased blue glow only on actual CAN YOU KEEP UP source ink; fabric and custom numbers remain excluded. Both headlight origin and beam aim follow the final motorcycle pose. Sport uses both actual lamps while sharing the existing total light intensity.
6. Added clipped, gravity/inertia/damped hip-cap motion and a short non-graphic fall/slide. Immediate once-only settlement is separate from delayed results. Tutorial/restart guards, pause/blur/hidden freeze and reduced-motion output are covered. Initial aggregate bounds visibly floated the models; cached actual support vertices corrected final chassis/rider clearance to 2.5/3.5 cm. A cap-equipped rider falls onto the free side so the hanging cap stays above the road. Nine focused crash tests and the full three-case crash browser flow pass. Real cap/bag preview and wheelie/pause attachment checks pass; actual close-up and crash frames inspected.
7. Removed transition hills that intruded 1.8 m onto asphalt. Continuous berms stay outside ±7.23; a connected mountain with ridge Y17.5 surrounds each tunnel span, with an open mouth clearing the existing portal. Added muted rock layers/facet tones, sidewalk grates and reflector faces. Actual triangle tests cover nine environments, both tunnel styles/qualities and cell continuity. Normal/low moving-camera approach, entry, interior and exit checks pass; final views inspected. World RNG, lanes, bounded pools and update behavior remain unchanged.

## Preserved

One immutable adult skeleton on all four vehicles, fixed-length IK, accepted Racing sleeve reflection and source artwork, real loaded Merriweather oldstyle proportional numbers (23/32/37), explicit Equip and temporary preview, schema-1 save compatibility, deterministic fixed-step gameplay, higher controlled wheelie-angle scoring, S/Down/mobile controls, one lane change while genuinely airborne, service boundaries, Windows polling and disabled HMR.

All 17 authoritative images and hashes remain in `docs/references/current-target/manifest.json`. Analysis is in `REFERENCE-TARGET.md`; implementation/validation details are in `COMPLETION-2026-09-15.md`. No user sign-off or photographic equivalence is implied by internal visual checks.

## Final validation / release

Final source: typecheck PASS, lint PASS, all 247 unit tests PASS, production build PASS. Complete production browser suite: all 37 cases PASS in 15.1 minutes against http://127.0.0.1:5190/, no failures or skips. Three.js retains its nonblocking chunk-size advisory. Focused final crash/terrain browser run: 5/5 PASS; final rock-surface terrain rerun: 2/2 PASS. Fresh Garage, garment-number, cap, crash, tunnel, construction, open-road and bridge images were inspected.

No required implementation or local test items remain. Release follows this committed record: push existing GitHub `main`, await exact-commit Vercel success, and verify live menu/Garage/gameplay/assets/console at https://pfusch-game.vercel.app/. The final task report records the exact released commit and live verification. Do not create another repository, branch or Vercel project.

Viewport/touch emulation uses Edge; physical iOS/Android device testing is not claimed. Evidence and generated QA reports are retained in ignored `outputs/`.

Latest actual usage read: 44% used / 56% remaining. No reset/credit used; the <=5% checkpoint rule is not active. Continue through the existing release workflow.

Changed-file manifest: `CURRENT-CHANGED-FILES.txt`, cumulative from `71654c7`.
