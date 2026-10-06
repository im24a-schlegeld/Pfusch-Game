# Wheelie Escape — Shopify-only hosting handoff (2026-10-06)

## Latest user decision

Vercel was only a preview. The game and account saving must run entirely on Shopify, with no Vercel or other external hosting provider. The user has no other hosting account. Only the Shopify draft theme may be changed; do not publish the shop. The user reported 5% remaining quota. Earlier instructions in deployment documents to update Vercel are superseded.

## Verified state

- Game implementation is pushed to GitHub main at `4b3a47e` (`Finish Wheelie Escape garage and Shopify account integration`). No hosting migration was implemented in this follow-up.
- Draft theme: `189577920841`, `Wheelie Escape – Entwurf`; active theme remains unchanged. The draft still embeds the previous Vercel address and has not been migrated.
- Shopify app `432062332929`, `Wheelie Escape`, was created by the user. Version `1156347723777`, `account-save-v1`, is active. Installation, app proxy, server credentials and real account saves have not been verified.
- Secure saving currently uses Node endpoints under `api/shopify/`, customer metafields and a shop-metafield leaderboard. A plain theme upload cannot execute these endpoints.
- The connected Shopify Hydrogen storefront opened a GitHub PR for Oxygen configuration. Its workflow is now included locally and uses `npm run build:oxygen` plus Shopify's explicit `dist/client` and `dist/server` output flags.
- No Oxygen deployment, secret configuration, theme publication, or real account test was completed.

## Shopify-owned option

Hydrogen/Oxygen is Shopify's own hosting, included on paid Shopify plans. It supports the game assets plus server logic. The existing Vite/Node app requires a real runtime/authentication migration; do not claim it can be uploaded unchanged.

Oxygen explicitly does not support proxies in front of deployments. Do not simply point the existing Shopify App Proxy at Oxygen. Use direct Customer Account authentication and Oxygen server endpoints; preserve server enforcement of newsletter state, customer isolation, bounded payloads, compareDigest conflict detection and idempotent settlement. Keep the immutable rider and deterministic engine unchanged.

A browser-only Customer Account API public client can read newsletter state and write accessible customer metafields, but cannot replace our server-enforced newsletter save restriction or shared shop leaderboard. Do not silently substitute this weaker design.

The Hydrogen App Store page was opened and its initial Install button led to `https://admin.shopify.com/store/gkhnzi-gc/hydrogen` in browser tab 23. The destination could not be inspected: DOM and screenshot calls timed out; the CUA kernel reset. No installation permission screen was confirmed or approved. Inspect actual state next. Creating new security-sensitive app/GitHub permissions requires the concrete authorization step; do not assume the initial store button granted them.

## Next steps

1. In the connected Hydrogen storefront, merge the generated GitHub PR if it is still open. The workflow must deploy `dist/client` and `dist/server` with `npm run build:oxygen`; do not publish the existing Online Store theme.
2. Configure Oxygen environment variables (`OXYGEN_APP_ORIGIN`, `SHOPIFY_STOREFRONT_ORIGIN`, `CUSTOMER_ACCOUNT_CLIENT_ID`, `OXYGEN_SESSION_SECRET`, and the server-only Shopify admin variables) in the Hydrogen storefront.
3. Configure the Customer Account client callback as `https://<OXYGEN-ORIGIN>/auth/callback`, deploy the preview, and verify real save/reload and unsubscribe blocking before changing the draft iframe.
4. Change only the draft iframe to the verified Shopify-owned game URL and test garage, loading, gameplay/full viewport, pause/result return and account persistence on mobile.
5. Retire Vercel only after the replacement works. Never delete the existing deployment or disconnect GitHub without preserving the working game and confirming the actual replacement state.

Sources: [Hydrogen/Oxygen fundamentals and proxy limitation](https://shopify.dev/docs/storefronts/headless/hydrogen/fundamentals), [Oxygen runtime](https://shopify.dev/docs/storefronts/headless/hydrogen/deployments/oxygen-runtime), [GitHub deployment](https://shopify.dev/docs/storefronts/headless/hydrogen/deployments/github), [Customer Account public client](https://shopify.dev/docs/storefronts/headless/building-with-the-customer-account-api/getting-started).
