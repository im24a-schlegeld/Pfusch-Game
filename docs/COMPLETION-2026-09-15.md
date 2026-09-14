# PFUSCH reference correction pass — 15 September 2026

This report covers the reference correction goal following the 14 September release. It preserves the user's 17 reference images and subsequent corrections, including the explicit clarification that the rejected helmet part was the upper motocross peak.

## Implemented

- Connected motorcycle supports, steering, engines, exhausts, brakes and rearsets. Improved the garment front, shoulder drape and seated waist transition, reduced inflation and retained the visible bottom hem.
- Enlarged Supermoto and Sport chassis around the identical adult rider. Improved rims and tire proportions, shortened the Supermoto seat while retaining its longer tail, tucked its supported silencer under the side cover, and removed mirrors. Replaced the Sport front completely, then refined its pointed nose, smoke screen, rounded tank, rearward fender wrap and concealed subframe mounts.
- Added Roller between Töffli and Supermoto, with its own small-wheel chassis, open floorboard, closed CVT, sound, progression and temporary preview/explicit Equip flow. Rebuilt its pointed front against the user's selected gray Yamaha reference.
- Rebuilt the motocross helmet with a genuine eye aperture, projecting chin, separate goggles and broad strap. Replaced its rejected upper plate with a narrower sculpted peak, supported sides, tapered perimeter, relief openings and a restrained ridge. The full-face helmet retains its previous geometry.
- Increased blue emission only on actual CAN YOU KEEP UP printed ink. Headlight source and aim now follow the final motorcycle pose, including wheelies and crashes; Sport uses both actual lamps.
- Added a clipped hip cap with bounded gravity, inertia and damping. Added a short fall/slide and reduced-motion alternative, with accurate visible ground support. Settlement remains immediate and once-only; results follow the animation. Tutorial, pause, blur, visibility and restart are covered.
- Replaced terrain intruding onto asphalt with connected outside berms. Enclosed tunnels in a mountain with open fitted portals and matching approach/exit terrain. Added limited drainage and reflector detail through existing bounded pools.

## Preserved

One immutable skeleton and fixed-length IK on all four vehicles; accepted sleeve artwork orientation; real source product imagery and colors; loaded Merriweather oldstyle proportional numbers, including 23/32/37; inboard motorcycle chains and Töffli belt; deterministic fixed-step gameplay; controlled higher-angle scoring; S/Down and mobile wheelie controls; one lane switch while genuinely airborne; schema-1 saves; free preview with explicit Equip; service boundaries; polling file watching and the existing HMR preference.

## Validation record

The final source passes all 247 unit tests, typecheck, lint and production build. The complete final production browser suite passed all 37 cases in 15.1 minutes, with no failed or skipped cases. This covers all four bikes, clothing and real artwork, Merriweather 23/32/37 on actual garment textures, preview/Equip/persistence, keyboard and touch controls, sound and lighting, cap motion, crash/settlement/restart and generated world sections. Earlier focused cap/crash/terrain checks and the final rock-surface checks also passed.

Visual inspection includes actual Garage front/side/rear/three-quarter views, the helmet peak from above, cap attachment during a real wheelie, crash sequence frames and production-camera tunnel approach/interior/exit. Diagnostics that seek to generated terrain segments are explicitly separate from the normal gameplay smoke tests. Screenshots and measurements are retained under ignored `outputs/`.

Acceptance limits: desktop Edge and touch/viewport emulation were used; physical iOS/Android playtesting is not claimed. The stylized models are reference-informed, not factory CAD or photographic replicas. The existing Three.js chunk-size advisory is nonblocking.

## Release

No required implementation or local validation items remain. This report is recorded immediately before release to the existing GitHub repository `im24a-schlegeld/Pfusch-Game`, branch `main`, and existing Vercel project `pfusch-game`. The final task report records the pushed commit, exact-commit deployment status and live verification at https://pfusch-game.vercel.app/. No second repository, branch or Vercel project is needed.

Changed-file manifest: [CURRENT-CHANGED-FILES.txt](CURRENT-CHANGED-FILES.txt), cumulative from `71654c73ef56777580b7606aebf215fd672906ca`.
