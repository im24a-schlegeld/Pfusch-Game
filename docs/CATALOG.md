# PFUSCH public catalog audit

Refreshed 2026-10-07 from the live public storefront. Run `node scripts/sync-public-catalog.mjs` from the repository root to repeat the read-only audit. No Admin token or shop changes are involved.

## Coverage

- [Feed page 1](https://pfusch-clothing.ch/products.json?limit=250&page=1): 16 published products, 186 variants and 112 source image records.
- [Feed page 2](https://pfusch-clothing.ch/products.json?limit=250&page=2): empty; pagination exhausted. The script continues until the first empty response, rather than assuming one page.
- [Sitemap index](https://pfusch-clothing.ch/sitemap.xml): all 12 product sitemaps, including every language/market mirror, were fetched. Their union contains the same 16 handles. No missing products. Future sitemap-only products are fetched individually and retained.
- No availability filter is applied. All currently published variants report available. The former flag listing is absent from the feed/sitemaps; its historical ID remains with product and variant availability false.
- Stored total: **17 product identities and 187 variants**, including the retired flag. Variant IDs remain strings. `public/catalog/coverage.json` records the timestamp, pagination, all sitemap URLs/handles and published/retired IDs.
- Source responses remain in local `outputs/catalog-refresh-YYYY-MM-DD/` (ignored audit evidence). The September audit contained the former flag, not its replacement; identity is never reassigned.

## Central data and images

`public/catalog/products.json` is the application's central normalized catalog. Original titles, handles, descriptions (text and HTML), Shopify product type, timestamps, options, variants and image URLs remain alongside game metadata. `public/catalog/product-overrides.json` contains reviewed classification and artwork metadata; components do not duplicate catalog rows.

Existing audited color/front/back previews remain intact while their exact source images remain published. Changed primary images are downloaded from Shopify's 640px rendition; unchanged assets retain their real PNG/JPG paths. No artwork is invented, recolored or AI-generated. If the cape source changes, the script stops so its crop can be visually reviewed before updating the override.

## Updated flag / cape

- Current [Logo Flagge](https://pfusch-clothing.ch/products/logo-flagge-1): product ID `10442786799945`, variant `55543055515977`, CHF 24.90. Source identity/type remains `Flag`; requested game category is `cape`.
- Historical ID `9464572805449` stays a retired `collectible`. Existing ownership is preserved and does not grant the new cape.
- Untouched [Shopify original](https://cdn.shopify.com/s/files/1/0921/5918/1129/files/all-over-print-flag-white-front-6ac63a22a7f1e.jpg?v=1791375925): `public/images/catalog-source/logo-flagge-1-original.jpg`, 2000×2000. Cards/details retain the complete photo; `public/images/logo-flagge-1.jpg` is the 640px rendition.
- Dark waves and gray PFUSCH cable-tie wordmark match the supplied reference. No separate flat print image was published. The photo includes white margins, curved cloth edges and grommets. Safe interior `preview.artwork.crop`: x=155, y=485, width=1720, height=1035. Pixel inspection found no white-background pixels there (maximum channel value 160).
- Sample the rectangle without modifying the bitmap. Three.js `flipY=true`: offset=(0.0775,0.24), repeat=(0.86,0.5175). Preserve logo orientation on the reverse side; no separate reverse artwork was published.
- Additive schema 1 `cape` slot permits simultaneous bag, keychain and hip cap. Garage → Fahrer → Accessoires offers free temporary preview. Explicit digital purchase/equip requires level 8 and 5000 game Coins; owned items can be re-equipped without another charge. Removing the cape preserves other equipment.

## Normalization and source branding

Shopify product type is blank, so categories use titles/use and reviewed metadata. Current upper: 9, head: 3, accessory: 2, cape: 1, collectible: 1; the historical flag adds a second collectible. Shop availability never removes existing digital items. Colors are estimates based on original options/images, not official fabric swatches. Racing Zipper's one- or two-digit number is customization, not a Shopify variant.

The actual logo uses a gray cable tie around the PFUSCH wordmark. Caps attach at the hip while the helmet remains on. The new cape is the explicit user-requested exception to the earlier flag-as-collectible treatment; the sticker and historical flag retain their existing behavior.
