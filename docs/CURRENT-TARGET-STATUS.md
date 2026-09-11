# Current target checkpoint — 11 September 2026

This remains a partial checkpoint of the full requested target. The authoritative brief is `C:/Users/dario/.codex/attachments/9fe43898-1d4b-462e-872b-323d835aefc8/pasted-text.txt`. The goal stays active; do not treat a runnable checkpoint as full completion.

## New highest priorities — user instruction, 11 September

The additional brief `C:/Users/dario/.codex/attachments/a9eab8c1-d200-47f9-9f26-ab97f25bf53c/pasted-text.txt` is inserted ABOVE the existing work, without replacing it. Required order: (1) easier mobile controls and continuous wheelie input, (2) stronger initial pull-up then existing balance, (3) clean layered top/pants transition, (4) remove unjustified sleeve line, (5) baggier lower-leg pants, (6) relocate feedback beside HUD rather than the scene center, (7) motion for start/balance/forward correction/steering/load/landing/road, (8) desktop and multiple mobile viewport visual QA, (9) tests/build, then remaining previous target. Preserve accepted sleeve reflection, shallow visor, all fixed bone lengths and validated features.

New-priority progress: the mobile buttons are now one connected, larger captured-pointer control. Holding raises; sliding up continuously reduces throttle, crosses neutral and applies forward correction; sliding down increases rearward input. Release/cancel/pause returns touch input to zero. Keyboard input remains independent, and an unrelated canceled swipe no longer releases held controls. Native Edge touch tests cover 320×568, 390×844, 820×1180 and 667×360, half-throttle, neutral, forward correction, a simultaneous second-thumb lane change and cancellation. All four layouts were visually inspected. These are emulated viewports, not physical-device acceptance.

The initial lift now adds one rapidly decaying, bike-specific torque pulse from the grounded pose; angular velocity remains continuous and the existing unstable balance simulation takes over. Unit coverage proves identical keyboard/touch response, a finite early rise, no re-trigger from pumping during an existing wheelie, recovery and overrotation across all three bikes. Further dedicated rider/suspension start animation belongs to the still-open animation step.

**Resume next:** finish final browser validation of this new input/pull checkpoint, then the requested top-to-pants cleanup → unjustified sleeve-line removal → baggier lower legs → feedback placement → expanded motion, in that exact order. These clothing/UI/animation corrections have NOT been implemented in this new pass. Afterwards continue the existing target below without reordering it. The last visible quota read reported primary 32% consumed and weekly 100% consumed; no reset was redeemed. The user subsequently clarified that 68% remains and instructed normal continuation. Do not stop early to deploy based on the earlier interpretation of the weekly display.

## Final deployment instruction — latest user instruction

When the FULL active target is complete, run typecheck, lint, full unit tests, full browser tests and production build, then verify local production preview. Inspect git status, commit all intended changes and push the existing GitHub deployment branch: current checkout `main`, origin `https://github.com/im24a-schlegeld/Pfusch-Game.git`. Update the existing Vercel project for `https://pfusch-game.vercel.app/`; do not create a new repository, branch or Vercel project. Verify the actual live app, Garage, ride, assets and console, and report commit/branch/push/deployment/live URL. The final requested deployment provider is now Vercel, superseding the earlier Sites publication route. Do not claim this final release is complete while the goal is partial. Continue automatically until the goal is complete or remaining capacity is too low to work safely.

The user also authorizes the same commit → existing GitHub branch → existing Vercel → live verification sequence for a stable partial checkpoint when actual remaining usable capacity is known to be 5% or below, then stop. Above 5%, continue the existing priorities. GitHub authentication is available for `im24a-schlegeld`; the existing Vercel Git integration reports successful deployment of the prior `main` commit to project `dario-schlegels-projects/pfusch-game`. No new remote, branch or Vercel project is needed.

## Completed visual repairs, retained from c1f31cc

- Töffli front axle moved forward 120 mm with wheel and fender together. Correct rake, existing tire size and concentric clearance retained.
- Sport: true 17-inch rims, independent 120/70 front and 190/55 rear tire profiles, 1441 mm axle spacing, corrected fork/wheel placement and shorter concentric fender. Upper nose and side fairings share a curved boundary; distinct lower panel, belly pan and radiator. BMW internet references and dimensions: `SPORT-REFERENCE-AUDIT.md`.
- Full-face helmet: fuller rear, shared 6.5% scale increase and slight downward orientation across all bikes. The visor now uses a separate shallow convex section instead of inheriting the inward-dipping shell profile. Its center sits only 2.5 mm outside the chord between its edges. The actual rendered mesh is checked for no inward dip and less than 3 mm outward crown on all three bikes.
- Clothing: localized directional folds at armpit/hip/elbow/cuff, less inflated sleeve starts, loose short sleeves and thin layered hems over a concealed waistband. No body dimension changes.
- Racing Zipper: exact supplied `tribal-racing.png`, SHA-256 `1700D3D4773351D7B789DD93C7B41FE8D148CD82B77C975E99595D9B3D10D9AE`. Integrated into mirrored outer-sleeve UVs. The user clarified that the required correction is reflection about the source artwork's horizontal axis (top/bottom swap), not a 180-degree turn. Restored the original lengthwise placement and applied that reflection to both sleeves. Curved sleeves, no floating artwork planes.
- Preserved: one immutable adult skeleton, fixed-length IK, real Merriweather oldstyle 23/32/37, integrated torso artwork, persistent Garage, free locked preview and explicit Equip, no registration plates.

## New mechanical and accessory work

- Supermoto road tires now use shaped 17-inch profiles, 120 mm front / 160 mm rear. Raked fork and guards align with the front axle; rear swingarm sections follow the rear wheel center.
- Supermoto single 310 mm front disc and 220 mm rear disc have perforated annular geometry and stationary calipers. Sport retains twin 320 mm front / smaller rear discs. Removed duplicate solid Supermoto front discs.
- Both motorcycles have a left-side drive with front/rear toothed sprockets, carrier/hub, external tangent chain runs and links around the sprockets. Chain instances are bounded and do not allocate per frame. A geometric regression checks tangency, closure and sprocket clearance.
- All three caps retain the original hip location, with curved crown/brim directed rearward, sideways and down. Actual source artwork is integrated in their curved materials. The grey P-Zero variant uses its source charcoal grey.
- Bag sits rearward against the torso/hip, with front and rear strap routing and its actual source graphic.
- Hoodies now have surface-fitted kangaroo pockets; Racing/Keep Up Zippers have split pockets. Pocket vertices and UVs are sampled directly from the draped torso, preserving the original material. Subtle opening/stitch edges and dropped-shoulder/sleeve-hem seams follow the existing skinned sleeves. Garment and motion browser checks pass.
- Fabric now uses unprinted samples from each selected product color's actual front photograph. Mirrored sample edges tile continuously; bounded luminance variation preserves the catalog base color. Wash is stronger on the Signs Hoodie and zippers, restrained on plain hoodies and the windbreaker. Torso, sleeves, hood and hem share the source-derived material; original print and number composition is applied afterward. Visually checked all nine tops front/back, both Racing sleeves, Signs wash and the 23/32/37 number textures. All catalog color previews also pass without console errors.

## Branding correction

The menu heading and road sign now read PFUSCH, the final rank is STREET LEGEND, and the ranking kicker is LOCAL LEADERBOARD. Browser title and Sites title are PFUSCH Street Run; generic metadata no longer contains a clothing slogan. The historical catalog brand paragraph was corrected too. Remaining phrase matches are actual product names/descriptions/artwork metadata in `public/catalog/products.json` and `garment-textures.json`, plus product-specific research/QA descriptions in `CATALOG.md`, `GARMENT-VISUAL-REVIEW.md`, `COMPLETION-PASS.md` and this checkpoint. Product-specific nighttime treatment remains open below.

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

1. Clothing construction remains partial: windbreaker pocket seams, ribbed cuff/hem material and final waist layering through more poses. Source-derived washed fabric, kangaroo/split pockets and shoulder/sleeve seams are implemented and visually checked. Preserve sleeve artwork and skeleton.
2. Finish close mechanical visual acceptance of Supermoto frame/shock/chain/brakes and Sport tank/cockpit/fairing detail; preserve corrected dimensions, axle positions and short fender.
3. Audible realism acceptance of all three engine voices; later verify tunnel identity.
4. Further riding pose/skill-feel QA at sustained balance, active forward correction and overrotation on all three bikes.
5. Motorcycle-specific potholes/rough surfaces/roadwork/wet or gravel events and optional risk lines, with readable viable paths and sufficient reaction time.
6. Replace repeating rendered road with a bounded, deterministic-seed authored segment generator. Normal runs must compose different logical sequences; environment-dependent traffic.
7. Actual tunnels: entrance, roof, walls, lights, exit and unpredictable 5–60 second lengths. Current renderer still has repeating buildings/overhead structures, not this system.
8. Continuous bridges over water, visible water on both sides, rails/body and land transitions.
9. Day, golden hour, night and dawn variation; restrained tunnel audio connected to actual environment state.
10. Subtle blue emissive mask from real ink only on exact Keep Up tee/hoodie/zipper in dark environments; daylight remains true to source. No floating planes.
11. Global branding cleanup is complete; retain it during future work. Product-specific names, artwork, catalog data and their QA documentation remain legitimate.
12. Full visual/world/gameplay/audio QA, commands and owner-private publication after the remaining systems. Optional chase events only after required core is stable.
13. **Added by the user on 11 September, at the bottom of the list:** a motocross helmet option and helmet color selection. Preserve immutable head scale, temporary preview and explicit Equip. Not yet implemented.

## Validation state

Typecheck, lint, 44 unit tests in eight files and production build pass for the new balance implementation. The four targeted browser cases for audio, keyboard, mobile balance and rider motion passed, followed by all 14 cases in the complete browser regression (6.4 minutes). After the final horizontal-axis sleeve reflection, build/typecheck and lint passed. The garment browser regression passed for all nine tops, including an opposite-side Racing Zipper view; both arms were visually checked. Its first run encountered connection refusals during a local preview restart; the fresh run passed without console errors. Preview remains `http://127.0.0.1:5190`. Preserve polling watcher/HMR settings.

This validated source is ready for owner-private publication. The Windows Sites build helper has an established npm-shim issue; the project command `npm run build` succeeds. Packaging uses the supplied Sites helper via Git Bash with /c paths.

Following the pocket/seam and shallow-visor changes: typecheck, lint, 44 unit tests and build passed. The garment, all-bike inspection (including measured visor convexity) and rider-motion browser cases passed together (2.1 minutes). Viewed hoodie and zipper fronts, tee shoulder/cuff side and helmet side/front-three-quarter; the earlier full 14-case regression remains the broader gameplay checkpoint.

Final stabilization checkpoint: source-derived fabric passes the four garment, font and preview cases (2.6 minutes), including every catalog color preview. After the neutral-branding correction, typecheck, lint, all 44 unit tests and the production build pass again; the other ten browser cases pass (3.0 minutes), covering accessories, actual WebAudio output, keyboard/mobile controls, all-bike visor inspection, animated rider contacts, narrow screens, pause, crash/rewards, restart and persistence. Thus all 14 browser cases have passed for the final changes in two targeted batches. No blocking runtime errors were observed. The build retains its existing non-blocking Three.js chunk-size warning. Source and output are ready for private publication; no new world features were started during this stabilization phase.

Changed-file manifest: `CURRENT-CHANGED-FILES.txt`. Earlier visual evidence is retained in `SPORT-REFERENCE-AUDIT.md` and prior checkpoint documentation.
