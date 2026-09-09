# PFUSCH Street Run project rules

## Product
Build a mobile-first PFUSCH supermoto endless runner, not a generic game template. Keep the ride → score → garage → ride loop immediate, with a strong black/white foundation and restrained signal accent. Read the current implementation before changing frameworks.

## Architecture
Use strict TypeScript. Gameplay is a deterministic fixed-step domain in `app/game/engine.ts`, independent of React, DOM, storage and Shopify. Keep object counts bounded; update Three.js imperatively, not through per-frame React state. UI HUD updates may be throttled. Preserve pooling, reachable safe lanes, pause/blur behavior, jump clearance and idempotent run settlement.

Use service interfaces in `app/services/index.ts`. LocalStorage belongs only in the storage adapter. AuthService, PlayerRepository, ProductProvider, RewardService, LeaderboardService and AnalyticsService must remain replaceable. Future Shopify identity, purchase detection, guest merge, cloud save, customer metafields and real rewards belong in server adapters. Browser state must never authorize valuable real-world rewards.

## Data
Save schema version 1; migrate explicitly before altering shape. XP is cumulative; level is derived from XP. Challenge days and ranking windows use UTC. Coin purchases must check price, balance, required level and existing ownership. A run settles once. Ownership supports LOCKED, UNLOCKED_DIGITAL, OWNED_IRL and EQUIPPED. Product identity uses stable Shopify product IDs; variant IDs stay strings. Game categories are inferred and source fields remain in the catalog. Preserve every publicly discoverable product, including unavailable products. Refresh the central catalog from public Shopify feeds and verify pagination and sitemap coverage; never scatter product data in components.

## Mobile and quality
On Windows, keep Vite file watching in polling mode. This OneDrive workspace has reproduced native `fs.watch` EBUSY crashes when artwork is locked during sync. Preserve the workspace's HMR preference (currently disabled) and verify the server survives locked assets when changing watcher settings.
Touch is primary. Keep swipe handling inside the ride, no page scrolling during play, reachable buttons and clear keyboard alternatives. Test 390×844 and short/narrow screens. Keep real PFUSCH imagery in product cards and always available beside rider previews. Caps are carried at the hip with the full-face riding helmet retained; bags/keychains attach to the rider, flags/stickers remain collectibles. Every equippable item must support free temporary preview before ownership. Only explicit Equip saves a loadout. Preserve real catalog colors and supplied artwork; never invent garment prints. No mandatory login, crash-time commerce interruptions or real discount generation.

## Commands
`npm ci`; `npm run dev`; `npm run typecheck`; `npm run lint`; `npm test`; `npm run test:browser` (dev server and Edge required); `npm run build`; `npm start`. Vercel serves `dist` using `vercel.json`. Sites metadata is in `.openai/hosting.json`; use the Sites workflow when publishing there.

## Validation
Test collision/jump/near-miss logic, deterministic updates, save recovery, XP thresholds, idempotent rewards, daily rollover and catalog coverage. Browser smoke tests must include start, controls, crash/reward, restart, persistence, gear and navigation. Do not enable the React compiler on the imperative game renderer without restructuring it. Vendored starter components are excluded from project lint; inspect any adopted primitive for accessibility at its call site.

## IMMUTABLE RIDER SKELETON — HARD RULE

The rider has ONE immutable adult skeleton.

Töffli, Supermoto and Sport MUST use identical:
- torso length
- shoulder width
- hip width
- upper-arm length
- forearm length
- thigh length
- shin length
- head/helmet scale

Bike changes may alter ONLY:
- seat/contact targets
- handlebar targets
- footpeg targets
- torso lean
- joint angles

Never encode different human anatomy per motorcycle.

Use fixed-length IK for arm and leg contact.

A pose must never make the same rider grow shorter arms, longer legs,
a bigger head or a different torso.

Do not regress to primitive box/cylinder anatomy.

Visible quality is more important than automated test success.