# PFUSCH current target — 14 September 2026

The required implementation is complete. Final browser validation and publication are in progress; do not claim a completed deployment until the checks below have passed.

Authoritative scope: `C:/Users/dario/.codex/attachments/9fe43898-1d4b-462e-872b-323d835aefc8/pasted-text.txt`, with the control/clothing/animation block in `C:/Users/dario/.codex/attachments/a9eab8c1-d200-47f9-9f26-ab97f25bf53c/pasted-text.txt` inserted first. Later user corrections, drivetrain/scoring additions, helmet options and the existing GitHub/Vercel deployment instruction are included. Earlier checkpoint details remain in Git history and the linked audit documents.

## Completed implementation

- Mobile: one large captured-pointer weight control. Hold to raise; slide continuously through partial throttle and neutral into forward correction. A second thumb can steer or pause. Release, cancel, blur and pause clear controls. Keyboard S/Down raises, W/Up corrects; Space and vertical swipes do not launch a jump.
- Wheelie: finite bike-specific initial tug, unstable balance and overrotation, forward recovery and controlled-angle scoring. A farther rearward controlled angle earns progressively more points; rapid runaway rotation does not. Genuine physical airborne states retain one accepted lane switch and reset on landing; no generic gameplay jump or launching ramps remain.
- Rider: one immutable adult skeleton and fixed-length arm/leg IK on all three bikes. Motion covers launch, balance, forward load, steering, road response and front return. Telescoping suspension preserves the physics-driven wheel centers and ground contacts.
- Clothing: natural draped shoulder/torso, garment-specific sleeves, localized folds, thin inward-fold hem over concealed waistband and looser lower trouser legs. The unjustified upper sleeve loop is removed. Source-derived fabric wash, surface-fitted hoodie/zipper pockets, windbreaker panel/welt-pocket seams and subtle ribbed cuffs/hems are integrated.
- Racing sleeve: exact supplied `tribal-racing.png` (SHA256 `1700D3D4773351D7B789DD93C7B41FE8D148CD82B77C975E99595D9B3D10D9AE`). Accepted horizontal-axis reflection is preserved on both curved sleeve UVs. No hovering graphic plane.
- Numbers: real loaded Merriweather oldstyle proportional numerals remain integrated into the 3D garment texture. The browser verifies 23/32/37 and the deeper descender of 3 against 2.
- Helmet: preserved fuller rear, shared 6.5% scale correction, slight downward orientation and shallow convex visor (2.5mm center crown; no inward dent). Added a motocross option with projecting chin, curved peak and goggle strap, using the same head scale. Four stock colors are free to preview. Only EQUIP HELMET saves these two fields; additive schema-1 migration retains old saves and the original stock appearance.
- Töffli: accepted 120mm-forward front axle/fender and fork rake remain. Two smooth V-groove pulleys and a closed rubber belt replace chain hardware; thin belt guard and adjusted left stay/casing leave clearance.
- Supermoto/Sport: chain sits between the rear tire and left swingarm, with aligned sprockets, carrier and axle. Actual assembled meshes verify clearance. Supermoto retains shaped 17-inch road tires, perforated rotors, stationary calipers, frame/cradle/shock and one exhaust. Sport retains 1441mm wheelbase, independent 120/70 and 190/55 tire profiles, twin front discs and short concentric fender. Localized cowl/windscreen curvature and separate lower-fairing/belly structure replace the flatter front and broad lower slab. Reference detail: `SPORT-REFERENCE-AUDIT.md`.
- Caps/bag: source artwork on curved materials, accepted rearward/downward hip cap orientation and rearward bag/strap attachment. No registration plates.
- Road events: readable potholes, raised steel edges, rough asphalt, gravel and wet patches with motorcycle-specific response. Forward control helps roughness/slip recovery. Optional offset-vehicle risk lines award near misses while preserving a clear alternative. No road event introduces a generic launch.
- World: separately seeded authored city, industrial, construction, open, waterfront, tunnel and bridge sequences; logical approaches/exits and traffic selected for the actual upcoming environment. Exact capped-speed integration defines continuously variable 5–60 second tunnels. World descriptors and GPU batches stay bounded; render geometry clips to exact segment boundaries.
- Tunnels/bridges: actual vaulted roof, walls, portals, fixtures and two finishes; continuous bridge deck/body/rails over water, with land transitions and multiple structural variants. A waterfront clipping gap discovered during review was repaired.
- Lighting: distance-driven day, golden, night and dawn palettes blend across segment boundaries. Real tunnel exposure drives lighting and restrained audio reflections. Headlight/near-rider fill preserve road readability.
- Audio: distinct procedural tuned 50cc two-stroke, four-stroke single and high-revving inline-four combustion/harmonic/noise voices. Actual output tests cover firing identity, throttle, pause silence and tunnel reflection while preserving firing frequency at equal speed/load.
- Keep Up: only product IDs 10237102096713 (zipper), 10237099737417 (tee) and 10237061759305 (hoodie) receive an ink-only blue emission map made from their actual source artwork at the exact diffuse placement. Washed fabric and custom numbers are excluded; daylight intensity is zero and full darkness is restrained at 0.22.
- Branding: neutral PFUSCH game branding retained. Remaining Keep Up matches are the three products' names, catalog descriptions, artwork metadata, product-specific implementation/tests and their audit documentation. No generic menu/HUD/challenge/road-sign slogan.
- Preserved: source imagery/catalog identities, free locked preview, explicit Equip, save version 1, cumulative XP, idempotent run settlement, bounded traffic, polling watcher and disabled HMR.

## Validation and evidence

Typecheck, lint, all 124 unit tests in 14 files and production build passed on 14 September. The long ten-hour world test has an explicit 15-second budget for its roughly 200,000 assertions; its checks are retained.

Passing targeted browser checks include all-bike mechanical/visor inspection, animated rider contacts and pause freeze, and actual city/industrial/construction/open/waterfront/tunnel/bridge/night rendering. New environment-effect and helmet cases are being finalized before a single complete browser-suite run.

Visual evidence in ignored `outputs/`: `close-*` bike side/front/front-three-quarter/rear-three-quarter/opposite-side views; `world-*` environment views; `garment-*` all nine tops and Racing sleeves; cap/bag views; 23/32/37 number textures; four responsive control/feedback sizes (320×568, 390×844, 820×1180, 667×360); wheelie/lane-response and suspension captures. Inspect actual images, not HTTP status alone.

Limits of acceptance: mobile checks use Edge touch/viewport emulation, not physical iOS/Android hardware. Audio output and identity are measured and recorded; a subjective human listening comparison is not claimed. The optional chase event was not required and was not added.

## Remaining release steps

1. Finish helmet/environment browser checks and inspect their images; repair any regression.
2. Run the complete browser suite on the final production build, plus final typecheck/lint/unit/build validation as needed after fixes.
3. Confirm production preview at `http://127.0.0.1:5190/` and inspect Git status.
4. Commit only intended project changes and push existing `main` to `https://github.com/im24a-schlegeld/Pfusch-Game.git`.
5. Wait for the existing `dario-schlegels-projects/pfusch-game` Vercel integration to report success for the exact pushed commit.
6. Verify `https://pfusch-game.vercel.app/`: newest bundle/options, menu, Garage, gameplay, assets and console. Report full commit hash, branch, push/deployment result and live URL.

The latest actual usage check showed 99% remaining in the primary window and 51% weekly. The <=5% checkpoint rule has not triggered. No usage reset was redeemed. Continue the existing goal through release without creating another repository, branch or Vercel project.

Changed-file manifest: `CURRENT-CHANGED-FILES.txt` (refresh after final edits).
