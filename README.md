# Wheelie Escape

A supermoto arcade game for PFUSCH Clothing. React 19, strict TypeScript, Three.js, Vite. The current local implementation permits five guest rides without credentials; continuing then requires a Shopify customer account with a confirmed newsletter subscription. The Shopify draft theme has a verified mobile menu entry and game route. Updating the existing Vercel game deployment is explicitly authorized; the Shopify theme must remain unpublished. The game update is prepared for release, while real customer account integration still requires configuration and live verification.

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

Browser tests use locally installed Microsoft Edge. Run a server before browser tests. For production validation, run `npm run build`, then `npx vite preview --host 127.0.0.1 --port 5190 --strictPort`. Set `PFUSCH_BASE_URL=http://127.0.0.1:5190` for the browser tests (PowerShell: `$env:PFUSCH_BASE_URL='http://127.0.0.1:5190'`). Production client output is `dist`; the existing public deployment is [pfusch-game.vercel.app](https://pfusch-game.vercel.app/). Shopify account features additionally require the Vercel Node functions in `api/shopify/`; Vite preview does not execute them. The unpublished theme **Wheelie Escape – Entwurf** (ID `189577920841`) is being configured separately. Its alternate homepage route `?view=wheelie-escape` avoids shared page/menu changes; see [the current Shopify setup status](integrations/shopify/README.md). The user authorized updating the existing Vercel game; deployment completion must be verified after the release. Shopify app credentials and the customer App Proxy are not configured. Only the theme remains subject to the no-publication instruction.

## Controls

Mobile: swipe left/right or use the arrow buttons to dodge. Hold WHEELIE and slide the same thumb upward to reduce rearward throttle, cross neutral and shift weight forward; slide down to raise again. Release for neutral. Desktop: A/D or left/right arrows dodge; S/down applies rearward throttle; W/up shifts forward and catches the front. Escape/P pauses. Space and vertical swipes do not jump.

Short inputs give an initial tug, followed by skill-based balance. Holding rearward input too long can overrotate. A higher controlled angle earns more points; uncontrolled rotation loses the bonus. Dodge traffic and potholes/raised edges, or lift the front before the edge. Lower the front on wet asphalt/gravel; forward weight smooths rough patches. Every generated wave leaves a viable clear route. Exactly one accepted lane change is allowed per genuine physical airborne state; landing restores normal switching. There are no generic jumps or launching ramps. Blur pauses the ride and its animation.

## Game and progression

The Garage is the home screen: inspect your setup and select **FAHRT STARTEN** to ride. Four navigation destinations cover Garage, daily tasks, rewards and rankings. Töffli, Roller, Supermoto and Sport share ten progression levels, earned coins, body/rim finishes and rider equipment. Daily tasks show UTC progress, remaining targets and automatic coin/XP payouts. Rankings contain real saved scores; disconnected devices show their own best values without invented opponents.

Six digital level rewards grant 100/150/200/300 coins at levels 1/2/3/6, violet rims at level 5 and Amethyst paint at level 8. Each is redeemable once; cosmetics unlock ownership without changing the equipped setup. Previous reward IDs remain compatible. Future real-world offers remain unavailable and are hidden from the reward screen. Coins have no cash value.

All 16 PFUSCH products and 186 variants were verified on 8 September 2026 against the public Shopify feed, pagination, sitemap, collections and individual product pages. The catalog includes 87 front/back photographs for 45 appearances: 38 published color options and 7 single appearances. See `docs/CATALOG.md` and `docs/PREVIEW-CATALOG-AUDIT.json`. Prices and availability are a dated snapshot; the linked shop is authoritative. Supplied Signs, radar and Ziptie graphics are mapped where verified. Other garments use faithful silhouettes/colors alongside prominent real product photos; missing artwork is never replaced with invented lettering. Caps are carried at the rider's hip with the selected riding helmet retained. Bags and keychains attach to the rider; flags/stickers are collectibles.

Every bike, finish and wearable can be tried while locked, at level 1 and with zero coins. Garage changes form a temporary combined setup. **ZUM AKTUELLEN SETUP** clears it; leaving Garage discards it. Bike and color rows place **KAUFEN** directly beside **ANSEHEN**, with price, balance and level checks. Buying a bike or finish changes only ownership and coins; **AUSRÜSTEN** explicitly saves the selection. Product images open a free preview even for owned garments. Stock full-face/motocross helmets and colors are free; **HELM AUSRÜSTEN** saves the helmet selection. Racing Zipper supports a temporary 1–2 digit Merriweather oldstyle proportional number on the rider and a separate proof; its unedited shop back photograph displays example 23. Number and variant persist only after Equip.

Töffli, Roller, Supermoto and Sport share one immutable adult skeleton with fixed-length arm/leg IK and different contact targets. Front, side and rear inspection controls plus drag rotation are available. Paint and rim selection applies to every class. Vehicle license plates and their dedicated rewards were removed; garment numbers remain.

## Imported motorcycle assets

Supermoto, Sport and Roller load static rigged geometry from `public/models` only when selected. Their current budgets are 43,177, 42,633 and 21,338 triangles. Visible engine cases retain their recognizable geometry; enclosed components, duplicate surfaces, branding textures, mirrors and plate supports are removed. Paint, rims, matte rubber, trim, glass and metal have separate materials. The Supermoto's recessed headlight mask is raised 35 mm; its slick tires use normals rebuilt from the smooth surface and neutral dark rubber without environment reflections. Sport indicators and their stalks are removed. The scooter scale is 1.24, retaining the shared adult rider skeleton. Source USDZ files are offline inputs and are not shipped to browsers.

The game variants soften the Supermoto mask/shroud tips, flatten the Sport lamp sweep and broaden its intake, and blunt the scooter's front V and high tail. These are geometric design choices informed by the manufacturers' references: [Husqvarna FS 450 MY22](https://press.husqvarna-motorcycles.com/news-built-for-competition-husqvarna-motorcycles-fs-450-available-now?id=138796&l=international&menueid=19202), [Yamaha third-generation R6](https://global.yamaha-motor.com/news/2005/0929/yzf-r6.html), and [BCD Nitro bodywork](https://www.bcd-design.com/en/mbk/311-mbk-nitro-before-2013.html). Lens, recess and surrounding shell are deformed together, and lamp anchors and deterministic rear-contact datums follow the exported geometry.

The `scripts/build-fs450-asset.mjs`, `build-r6-asset.mjs` and `build-nitro-asset.mjs` converters take the local source USDZ as their first argument. The Supermoto converter also accepts its headlight USDZ as the second argument. Offline conversion needs Three.js, meshoptimizer and sharp; gameplay does not parse USD or run mesh simplification. After any export, run `node scripts/sync-imported-bike-dimensions.mjs` to regenerate deterministic collision datums from the final geometry. Asset/rig tests check real brake bores, material separation, all exported vertices, wheel contacts, lamp anchors and unchanged rider bone lengths.

## Architecture

- `app/game/engine.ts`: fixed 60 Hz deterministic simulation, bounded 32-object pool, collision and skill scoring. No React, storage or commerce calls.
- `app/game/world.ts`, `worldView.ts`, `worldLighting.ts`: bounded seeded segments, pooled environment geometry and distance-driven lighting. `roadEvents.ts` shares visible event dimensions with motorcycle-specific contact policies.
- `app/game/SceneView.tsx`, `models.ts`, `vehicle.ts`: lazy-loaded Three.js renderer, traffic, smooth motorcycle/rider meshes and camera.
- `app/domain`: typed player, inventory, XP, daily challenge and economy rules.
- `app/services`: replaceable AuthService, PlayerRepository, ProductProvider, RewardService, LeaderboardService and AnalyticsService interfaces, local adapters and the restricted Shopify parent bridge.
- `server/shopify`, `api/shopify`: signed App Proxy authentication, live newsletter checks, versioned customer saves and pseudonymous digital rankings. Server secrets never enter the browser bundle.
- `app/ui`: responsive game screens; `public/catalog/products.json`: central product snapshot.

Save schema is version 1 under `pfusch:player:v1`. Additive migrations initialize missing `customizations` to an empty record, accept only valid 1–2 digit numbers, and default missing/invalid optional helmet fields to the original full-face/Chalk appearance. Loading validates values, recalculates level and rolls UTC challenges. Malformed saves are copied to a recovery key. Failed persistence is reported visibly. Completed runs have idempotent IDs. Export a JSON backup in Settings. The local analytics adapter keeps at most 100 session events; it sends nothing.

The Shopify adapters check live consent before each customer ride and save. A Liquid-rendered `data-customer-state="guest"` lets the parent bridge select the existing five-ride local trial without an App Proxy, after validating the iframe, origin and complete GET-player request. This grants neither account access nor newsletter status; customer/unknown pages and all writes still require the real proxy. The fifth trial result may settle, then further rides and persistent changes are blocked. Explicit newsletter unsubscribe blocks customers immediately, even before five rides; unavailable consent never grants customer access. A denied save preserves existing backups and creates no new persistent account backup. Guest import is conservative and does not add balances or overwrite an existing account. Account changes require a reload. See [the unpublished Shopify integration and installation guide](integrations/shopify/README.md). Order entitlements and valuable rewards still require separate trusted server adapters; digital scores are not anti-cheat proof or authorization for real benefits. Weekly definitions and PFUSCH Tickets are not active economies.

## Local validation, 6 October 2026

The final targeted checks used the installed `.build-check` tools and dependency mappings in this OneDrive workspace:

- Strict TypeScript passed for app, API, server, tests and `scripts/loading-art.ts`.
- Scoped lint passed for 46 changed/new source files. Two unrelated pre-existing broad-lint errors remain: unused `onKeep` in `app/ui/ProductPreview.tsx:44` and `new Array(count)` in `scripts/motorcycle-components.mjs:22`. The additional type-aware lint backend could not resolve the incomplete root installation's `vinext/types`; this is separate from the successful strict TypeScript check.
- Seven targeted newsletter, gesture, client, backend, ranking and domain suites passed all 133 tests. The new wheelie gaze suite passed all 8 tests on its focused rerun; rider motion, rider scale and imported bike rig suites also passed in the separate motion run. Four existing static motocross helmet geometry failures remain outside that change.
- The known broader-suite baseline still contains 19 pre-existing failing tests. That full-suite baseline was not rerun for this final targeted check; these results do not claim that the entire repository test suite is green.
- The Vite production build passed with 2,128 modules. It still reports chunks above 500 kB: approximately 571 kB for the main chunk and 620 kB for Three.js before gzip. Both separately emitted Node ESM handlers also loaded successfully in the local runtime smoke check.

The portrait and landscape loading artwork were exported from the game scene with the updated rider head pose. Final live Shopify form/account checks and browser visual verification remain separate from the automated checks above. No shop page, theme or deployment was published by this local validation.

## Repair pass status

The Garage has one persistent 3D renderer with inline product controls. Prints are composed into garment textures. All three bikes use one immutable adult skeleton and fixed-length arm/leg IK. The Töffli wheelbase, wheel size and fender clearance have been corrected. Merriweather is bundled with its real onum/pnum glyphs; font loading and oldstyle descent are checked before number rendering. See docs/MERRIWEATHER-NUMERAL-AUDIT.json.

The current target includes connected garment shoulders, source-derived fabric, pockets and ribbed trim; corrected Supermoto/Sport drivetrains and Töffli belt; reference-based Sport fairings; smooth visor/headlight outlines; fixed-length skinned rider motion and suspension; skill-based wheelie/weight control. All nine tops have front/back Garage comparisons against real product photographs. See [current target and validation](docs/CURRENT-TARGET-STATUS.md).

Each run composes city, industrial, construction, open and waterfront sections with logical transitions. Real tunnels vary continuously from 5–60 seconds and have portals, walls, vaulted roof and fixtures; bridges have continuous decks, rails and water/land transitions. Day/golden/night/dawn lighting changes by segment. Three distinct procedural engine voices retain their identity through restrained tunnel reflections. Only the three exact Keep Up products gain a subtle blue response on their real artwork in darkness; daylight and unprinted fabric remain unchanged.

## Next refinement

Playtest real iOS Safari and Android devices, tune traffic/near-miss thresholds and economy over repeated 45–120 second sessions, and refine motorcycle/garment art. Existing browser checks cover desktop Edge and emulated mobile portrait, not physical-device performance. Shopify authentication, account saves and rankings require the documented unpublished setup and live verification before activation. Weekly challenge UI and real shop rewards remain outside this implementation.
