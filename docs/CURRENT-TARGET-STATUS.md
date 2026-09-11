# Current target checkpoint — 11 September 2026

This remains a partial checkpoint of the full requested target. The authoritative brief is `C:/Users/dario/.codex/attachments/9fe43898-1d4b-462e-872b-323d835aefc8/pasted-text.txt`. The goal stays active; do not treat a runnable checkpoint as full completion.

## Completed visual repairs, retained from c1f31cc

- Töffli front axle moved forward 120 mm with wheel and fender together. Correct rake, existing tire size and concentric clearance retained.
- Sport: true 17-inch rims, independent 120/70 front and 190/55 rear tire profiles, 1441 mm axle spacing, corrected fork/wheel placement and shorter concentric fender. Upper nose and side fairings share a curved boundary; distinct lower panel, belly pan and radiator. BMW internet references and dimensions: `SPORT-REFERENCE-AUDIT.md`.
- Full-face helmet: fuller rear, reduced visor recess, shared 6.5% scale increase and slight downward orientation across all bikes.
- Clothing: localized directional folds at armpit/hip/elbow/cuff, less inflated sleeve starts, loose short sleeves and thin layered hems over a concealed waistband. No body dimension changes.
- Racing Zipper: exact supplied `tribal-racing.png`, SHA-256 `1700D3D4773351D7B789DD93C7B41FE8D148CD82B77C975E99595D9B3D10D9AE`. Integrated into mirrored outer-sleeve UVs. The user identified the previous lengthwise orientation as upside down; corrected both sleeves by 180 degrees so the pointed tribal end faces the cuff and the checker faces the elbow. Curved sleeves, no floating artwork planes.
- Preserved: one immutable adult skeleton, fixed-length IK, real Merriweather oldstyle 23/32/37, integrated torso artwork, persistent Garage, free locked preview and explicit Equip, no registration plates.

## New mechanical and accessory work

- Supermoto road tires now use shaped 17-inch profiles, 120 mm front / 160 mm rear. Raked fork and guards align with the front axle; rear swingarm sections follow the rear wheel center.
- Supermoto single 310 mm front disc and 220 mm rear disc have perforated annular geometry and stationary calipers. Sport retains twin 320 mm front / smaller rear discs. Removed duplicate solid Supermoto front discs.
- Both motorcycles have a left-side drive with front/rear toothed sprockets, carrier/hub, external tangent chain runs and links around the sprockets. Chain instances are bounded and do not allocate per frame. A geometric regression checks tangency, closure and sprocket clearance.
- All three caps retain the original hip location, with curved crown/brim directed rearward, sideways and down. Actual source artwork is integrated in their curved materials. The grey P-Zero variant uses its source charcoal grey.
- Bag sits rearward against the torso/hip, with front and rear strap routing and its actual source graphic.

## New balance gameplay

- Removed timed lift, cooldown, heat/lock behavior, vertical-swipe launch and arbitrary launching ramps, including their renderer template.
- S / Down and the mobile wheelie button apply throttle/rearward weight. W / Up and the new hold-forward button shift forward to lower the front or recover.
- Explicit angle, angular velocity, input loads, bike-specific torque, unstable balance point, gravity, damping and speed response. Töffli raises slowly, Supermoto has a broader balance region, Sport raises aggressively.
- Holding throttle can overrotate and crash. Forward correction and neutral release recover. The HUD shows the actual angle and balance-point marker, with updated tutorial/settings/pause hints.
- Bonus scoring depends on balance accuracy, angular steadiness, duration, speed and risk. Sustained active input builds combos; holding throttle is not a perfect automatic wheelie.
- Fixed-length rider IK responds to rearward/forward inputs, steering and front-wheel touchdown without rebuilding meshes. Pause freezes simulation/pose and releases both controls.
- Normal lane changes remain available with a rear wheel on the road. The one-air-lane allowance remains tested through an external physical-flight fixture, including boundary input and landing reset. There is currently no gameplay event that launches the motorcycle. Legacy `jumps` save fields remain for schema-1 compatibility and stay zero in current gameplay.
- Existing low striped road edges require actual front clearance; cars/vans require avoidance.

## Audio: implemented, audible acceptance still partial

Three procedural WebAudio voices use different combustion pulse rates, harmonic envelopes, mechanical partials and intake noise: tuned 50cc two-stroke, four-stroke single, and 1000cc inline-four. Ride selects its actual equipped bike. RPM/load responds to speed, rearward throttle and forward input; pause/mute silences output.

The browser captures actual output, verifies nonzero audio at the combustion frequency, throttle response, distinct firing rates and pause silence. Near the initial running speed, measured fundamentals are approximately 108 Hz, 57 Hz and 299 Hz. Recordings: `outputs/engine-125.webm`, `engine-450.webm`, `engine-701.webm`; measurements: `outputs/engine-audio-qa.json`.

The current model/tool session cannot listen to returned audio input, so a human audible realism comparison is **not claimed**. A restrained reflection bus exists but is not connected to a real tunnel environment yet. Tunnel acoustics remain unverified.

## Visual and interaction evidence

Garage: all bikes side/front/front-three-quarter/rear-three-quarter; all nine garments front/back; Racing Zipper and Keep Up tee/hoodie additional side/front/rear-three-quarter. All caps and bag inspected from side/front-three-quarter/rear-three-quarter with real product photos and unchanged saved equipment.

Current evidence includes `outputs/final-*-*.png`, `garment-*.png`, `accessory-*.png`, `rider-wheelie-side.png`, `rider-lane-response.png`, and `balance-mobile.png`. Actual running browser verifies S and Down, W and Up correction, mobile hold/release, no Space/vertical-swipe launch, lane controls and pause. Touch QA uses Edge emulation, not physical iOS/Android devices.

## Exact remaining work, in priority order

1. Clothing construction remains partial: source-derived washed fabric, finer shoulder seams, hoodie/jacket pockets, cuffs and final waist layering through more poses. Preserve sleeve artwork and skeleton.
2. Finish close mechanical visual acceptance of Supermoto frame/shock/chain/brakes and Sport tank/cockpit/fairing detail; preserve corrected dimensions, axle positions and short fender.
3. Audible realism acceptance of all three engine voices; later verify tunnel identity.
4. Further riding pose/skill-feel QA at sustained balance, active forward correction and overrotation on all three bikes.
5. Motorcycle-specific potholes/rough surfaces/roadwork/wet or gravel events and optional risk lines, with readable viable paths and sufficient reaction time.
6. Replace repeating rendered road with a bounded, deterministic-seed authored segment generator. Normal runs must compose different logical sequences; environment-dependent traffic.
7. Actual tunnels: entrance, roof, walls, lights, exit and unpredictable 5–60 second lengths. Current renderer still has repeating buildings/overhead structures, not this system.
8. Continuous bridges over water, visible water on both sides, rails/body and land transitions.
9. Day, golden hour, night and dawn variation; restrained tunnel audio connected to actual environment state.
10. Subtle blue emissive mask from real ink only on exact Keep Up tee/hoodie/zipper in dark environments; daylight remains true to source. No floating planes.
11. Remove unrelated global slogan uses: menu heading, road sign, final rank label, ranking kicker, browser title/description, Sites metadata and historical generic documentation. Product-specific catalog names/artwork/tests stay. Branding cleanup is not yet complete.
12. Full visual/world/gameplay/audio QA, commands and owner-private publication after the remaining systems. Optional chase events only after required core is stable.
13. **Added by the user on 11 September, at the bottom of the list:** a motocross helmet option and helmet color selection. Preserve immutable head scale, temporary preview and explicit Equip. Not yet implemented.

## Validation state

Typecheck, lint, 44 unit tests in eight files and production build pass for the new balance implementation. The four targeted browser cases for audio, keyboard, mobile balance and rider motion passed, followed by all 14 cases in the complete browser regression (6.4 minutes). After the user's sleeve-orientation correction, typecheck/lint/44 unit tests/build passed again; the garment browser regression passed for all nine tops and added an opposite-side Racing Zipper view. Both sleeves were visually checked after the 180-degree correction. Preview remains `http://127.0.0.1:5190`. Preserve polling watcher/HMR settings.

This validated source is ready for owner-private publication. The Windows Sites build helper has an established npm-shim issue; the project command `npm run build` succeeds. Packaging uses the supplied Sites helper via Git Bash with /c paths.

Changed-file manifest: `CURRENT-CHANGED-FILES.txt`. Earlier visual evidence is retained in `SPORT-REFERENCE-AUDIT.md` and prior checkpoint documentation.
