# New model and stunt corrections

Baseline release: `4f66422b3c50e49dffb75dd54a14398338b8adac`. This request adds corrections to the completed previous target; its validation remains historical evidence only.

## Implemented corrections

- Narrow chain/swingarm packaging; open fork guards and downturned fender; Supermoto frame head junction, hidden subframe, visible tank, alloy rim interiors, foot contacts and glass/reflector headlight.
- Sport wider aerodynamic tail, compact exhaust clear of the boot, sharper front and more restrained flank surfaces.
- MX rear shell edge, recessed goggles and wider/thicker band. More bike, rim and helmet colors with temporary preview and explicit Equip.
- Brief rearward torso tug on each wheelie start; grounded drift lead-in and small wheelie balancing; exhaust smoke and material-specific tail scraping particles; fall continues its forward motion.
- Detailed, scaled traffic and moving flatbed trucks. User confirmed automatic side-entry ramp jumps and construction/barrier obstacles instead of ground patches. Increasing distance difficulty; stunt-dominant points.
- Prop/tree clearance and restrained shader/surface improvements; release through the existing main/GitHub/Vercel project.
- Six road-sign originals have now arrived; images 4/5 are excluded. P/F/U/S/C/H use the Signs hoodie orientations and award a set bonus. See `SIGN-COLLECTIBLES.md`.
- Additional user priority: every in-play touch button is replaced by horizontal lane swipes and continuous vertical rear/forward weight control. Keyboard bindings remain unchanged; two-finger tap provides touch pause. No automatic wheelie stabilization.
- Latest Sport feedback: smoked screen must continue the fairing line without the previous upright kink; its root tangent and lower silhouette are revised together.
- Final Sport feedback: footpegs moved forward from Z=0.40 to 0.22 using fixed-length IK; the tank crown is lower/slimmer. The user's circled opening is closed by molded flanks whose edges sample the actual tank and fairing meshes. Side/front-quarter views confirm the join.
- Tow rear tires and guards sit below the flat deck; the ramp begins behind their complete envelope. Ramp entry shares the collision width, and takeoff height accounts for the leading motorcycle tire. All four actual motorcycle tire meshes clear the rendered ramp.
- Optional final MX peak refinement: clipped/narrower terminal lip, clearer molded center ridge, shoulder channels and continuous temple joins. Above/front/side views checked; head scale and accepted shell, goggles and rear ridge retained.

## Validation scope

The complete 309-test unit suite passed before the final visual-only refinements; the 22 affected helmet, rider-motion and model-clearance tests passed after the Sport foot/tank and peak changes. Final gap closure has a production build/typecheck, scoped lint and actual Garage side/front-quarter inspection.

The user subsequently requested **only necessary tests**, replacing the earlier broad browser-suite requirement. **24 distinct browser cases passed, with no unresolved failures; 18 available cases were intentionally not repeated.** Passed controls/accessory/audio/crash groups are retained; new signs, particles, tow ramps and core smoke flow passed targeted checks. Test readiness fixes preserve functional assertions. Final runtime results and exact release identity are recorded in `CURRENT-TARGET-STATUS.md` and the local release verification report.

## Reference mapping

Eleven supplied original images and SHA256 hashes: `references/corrections-2026-09-15/manifest.json`. Order: chain, KTM fork/fender/frame, current fork guard, Airoh rear edge, goggles, Sport tail, exhaust/boot, Supermoto foot, exposed subframe, tow truck, subframe close-up.

Internet comparison requested by the user: [KTM official 450 SMR photographs](https://press.ktm.com/news-definiert-neue-grenzen-die-ktm-450-smr-des-modelljahres-2026?id=225230&l=germany&menueid=5678), [KTM chassis/ergonomics and footpegs](https://www.ktm.com/en-pt/models/supermoto/2026-ktm-450-smr.html), and the earlier supplied Yamaha R1 side/front photographs. Contact positioning and sculpted proportions are visual interpretations, not claimed factory CAD measurements. One immutable rider skeleton is preserved.

Actual quota at the start was 47% used / 53% remaining; the pre-release check was 82% used / 18% remaining. The <=5% checkpoint rule has not triggered.
