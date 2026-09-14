# PFUSCH reference correction target

This is the new target requested after the previous release. The previous completion report describes that earlier target and is retained as history; it does not establish acceptance of these new corrections. The user explicitly rejected the current Supermoto, Sport and motocross-helmet appearance. Existing tests passing must not be used to dismiss those defects.

## Reference preservation and authority

All 17 images from the latest user message have been copied without resizing, cropping, recompression or other editing into [`references/current-target/`](references/current-target/). The copy SHA256 is verified against each original. [`manifest.json`](references/current-target/manifest.json) records the complete original absolute path, retained filename, description, byte size and SHA256. Images 01–03 are defect crops, not desired reference shapes. Images 04–17 specify the desired model forms. Their brand marks and unrelated clothing prints are visual context, not instructions to replace real PFUSCH artwork.

The table at the end maps every source image in original order. These supplied images are the visual authority for this target; the earlier BMW Sport reference is not the current Sport styling target. Perspective photographs alone do not justify an exact measured millimetre dimension.

## Required order and visual acceptance

1. **Connections, mechanics and garment fit.** Repair the Töffli fork/headstock/handlebar connection visible in 01. Joined parts must have an understandable physical support, axle or mounting bracket; avoid isolated floating rods and arbitrary overlapping surfaces. Inspect engine mounts, exhaust/header connection, rear shock endpoints, swingarm pivots, chain/belt alignment, controls and fenders from both sides. Add restrained recognizable engine structure rather than detail distributed randomly over a smooth lump. Correct 02–03: pelvis, thighs and saddle should form a continuous seated silhouette; the rear shirt must fall over the trouser waist without hovering, exposing an abrupt gap or clipping through the saddle. Reduce inflated chest/abdomen and upper-arm cloth volume while keeping relaxed fabric ease, natural shoulder drape and folds. Improve the front opening/pocket/hem placement on the actual garment surfaces. Keep the immutable skeleton, limb lengths and accepted graphics.
2. **Supermoto and Sport.** Rebuild the visible form to match 04–08 as described below. Compare actual Garage side, front, rear and both three-quarter views. A mechanically legal model with the wrong massing is not accepted. Preserve the inboard chain layout and Töffli belt.
3. **Scooter.** Add a distinct sporty step-through scooter derived from 09–11, listed between Töffli and Supermoto. The same adult rider sits upright, with feet on the floorboard, hands on the bar targets and fixed-length IK. Include free temporary preview, explicit Equip, progression and playable handling; old schema-1 saves and existing bike IDs keep working. The scooter must visibly have its own floorboard, leg shield, handlebar nacelle, under-seat body/engine and small wheels, not simply a reskinned motorcycle.
4. **Motocross helmet and goggles.** Rebuild against 12–17, retaining the common head scale and color controls. The open eye aperture, angular side shell, projecting tapered chin guard, shaped peak, separate fitted goggle frame/lens and broad strap must all read clearly at Garage scale. The full-face option remains separate and working.
5. **Glow and headlight.** Increase blue color and visible glow on the actual CAN YOU KEEP UP source ink in darkness. Keep fabric and custom numbers excluded. Daytime artwork remains legible and unchanged. Headlight emitter position and beam target must both derive from the bike pose, so the beam rises with the headlight during a wheelie rather than remaining fixed on the road. Check grounded, lifting, held wheelie and return in a tunnel/night section.
6. **Cap and crash.** Attach the hip cap to a visible attachment point; it should hang under gravity with limited inertial swing and damping as the rider accelerates, leans and lands. Avoid a rigid horizontal shelf or free-floating rotation. Add a readable non-graphic loss-of-balance/impact animation, preserving pause/blur, restart and once-only settlement. Check each vehicle and mobile play.
7. **Map.** Keep roadside sand/terrain outside the drivable asphalt throughout generated sections, including transitions and bridge/tunnel approaches. Add coherent limited roadside detail with bounded object counts. The user's additional tunnel correction is required: place a visible mountain/terrain mass around the visible tunnel portion, so approach, entrance, tunnel course and exit have geographic continuity; a freestanding tunnel dropped randomly onto flat terrain is not accepted. Keep that terrain outside the road clearance and connect portals to the surrounding slope without exposing shell gaps. Inspect several seeded sections in actual moving gameplay, including daylight and darkness; do not accept screenshots that hide the road edge or tunnel context.

## Baseline audit and modeling plan

Source inspected: `app/game/vehicle.ts`, `app/game/sportGeometry.ts`, `app/game/riderSkeleton.ts`, and `app/game/worldView.ts`. Saved baseline renders inspected: `outputs/close-Supermoto-SIDE.png`, `outputs/close-Supermoto-FRONT-quarter.png`, `outputs/close-Sport-SIDE.png`, `outputs/close-Sport-FRONT-quarter.png` (13 September 2026), and `outputs/helmet-Sport-FRONT.png`, `outputs/helmet-Supermoto-SIDE.png` (14 September 2026). These are baseline evidence, not new-target completion evidence. New renders must be captured after edits.

### Supermoto: 04 and 05

The references share a compact, dense engine/radiator area, angular overlapping plastics, narrow continuous saddle and tail, long exposed fork tubes and an upswept compact exhaust. The Husqvarna and KTM differ in individual plastic outlines, so first capture those common proportions and then follow one coherent panel language. Both have plate-like hand guards with supporting bars; a thick rounded loop alone does not reproduce that form.

The baseline has an overly skeletal middle/rear section: broad bare triangular subframe gaps and a very exposed orange spring dominate, while the tiny radiators and simple symmetrical round crankcases leave the center empty. Its side shroud appears as a mostly flat triangular plate. The front view reads as a narrow tower with a rounded bar loop, rather than shaped number plate, shoulders, guards and fork clamps. A high seat is appropriate, but the tail/side-cover mass must connect the saddle and frame visually. The current engine already has crankcase discs, bolts and radiator ribs; their presence alone has not produced the reference's mechanical density.

Practical pass:

- Establish a single connected tank/airbox/seat/tail silhouette using the current wheel contact geometry as a starting datum. Fill the appropriate under-seat side-cover area without enclosing the whole open dirt-bike chassis.
- Shape radiator shrouds with a real upper shoulder, folded lower edge and recess around the radiator; connect their roots to tank/frame mounts. Give the side covers thickness and restrained seams.
- Replace the hand-guard rubber-loop appearance with thin formed shields on distinct braces; join fork top, triple clamps, steering stem and handlebar risers.
- Use an asymmetric crankcase/cylinder/head assembly with visible covers, mount points, hoses and a joined header. Keep polygon and draw-call growth bounded.
- Verify tire, fender and fork clearances from front and both side views, then recheck rider contact targets without altering anatomy.

### Sport: 06, 07 and 08

The Yamaha R1 references show a compact forward-pointing upper nose, a smoothly rising curved windscreen, angular shoulder/intake/light pockets, a distinct tank dome, a low rider-seat valley and a slender raised tail. The side fairing forms a tapering wrapper around the engine, not a vertical rectangular skirt. The rear swingarm is visually substantial around the axle and the tire sits centrally below the tail; the exhaust joins a visible collector/header path.

The baseline upper cowl is too broad, pale and bulbous: from the side it reads as a large blunt horizontal block; from three-quarter view the wide top slab visually merges the nose with the tank. The windscreen reads as a thin flat panel in the inspected view despite its source curvature. The current light and intake features are material regions on one surface, which cannot establish the recessed pockets visible in the R1 references. The lower fairing remains a large flat mass and conceals most engine structure. Source comments and dimensions in `sportGeometry.ts` explicitly derive from the earlier BMW S 1000 RR reference; retain useful tire construction but do not treat that old styling as accepted for this target.

Practical pass:

- Lay out a side silhouette anchored at the existing axle positions: nose tip, screen root/top, tank peak, seat valley and tail tip. Use reference-relative proportions first; do not stretch the rider or use unsupported photo measurements as exact dimensions.
- Replace the broad cowl slab with joined central nose, angular side cheeks and recessed intake/light pockets. Make seam continuity testable, with a supported screen root and finite screen thickness/edge.
- Separate tank shoulder from upper fairing with the intended cockpit gap and connected frame rails. Reshape the lower wrapper and belly to expose selective engine/collector relief rather than filling the entire silhouette.
- Give the rear swingarm a credible box-section volume, axle block and pivot. Keep chain clearance inside the left arm and avoid changing accepted drive alignment incidentally.
- Compare the wheel/tire apparent size, wheel-to-cowl spacing, short concentric front fender, seat-to-rear-wheel relationship and both sides at matched camera angles. Tune pose contact points only after bodywork and mechanical geometry agree.

### Scooter: 09, 10 and 11

Common features are a compact front wheel below a raked telescopic fork, tall sculpted leg shield with a recessed inner surface, open step-through space, low continuous floorboard, handlebar/headlamp nacelle, rising under-seat side body, long saddle and rear engine/transmission mass beside the small rear wheel. Reference 10 provides the clearest side silhouette; 09 and 11 resolve the front apron width, lamp/nacelle and angular outer body. Their color schemes differ; reproduce form rather than combining unrelated decals.

Build this as its own vehicle geometry branch with explicit dimensions and rider contacts. The floorboard must connect the front shield to the engine/seat body while leaving the step-through void open. Both feet need actual supported positions; ensure fixed-length IK reach before accepting targets. Represent the enclosed belt/transmission case and short supported exhaust appropriate to the visible scooter layout, rather than exposing a motorcycle chain. Add backward-compatible bike selection/progression entries and exhaust/audio identity deliberately rather than falling through existing 125/450/701 ternaries. Validate preview/discard/equip/persistence and the complete ride/reward loop.

### Motocross helmet: 12–17

The baseline motocross option is still fundamentally the full-face helmet. `makeHelmet` uses the same continuous rounded shell and visor material groups, modifies three front-depth samples, adds a thin peak and a round tube called `goggle-strap`. This is a structural mismatch: a material-colored visor region cannot be the references' deep open face aperture and separate goggles. The photos show angular temple/cheek surfaces, a taller face opening, protruding pointed chin, pronounced peak support/center ridge, and a wide flat textile strap entering separate goggle outriggers.

Practical pass:

- Preserve the underlying head bounds and common scale; construct a motocross-specific shell around that head with an actual front aperture. Keep front/rim/inner liner geometry separate from the lens.
- Shape the cheek-to-chin guard as connected angular planes tapering to a forward/downward vented point; do not merely swell the lower full-face profile.
- Give the peak a raised center ridge, concave underside, tapered leading edge and attached side pivots. Its front projection should follow 12–14 without becoming a flat shelf.
- Fit a separate goggle frame with brow arc, nose notch, peripheral seal and a shallow convex colored lens. The frame sits inside the aperture and in front of the face, without clipping shell edges.
- Build a broad strap following both sides and rear of the shell, connected to the goggle outriggers. Check worn proportions in 15 and 17 as well as the isolated product shots; do not enlarge the head to fit equipment.

## Completion evidence to collect

Each major modeling milestone needs new Garage front, side, rear and three-quarter captures at desktop and mobile dimensions, compared with the mapped references. Record failures honestly and keep the requirement open until corrected. Test source geometry invariants where useful, but visual acceptance remains mandatory. Preserve all prior save/control/number/graphic invariants.

Final gates remain typecheck, lint, meaningful geometry/gameplay/save tests, full browser suite, production build, local production preview at `http://127.0.0.1:5190/`, intended-change Git commit/push on existing `main`, exact-commit Vercel success and live menu/Garage/gameplay/assets/console verification at `https://pfusch-game.vercel.app/`. Physical-device testing is not implied by viewport emulation. No new target item is declared complete by this audit document.

## Ordered source mapping

Full original paths, hashes and byte sizes follow in the generated table; `manifest.json` is the machine-readable counterpart.
| # / retained reference | Original absolute path | SHA256 |
| --- | --- | --- |
| [01-defect-toeffli-steering-join.png](references/current-target/01-defect-toeffli-steering-join.png) | C:/Users/dario/AppData/Local/Temp/codex-clipboard-2fc1c3d7-59b8-49ac-bac3-49b0ec0a33a7.png | `B018D10F0D17337784B8C0393FBDA028373B5FC319DCA80936A7164CB3E75FBF` |
| [02-defect-rider-seat-transition.png](references/current-target/02-defect-rider-seat-transition.png) | C:/Users/dario/AppData/Local/Temp/codex-clipboard-a46ba40a-70be-405d-b8a3-78799cfeceee.png | `5F7D285629A0DE26DB016010FDCF85C7CACEFFD641C14A53EF08F3DDE3AFF874` |
| [03-defect-garment-rear-seat.png](references/current-target/03-defect-garment-rear-seat.png) | C:/Users/dario/AppData/Local/Temp/codex-clipboard-786a9b81-2588-4a7c-a9af-2e6c1dec977d.png | `37A60F437383AA7466AEF15DC1BB41DC467AB03023232E89C0B7983025575355` |
| [04-supermoto-husqvarna-front-quarter.png](references/current-target/04-supermoto-husqvarna-front-quarter.png) | C:/Users/dario/AppData/Local/Temp/codex-clipboard-4a26f127-6cad-4bab-a2e2-3cd58f622089.png | `59D725701B7FC6506CD3E8B0DE757AA2AB7C7B6923054869C44985C896CAAC0A` |
| [05-supermoto-ktm-front-quarter.png](references/current-target/05-supermoto-ktm-front-quarter.png) | C:/Users/dario/AppData/Local/Temp/codex-clipboard-494a7b56-ad13-4b58-9118-20389081f9c9.png | `2B2F86183E1654A9576693DC65ABDEBD59BCA7409A86BB874FA79C4CB724FBC8` |
| [06-sport-yamaha-r1-front-quarter-dark.png](references/current-target/06-sport-yamaha-r1-front-quarter-dark.png) | C:/Users/dario/AppData/Local/Temp/codex-clipboard-4df15f9b-c5a0-42cb-b2ed-070e560654a7.png | `161FC5A42C97AB7100A84AA71BE29F21424B83630BB2182E555323FE82F500DA` |
| [07-sport-yamaha-r1-front-quarter-blue.png](references/current-target/07-sport-yamaha-r1-front-quarter-blue.png) | C:/Users/dario/AppData/Local/Temp/codex-clipboard-8fdd9e0f-c963-4e75-9410-10ad458d182a.png | `25E7AB248DFA28D7985D43DE8C45CB3FE489CDCF05AFEA61A61070AC463EA378` |
| [08-sport-yamaha-r1-side.png](references/current-target/08-sport-yamaha-r1-side.png) | C:/Users/dario/AppData/Local/Temp/codex-clipboard-3a10e70e-87aa-4899-bb45-123b15418725.png | `946A6AB9679C30B743CCC2DA5CBBC4CC995081FC281FD61BE1AEC4E97DCA4E83` |
| [09-scooter-front-quarter-gray.png](references/current-target/09-scooter-front-quarter-gray.png) | C:/Users/dario/AppData/Local/Temp/codex-clipboard-17b6d29e-c6ea-4dd6-9e4f-d53073628d62.png | `880ED139098ADD3C8B4F3254F6E551CAB36EFFA3F346DE9D0658EB37D11C995A` |
| [10-scooter-side-blue.png](references/current-target/10-scooter-side-blue.png) | C:/Users/dario/AppData/Local/Temp/codex-clipboard-b307ddff-86ce-4cd8-954c-da16e4cc73b3.png | `3CDD7C53251F0FC535D685AC095E7D975DDAB862960938E13F3DCFE2F153AFB1` |
| [11-scooter-front-quarter-graphics.png](references/current-target/11-scooter-front-quarter-graphics.png) | C:/Users/dario/AppData/Local/Temp/codex-clipboard-fee11bc0-c37a-4e20-9ba8-a27f9346e6f9.png | `2420FAA2420F3BCA45C13C2CBA40796C163A54887038D5259F4EC46E1C03675C` |
| [12-cross-helmet-airoh-side-right.png](references/current-target/12-cross-helmet-airoh-side-right.png) | C:/Users/dario/AppData/Local/Temp/codex-clipboard-b96fd6cb-5644-4c67-9ac4-8b8bb7ca9107.png | `3FBA68A0788A275206FF20F41A699898750DE794DBA8ED2E74307D490B5ED9D3` |
| [13-cross-helmet-airoh-side-left.png](references/current-target/13-cross-helmet-airoh-side-left.png) | C:/Users/dario/AppData/Local/Temp/codex-clipboard-f04311d2-986e-4f7b-a04f-7acf281694ee.png | `2357DD951811A56C911777FD43A872D7BEFF972FA781D79E8D6E9452355F01F3` |
| [14-cross-helmet-airoh-front.png](references/current-target/14-cross-helmet-airoh-front.png) | C:/Users/dario/AppData/Local/Temp/codex-clipboard-3b79f34b-90cd-4bd8-88d2-d22f38b445da.png | `7685B1C8792A2FDF9F7BA53FC247D87288408F0345729F799968343FB3E1F8D6` |
| [15-cross-helmet-worn-blue-goggles.png](references/current-target/15-cross-helmet-worn-blue-goggles.png) | C:/Users/dario/AppData/Local/Temp/codex-clipboard-db9f393f-5106-493f-8935-6b2fbf397b20.png | `EBF087F9CC9AEC23ECDB33508543726EFA04096EB2C7ED2B227484114FED00DE` |
| [16-cross-helmet-side-gold-goggles.png](references/current-target/16-cross-helmet-side-gold-goggles.png) | C:/Users/dario/AppData/Local/Temp/codex-clipboard-14aa8b20-2b01-4ad8-80e7-be6c4cd5b8a7.png | `F41A3686EF9B288458A6C166325131012DC4BA3C9074D5FEFA4ABF63DBEA2907` |
| [17-cross-helmet-worn-orange-goggles.png](references/current-target/17-cross-helmet-worn-orange-goggles.png) | C:/Users/dario/AppData/Local/Temp/codex-clipboard-3bc1c500-ccee-49b4-bbed-2842be1be930.png | `6364F4B663B9975F797C31AAC1DD9ABDA072EBF1D446954D60937CF9E3F1EE80` |
