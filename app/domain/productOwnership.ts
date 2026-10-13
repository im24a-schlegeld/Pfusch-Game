import type { Player, Product } from './types';

/** Sizes share a cosmetic color. Keys retain Shopify variant IDs as strings. */
export function productColorKey(product: Product, variantId: string): string {
  const variant = product.variants.find(item => item.id === variantId);
  if (!variant) return '';
  const mapped = product.preview?.colors.find(color => color.variantIds.includes(variantId));
  const option = product.options.findIndex(item => /farbe|colou?r|couleur/i.test(item.name));
  const representative = mapped?.variantIds[0] ?? (option < 0 ? product.variants[0]?.id
    : product.variants.find(item => item.options[option] === variant.options[option])?.id);
  return representative ? `product:${product.id}:color:${representative}` : '';
}

export function ownsProductColor(player: Player, product: Product, variantId: string, inventory = [...player.ownedItems, ...player.irlItems]): boolean {
  const key = productColorKey(product, variantId);
  if (!key) return false;
  if (inventory.includes(key)) return true;
  if (!inventory.includes(product.id) || inventory.some(id => id.startsWith(`product:${product.id}:color:`))) return false;
  // Explicit schema-1 migration: a former product-wide purchase keeps its last
  // equipped color (or the first shop color), never every other color.
  return key === productColorKey(product, player.variants[product.id] ?? product.variants[0]?.id ?? '');
}

export function migrateProductInventory(player: Player, products: readonly Product[]): Player {
  const ownedItems = [...player.ownedItems];
  for (const product of products) {
    if (!ownedItems.includes(product.id) || ownedItems.some(id => id.startsWith(`product:${product.id}:color:`))) continue;
    if (new Set(product.variants.map(variant => productColorKey(product, variant.id))).size <= 1) continue;
    const key = productColorKey(product, player.variants[product.id] ?? product.variants[0]?.id ?? '');
    if (key) ownedItems.push(key);
  }
  return ownedItems.length === player.ownedItems.length ? player : { ...player, ownedItems };
}

export function purchaseProductColor(player: Player, product: Product, variantId: string, price: number, level: number): Player | null {
  if (ownsProductColor(player, product, variantId)) return player;
  const key = productColorKey(product, variantId);
  if (!key || !Number.isFinite(price) || price < 0 || player.coins < price || player.level < level) return null;
  const migrated = migrateProductInventory(player, [product]);
  return { ...migrated, coins: migrated.coins - price,
    ownedItems: [...new Set([...migrated.ownedItems, product.id, key])] };
}
