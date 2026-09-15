# PFUSCH current target — 15 September 2026

Implementation and necessary local validation are complete. This pass extends baseline main commit `4f66422b3c50e49dffb75dd54a14398338b8adac`; the baseline's validation is historical, not evidence for these changes.

## Completed work

- Corrected chain/symmetric swingarms, Supermoto frame and hidden subframe, tank, foot contacts, silver rim interiors, glass headlight, open fork guards and downturned fender.
- Revised Sport front, sides, wider tail, tinted fairing-aligned screen and compact exhaust. Feet moved forward with fixed-length IK; the tank is lower/slimmer. The final user-circled opening is closed with molded flanks fitted to the actual tank and fairing edges. Final side/front-quarter Garage views inspected without renderer errors.
- Refined MX rear edge, recessed goggles, wider strap and optional final sun peak. Above/front/side views inspected. Added bike, rim and helmet colors while retaining temporary preview and explicit Equip.
- Implemented horizontal lane swipes and continuous vertical weight/balance control, with no in-play buttons. Keyboard controls unchanged; two-finger tap pauses. Narrow, short and mobile viewport checks passed.
- Integrated wheelie-onset weight shift, grounded drift lead-in, wheelie balancing, exhaust smoke, physical material-specific tail scraping and continued forward crash motion. Particle pools remain bounded and respect pause/blur.
- Added detailed moving traffic, side-entry tow-ramp jumps, construction barriers, progressive difficulty, prop/tree clearance and restrained surface shaders. Tow tires/guards clear the deck, and all four bike tires clear the ramp during takeoff.
- Added six supplied collectible signs, excluding images 4/5 and using the Signs hoodie orientations. Original file hashes, rendered signs and set rewards verified. Normal riding earns few points; wheelies/stunts earn substantially more.

The immutable adult skeleton, fixed-length IK, source garment artwork, real Merriweather oldstyle proportional numbers, save schema 1, service boundaries, deterministic fixed-step domain, bounded pools, one airborne lane correction, polling watcher and disabled HMR are preserved.

## Validation

- Complete unit suite: **309/309 passed** before the final visual refinements. After Sport feet/tank and MX peak refinements, **22/22 affected tests passed**. Final fitted gap closure passed production build/typecheck, scoped lint and actual Garage visual inspection.
- Necessary browser checks: **24 distinct cases passed, 0 unresolved failures**. The other 18 available cases were intentionally not repeated after the user requested only necessary tests. This is not a claim that the full 42-case suite ran.
- Final bundle `index-Bav4WVV8.js` / `SceneView-Dp8v77hB.js`: desktop/mobile core smoke and normal/low-quality tow traffic passed. Earlier unaffected controls, accessories, audio, crash, zipper, signs and particle checks remain valid.
- Browser startup and ramp-polling failures were test-harness readiness issues. The corrected tow test advances bounded simulation steps and retains strict launch, airborne correction, landing and reward assertions. Side entry occurs on physics tick 7; no gameplay workaround was introduced.
- Typecheck, lint, build and diff whitespace checks passed. Detailed local evidence is in `outputs/necessary-browser-validation-summary.json` and its linked reports.

## Release handoff

Release the checked changes to existing GitHub main and the existing Vercel project at https://pfusch-game.vercel.app/. Verify the exact deployed commit, final bundle, live Garage/gameplay, original sign/catalog assets and browser errors. The post-deployment report belongs in `outputs/release-corrections-2026-09-15.json` so the final commit identity does not require a self-referential documentation commit. Mark the active goal complete only after successful live verification.

References: `CORRECTIONS-2026-09-15.md`, `SIGN-COLLECTIBLES.md`, and `references/corrections-2026-09-15/manifest.json`.

Latest actual quota check before release: **82% used / 18% remaining**. No reset used; the <=5% checkpoint threshold has not triggered.
