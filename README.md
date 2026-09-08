# PFUSCH Street Run

A complete guest-first supermoto arcade game for PFUSCH Clothing. React 19, strict TypeScript, Three.js, Vite. No backend or credentials required.

## Run

Requires Node 22.13+ (tested on Node 24).

```sh
npm ci
npm run dev
```

Open http://localhost:5173. For a phone on the same Wi-Fi, use the Network URL printed by Vite. Allow local network access if Windows asks.

Windows uses polling for development file watching. This avoids OneDrive file locks causing `EBUSY` crashes while syncing artwork, and preserves hot reload. If port 5173 is already occupied, use the actual Local URL Vite prints.

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

Mobile: swipe left/right to dodge, swipe up or tap Jump, hold Wheelie. Reachable arrow buttons are also provided. Desktop: A/D or left/right arrows; W/up to jump; Space to wheelie; Escape/P to pause. The bike accelerates automatically. Jump striped barriers, dodge vehicles, and use ramps. Release wheelie before the balance meter fills. Close lateral passes, cleared obstacles and controlled wheelies build a timed combo. Blur pauses a ride.

## Game and progression

Three motorcycle configurations, body/rim finishes, number plates, stylized rider equipment, ten levels, earned coins, four UTC daily challenges, local demo rankings, digital reward redemption and preview-only future shop benefits. A starter has 150 coins, enough for one digital garment; the Crew allowance grants another 100 once. Purchased digital cosmetics are permanently unlocked on the device. Coins have no cash value.

All 16 live PFUSCH products and 186 variants were verified on 8 September 2026 against the public Shopify feed, pagination, sitemap, collections and individual product pages. Real main images are bundled; full source images/options remain in the normalized catalog. See `docs/CATALOG.md`. Prices and availability are a dated snapshot; the linked shop is authoritative. Garments use category templates and estimated colors, with PFUSCH text, rather than exact reproductions. Headwear colors customize the riding helmet. Accessories attach to the rider; flags/stickers are collectibles.

## Architecture

- `app/game/engine.ts`: fixed 60 Hz deterministic simulation, bounded 32-object pool, collision and skill scoring. No React, storage or commerce calls.
- `app/game/SceneView.tsx`, `models.ts`: lazy-loaded Three.js renderer, reusable geometry, stylized models and camera.
- `app/domain`: typed player, inventory, XP, daily challenge and economy rules.
- `app/services`: AuthService, PlayerRepository, ProductProvider, RewardService, LeaderboardService and AnalyticsService interfaces with guest/local/mock adapters.
- `app/ui`: responsive game screens; `public/catalog/products.json`: central product snapshot.

Save schema is version 1 under `pfusch:player:v1`. Loading validates values, recalculates level and rolls UTC challenges. Malformed saves are copied to a recovery key. Failed persistence is reported visibly. Completed runs have idempotent IDs. Export a JSON backup in Settings. The local analytics adapter keeps at most 100 session events; it sends nothing.

Future Shopify customer identity, cloud save, order entitlements and valuable rewards belong in server adapters. Merge guest progress through an explicit backend policy. Never trust browser coin balances or mock IRL ownership for real benefits. Weekly definitions and PFUSCH Tickets exist in the model but are not active economies.

## Next refinement

Playtest real iOS Safari and Android devices, tune traffic/near-miss thresholds and economy over repeated 45–120 second sessions, and refine motorcycle/garment art. Current browser checks cover desktop Edge and emulated mobile portrait, not physical-device performance. Online leaderboards, authentication, weekly challenge UI and real shop rewards are intentionally outside V1.
