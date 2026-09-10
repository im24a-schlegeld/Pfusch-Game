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

Browser tests use locally installed Microsoft Edge. Change `channel` in `playwright.config.ts` if necessary. Run the dev server before browser tests. Production output is `dist`; Vercel configuration is included. This is a static application: the generated starter's server dependencies are not part of the shipped game.

## Controls

Mobile: swipe left/right to dodge, swipe up or tap LIFT for a short front-wheel lift, hold WHEELIE. Desktop: A/D or left/right arrows; W/up to lift; S/down to wheelie; Escape/P to pause. Lift just before a low striped road edge; cars and vans must be dodged. Manual lift keeps the rear wheel grounded and has a short recovery period. Roadwork ramps provide a speed-dependent launch automatically. Exactly one accepted lane change is allowed per flight; landing restores normal lane switching. Release wheelie before the balance meter fills. Blur pauses the ride and its rider animation.

## Game and progression

Three motorcycle configurations, body/rim finishes, stylized rider equipment, ten levels, earned coins, four UTC daily challenges, local demo rankings, digital reward redemption and preview-only future shop benefits. A starter has 150 coins, enough for one digital garment; the Crew allowance grants another 100 once. Purchased digital cosmetics are permanently unlocked on the device. Coins have no cash value.

All 16 PFUSCH products and 186 variants were verified on 8 September 2026 against the public Shopify feed, pagination, sitemap, collections and individual product pages. The catalog includes 87 front/back photographs for 45 appearances: 38 published color options and 7 single appearances. See `docs/CATALOG.md` and `docs/PREVIEW-CATALOG-AUDIT.json`. Prices and availability are a dated snapshot; the linked shop is authoritative. Supplied Signs, radar and Ziptie graphics are mapped where verified. Other garments use faithful silhouettes/colors alongside prominent real product photos; missing artwork is never replaced with invented lettering. Caps are carried at the rider's hip while the full-face helmet remains on. Bags and keychains attach to the rider; flags/stickers are collectibles.

Every bike, finish and wearable can be tried while locked, at level 1 and with zero coins. Garage changes form a temporary combined setup. `RETURN TO EQUIPPED` clears it; leaving Garage discards it. Unlock purchases ownership only. Explicit `EQUIP FOR GAMEPLAY` or `EQUIP BIKE SETUP` saves owned selections. Racing Zipper supports a temporary 1–2 digit Merriweather oldstyle proportional number on the rider and a separate proof; its unedited shop back photograph displays example 23. Number and variant persist only after Equip.

Töffli, Supermoto and Sport have separate reference-led silhouettes, tailored smooth rider geometry, per-bike riding poses, shared grip/peg contact coordinates and one exhaust each. Front, side and rear inspection controls plus drag rotation are available. Paint and rim selection applies to every class. Vehicle license plates and their dedicated rewards were removed; garment numbers remain.

## Architecture

- `app/game/engine.ts`: fixed 60 Hz deterministic simulation, bounded 32-object pool, collision and skill scoring. No React, storage or commerce calls.
- `app/game/SceneView.tsx`, `models.ts`, `vehicle.ts`: lazy-loaded Three.js renderer, traffic, smooth motorcycle/rider meshes and camera.
- `app/domain`: typed player, inventory, XP, daily challenge and economy rules.
- `app/services`: AuthService, PlayerRepository, ProductProvider, RewardService, LeaderboardService and AnalyticsService interfaces with guest/local/mock adapters.
- `app/ui`: responsive game screens; `public/catalog/products.json`: central product snapshot.

Save schema is version 1 under `pfusch:player:v1`. An additive migration initializes missing `customizations` to an empty record and accepts only valid 1–2 digit numbers. Loading validates values, recalculates level and rolls UTC challenges. Malformed saves are copied to a recovery key. Failed persistence is reported visibly. Completed runs have idempotent IDs. Export a JSON backup in Settings. The local analytics adapter keeps at most 100 session events; it sends nothing.

Future Shopify customer identity, cloud save, order entitlements and valuable rewards belong in server adapters. Merge guest progress through an explicit backend policy. Never trust browser coin balances or mock IRL ownership for real benefits. Weekly definitions and PFUSCH Tickets exist in the model but are not active economies.

## Repair pass status

The Garage has one persistent 3D renderer with inline product controls. Prints are composed into garment textures. All three bikes use one immutable adult skeleton and fixed-length arm/leg IK. The Töffli wheelbase, wheel size and fender clearance have been corrected. Merriweather is bundled with its real onum/pnum glyphs; font loading and oldstyle descent are checked before number rendering. See docs/MERRIWEATHER-NUMERAL-AUDIT.json.

The current pass reworks the Supermoto chassis and Sport fairings, connects garment shoulders, smooths visor/headlight outlines, adds fixed-length skinned rider motion and replaces manual jumping with a road-edge lift. All nine equippable tops have front/back Garage comparisons against the real product photographs. See `docs/COMPLETION-PASS.md` for validation and the exact remaining work. Road/environment variety and actual tunnels are unfinished; so are source-derived washed-fabric variation and finer product-specific pocket/cuff construction. These are not claimed complete.

## Next refinement

Playtest real iOS Safari and Android devices, tune traffic/near-miss thresholds and economy over repeated 45–120 second sessions, and refine motorcycle/garment art. Current browser checks cover desktop Edge and emulated mobile portrait, not physical-device performance. Online leaderboards, authentication, weekly challenge UI and real shop rewards are intentionally outside V1.
