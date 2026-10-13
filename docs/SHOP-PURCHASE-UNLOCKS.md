# Shop purchases in the garage

The authenticated player endpoint reads Shopify orders on the server and returns a separate `purchases` result. Browser saves, guest imports and stored `irlItems` never prove a purchase. Digital backups continue to store `irlItems: []`; the order adapter rebuilds real ownership before loading or saving equipment.

Only paid or partially refunded, non-test and non-cancelled orders count. A line item must still have `currentQuantity > 0`, which excludes refunded or removed units. Both orders and line items are paginated. Every additional order query checks the authenticated customer's ID. The browser receives only catalog product/color inventory keys and a fixed sync status, never order details or addresses.

The Shopify app needs `read_orders`. Reading orders older than 60 days also needs Shopify's approved `read_all_orders` access. Without it, the garage explicitly reports that only recent purchases were checked; the implementation does not claim complete purchase history. Missing permissions and order-query failures have an independent status and never block digital game saves. The server keeps a bounded, one-minute read cache to avoid a new order scan for each garage edit.

References: [Shopify order access](https://shopify.dev/docs/api/admin-graphql/latest/objects/Order), [LineItem currentQuantity](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/LineItem).

Digital and real purchases unlock the selected shop color, including sizes of that same color. Color keys use stable Shopify product and variant IDs as strings. Additive schema-1 migration keeps a legacy digital item's remembered color (or its first catalog color), not every color. Existing equipped helmet options are preserved once with the `helmet:priced-v1` inventory marker.

The integral helmet, chalk finish and smoke visor are free. Motocross costs 150 Coins, additional normal helmet colors 40, and additional visor tints 60. Dark carbon for the helmet remains 1,000 Coins. All selections support free previews; only explicit Equip commits the complete price and loadout together.
