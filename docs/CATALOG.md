# Pfusch public catalog audit

Fetched 2026-09-08 from the live storefront. This directory is independent of the Site checkout.

## Coverage

- https://pfusch-clothing.ch/products.json?limit=250&page=1 returned **16 unique products**, **186 variants**, and **112 image records**.
- https://pfusch-clothing.ch/products.json?limit=250&page=2 returned `{"products":[]}`. Pagination is exhausted.
- https://pfusch-clothing.ch/collections/all contains exactly the same 16 product handles.
- https://pfusch-clothing.ch/sitemap.xml links to one base-language product sitemap. https://pfusch-clothing.ch/sitemap_products_1.xml?from=9464572805449&to=10237102096713 contains the same 16 product URLs, plus the homepage. Other language sitemaps are localized mirrors.
- All 16 individual product pages were fetched successfully. Each canonical URL matches its feed handle; each page includes InStock offers and no OutOfStock offers.
- The four native collections were also fetched. T-Shirts: 3; Hoodies: 5; Accessoires: 7; Jacken/Windbreaker: 1. Their union is the same 16 products.
- No inventory availability filtering was applied. All discovered products and all variants were retained. All 186 current variants report available=true; there were no sold-out products at fetch time. No trousers or bikes are currently discoverable products.
- Search/web cache for `/collections/all` was two months old and showed only 12 products, missing the three Keep up releases and P ZERO Cap. The saved catalog uses the live HTTP feed and fresh collection/sitemap, avoiding stale cache omissions.

## Deliverables

- `catalog.json`: normalized product array with string id, original title/handle, canonical shop link, CHF numeric minimum price, all source images, local primary-image path, inferred game category/type, estimated baseColor, concise German description, sourceDescription, complete options and variants including availability and variant image/color.
- `images/`: all 16 primary product images at the Shopify CDN's 640px rendition, and `pfusch-logo.png` at 600px. These are actual storefront assets, with no AI-generated or substituted imagery.
- `contact-sheet.png`: visual inspection sheet only, not a product replacement asset.
- `products-page-1.json`, `products-page-2.json`, XML sitemaps, homepage/collection HTML, and `product-pages/` preserve source evidence.
- `product-page-verification.json` and `collection-verification.json`: automated cross-check evidence.

## Normalization notes

Shopify product_type is blank for all items; `type` and game `category` are inferred from the original titles and use. Upper: 9; head: 3; accessory: 2; collectible: 2. Flag and sticker are collectibles; crossbody bag and keychain are accessories. Color hex values are representative estimates based on source color options and visually inspected source imagery, not official material swatches. All original options are retained. Original descriptions are retained as sourceDescription; description is concise adaptation. The Racing Zipper's number is a shop customization, not a numeric Shopify variant; its source description explains 1–2 digits.

## Brand cues from the source

Dark gray #323232 and white storefront; additional #232323 and gray gradient sections. Source CSS specifies Quantico italic for body and Germania One for headings. The actual logo is a metallic-gray cable tie forming a loop around the Pfusch. wordmark on transparent background. Motorcycle, night-ride and workshop culture; washed dark apparel, signs, ziptie logo, reflective/chrome details. The homepage currently says "Day and night" and "can you keep up?". The navy Cord Cap and keychain carry a yellow workshop-spray-inspired label. The main source logo is https://pfusch-clothing.ch/cdn/shop/files/Pfusch_logo_V2.png?v=1753659004.

