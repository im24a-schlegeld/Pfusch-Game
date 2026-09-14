# PFUSCH Street Run

A guest-first supermoto arcade game for PFUSCH Clothing. React 19, strict TypeScript, Three.js, Vite. No backend or credentials required.

## Run

Requires Node 22.13+ (tested on Node 24).

```sh
npm ci
npm run dev
```

Open http://localhost:5173. For a phone on the same Wi-Fi, use the Network URL printed by Vite. Allow local network access if Windows asks.

Windows uses polling for development file watching. This avoids OneDrive file locks causing `EBUSY` crashes while syncing artwork. The current workspace has HMR disabled; reload the page after edits. If port 5173 is already occupied, use the actual Local URL Vite prints.

```sh
npm run typecheck
npm run lint
npm test
npm run test:browser
npm run build
npm start
```

Browser tests use locally installed Microsoft Edge. Run a server before browser tests. For production validation, run `npm run build`, then `npx vite preview --host 127.0.0.1 --port 5190 --strictPort`. Set `PFUSCH_BASE_URL=http://127.0.0.1:5190` for the browser tests (PowerShell: `$env:PFUSCH_BASE_URL='http://127.0.0.1:5190'`). Production output is `dist`; the existing `main` branch deploys to [pfusch-game.vercel.app](https://pfusch-game.vercel.app/). This is a static application: the generated starter's server dependencies are not part of the shipped game.

## Controls

Mobile: swipe left/right or use the arrow buttons to dodge. Hold WHEELIE and slide the same thumb upward to reduce rearward throttle, cross neutral and shift weight forward; slide down to raise again. Release for neutral. Desktop: A/D or left/right arrows dodge; S/down applies rearward throttle; W/up shifts forward and catches the front. Escape/P pauses. Space and vertical swipes do not jump.

Short inputs give an initial tug, followed by skill-based balance. Holding rearward input too long can overrotate. A higher controlled angle earns more points; uncontrolled rotation loses the bonus. Dodge traffic and potholes/raised edges, or lift the front before the edge. Lower the front on wet asphalt/gravel; forward weight smooths rough patches. Every generated wave leaves a viable clear route. Exactly one accepted lane change is allowed per genuine physical airborne state; landing restores normal switching. There are no generic jumps or launching ramps. Blur pauses the ride and its animation.

## Game and progression

Three motorcycle configurations, body/rim finishes, stylized rider equipment, ten levels, earned coins, four UTC daily challenges, local demo rankings, digital reward redemption and preview-only future shop benefits. A starter has 150 coins, enough for one digital garment; the Crew allowance grants another 100 once. Purchased digital cosmetics are permanently unlocked on the device. Coins have no cash value.

All 16 PFUSCH products and 186 variants were verified on 8 September 2026 against the public Shopify feed, pagination, sitemap, collections and individual product pages. The catalog includes 87 front/back photographs for 45 appearances: 38 published color options and 7 single appearances. See `docs/CATALOG.md` and `docs/PREVIEW-CATALOG-AUDIT.json`. Prices and availability are a dated snapshot; the linked shop is authoritative. Supplied Signs, radar and Ziptie graphics are mapped where verified. Other garments use faithful silhouettes/colors alongside prominent real product photos; missing artwork is never replaced with invented lettering. Caps are carried at the rider's hip with the selected riding helmet retained. Bags and keychains attach to the rider; flags/stickers are collectibles.

Every bike, finish and wearable can be tried while locked, at level 1 and with zero coins. Garage changes form a temporary combined setup. `RETURN TO EQUIPPED` clears it; leaving Garage discards it. Unlock purchases ownership only. Explicit `EQUIP FOR GAMEPLAY` or `EQUIP BIKE SETUP` saves owned selections. Stock full-face/motocross helmets and four colors are free; `EQUIP HELMET` saves only the helmet selection. Racing Zipper supports a temporary 1–2 digit Merriweather oldstyle proportional number on the rider and a separate proof; its unedited shop back photograph displays example 23. Number and variant persist only after Equip.

Töffli, Supermoto and Sport have separate reference-led silhouettes, tailored smooth rider geometry, per-bike riding poses, shared grip/peg contact coordinates and one exhaust each. Front, side and rear inspection controls plus drag rotation are available. Paint and rim selection applies to every class. Vehicle license plates and their dedicated rewards were removed; garment numbers remain.

## Architecture

- `app/game/engine.ts`: fixed 60 Hz deterministic simulation, bounded 32-object pool, collision and skill scoring. No React, storage or commerce calls.
- `app/game/world.ts`, `worldView.ts`, `worldLighting.ts`: bounded seeded segments, pooled environment geometry and distance-driven lighting. `roadEvents.ts` shares visible event dimensions with motorcycle-specific contact policies.
- `app/game/SceneView.tsx`, `models.ts`, `vehicle.ts`: lazy-loaded Three.js renderer, traffic, smooth motorcycle/rider meshes and camera.
- `app/domain`: typed player, inventory, XP, daily challenge and economy rules.
- `app/services`: AuthService, PlayerRepository, ProductProvider, RewardService, LeaderboardService and AnalyticsService interfaces with guest/local/mock adapters.
- `app/ui`: responsive game screens; `public/catalog/products.json`: central product snapshot.

Save schema is version 1 under `pfusch:player:v1`. Additive migrations initialize missing `customizations` to an empty record, accept only valid 1–2 digit numbers, and default missing/invalid optional helmet fields to the original full-face/Chalk appearance. Loading validates values, recalculates level and rolls UTC challenges. Malformed saves are copied to a recovery key. Failed persistence is reported visibly. Completed runs have idempotent IDs. Export a JSON backup in Settings. The local analytics adapter keeps at most 100 session events; it sends nothing.

Future Shopify customer identity, cloud save, order entitlements and valuable rewards belong in server adapters. Merge guest progress through an explicit backend policy. Never trust browser coin balances or mock IRL ownership for real benefits. Weekly definitions and PFUSCH Tickets exist in the model but are not active economies.

## Repair pass status

The Garage has one persistent 3D renderer with inline product controls. Prints are composed into garment textures. All three bikes use one immutable adult skeleton and fixed-length arm/leg IK. The Töffli wheelbase, wheel size and fender clearance have been corrected. Merriweather is bundled with its real onum/pnum glyphs; font loading and oldstyle descent are checked before number rendering. See docs/MERRIWEATHER-NUMERAL-AUDIT.json.

The current target includes connected garment shoulders, source-derived fabric, pockets and ribbed trim; corrected Supermoto/Sport drivetrains and Töffli belt; reference-based Sport fairings; smooth visor/headlight outlines; fixed-length skinned rider motion and suspension; skill-based wheelie/weight control. All nine tops have front/back Garage comparisons against real product photographs. See [current target and validation](docs/CURRENT-TARGET-STATUS.md).

Each run composes city, industrial, construction, open and waterfront sections with logical transitions. Real tunnels vary continuously from 5–60 seconds and have portals, walls, vaulted roof and fixtures; bridges have continuous decks, rails and water/land transitions. Day/golden/night/dawn lighting changes by segment. Three distinct procedural engine voices retain their identity through restrained tunnel reflections. Only the three exact Keep Up products gain a subtle blue response on their real artwork in darkness; daylight and unprinted fabric remain unchanged.

## Next refinement

Playtest real iOS Safari and Android devices, tune traffic/near-miss thresholds and economy over repeated 45–120 second sessions, and refine motorcycle/garment art. Current browser checks cover desktop Edge and emulated mobile portrait, not physical-device performance. Online leaderboards, authentication, weekly challenge UI and real shop rewards are intentionally outside V1.
