import { ApiError } from '../shopify/auth.js';
import { isRecord } from '../shopify/playerValidation.js';
import type { Player, Product, Slot } from '../../app/domain/types.js';
import catalog from '../../public/catalog/products.json' with { type: 'json' };
import { BIKES, PAINTS, RIMS } from '../../app/domain/config.js';
import { HELMETS, HELMET_COLORS, VISOR_COLORS } from '../../app/domain/helmet.js';
import { PANTS_COLORS, RIDER_COLORS } from '../../app/domain/riderColors.js';
import { productColorKey, ownsProductColor } from '../../app/domain/productOwnership.js';
import { normalizeLeaderboardName } from '../../app/domain/progression.js';
import { STICKER_TARGETS } from '../../app/domain/stickers.js';

const products = catalog as Product[];
const slots: readonly Slot[] = ['upper', 'lower', 'head', 'accessory', 'keychain', 'cape', 'collectible', 'bike'];
const stock = new Map(products.map(product => [product.id, product]));
const allowedOwn = new Set<string>([
  ...BIKES.map(bike => `bike:${bike.id}`),
  ...PAINTS.map(paint => `paint:${paint.value}`),
  ...RIMS.map(rim => `rims:${rim.value}`),
  ...HELMETS.map(helmet => `helmet:${helmet.id}`),
  ...HELMET_COLORS.map(color => `helmetColor:${color.value}`),
  ...VISOR_COLORS.map(color => `helmetVisor:${color.value}`),
  ...products.flatMap(product => [product.id, ...product.variants.map(variant => productColorKey(product, variant.id))].filter(Boolean)),
]);
const starterKeys = new Set(['bike:125', 'paint:#e7e7df', 'rims:#a6acb0',
  'helmet:fullface', 'helmetColor:#d7dbd7', 'helmetVisor:#34454d']);
const palette = (items: readonly { name: string; value: string }[]) => items.map(item => ({ name: item.name, value: item.value }));

/** This catalog is public game content. No Shopify orders, keys or customer data. */
export function adminCosmeticsCatalog() {
  return {
    products: products.map(product => ({ id: product.id, title: product.title, category: product.category,
      variants: [...new Map(product.variants.map(variant => {
        const key = productColorKey(product, variant.id);
        return [key, { key, id: variant.id, title: variant.title, color: variant.baseColor ?? product.baseColor }];
      }).filter(([key]) => Boolean(key)) as [string, { key: string; id: string; title: string; color: string }][]).values()],
    })),
    bikes: BIKES.map(bike => ({ id: bike.id, name: bike.name })),
    paint: palette(PAINTS), rims: palette(RIMS),
    helmets: HELMETS.map(helmet => ({ id: helmet.id, name: helmet.name })),
    helmetColor: palette(HELMET_COLORS), helmetVisor: palette(VISOR_COLORS),
    pantsColor: palette(PANTS_COLORS), shoesColor: palette(RIDER_COLORS),
    slots: [...slots],
  };
}

const assertValue = (condition: boolean) => {
  if (!condition) throw new ApiError(400, 'invalid_cosmetic_change');
};
const exactKeys = (data: Record<string, unknown>, allowed: string[]) =>
  assertValue(Object.keys(data).every(key => allowed.includes(key)));

export type AdminCosmeticEdit =
  | { kind: 'owned'; key: string; owned: boolean }
  | { kind: 'appearance'; key: 'bike' | 'paint' | 'rims' | 'helmet' | 'helmetColor' | 'helmetVisor' | 'pantsColor' | 'shoesColor'; value: string }
  | { kind: 'equip'; slot: Slot; productId: string | null; variantId?: string }
  | { kind: 'resetStickers'; target: string }
  | { kind: 'leaderboardName'; value: string };

export function cosmeticEditSummary(player: Player, raw: unknown): unknown {
  if (!isRecord(raw)) return null;
  if (raw.kind === 'owned' && typeof raw.key === 'string') return player.ownedItems.includes(raw.key);
  if (raw.kind === 'appearance' && typeof raw.key === 'string' && raw.key in player)
    return player[raw.key as keyof Player];
  if (raw.kind === 'equip' && typeof raw.slot === 'string') return player.equipped[raw.slot as Slot] ?? null;
  if (raw.kind === 'resetStickers' && typeof raw.target === 'string') return player.stickers[raw.target]?.length ?? 0;
  if (raw.kind === 'leaderboardName') return player.leaderboardName;
  return null;
}

/** Only the digital snapshot may change. Purchased IRL items, ledgers, reward redemption and customer identity are untouched. */
export function applyAdminCosmeticEdit(player: Player, raw: unknown): Player {
  assertValue(isRecord(raw));
  const input = raw as Record<string, unknown>;
  const next: Player = { ...player, ownedItems: [...player.ownedItems],
    equipped: { ...player.equipped }, variants: { ...player.variants }, stickers: { ...player.stickers } };
  if (input.kind === 'owned') {
    exactKeys(input, ['kind', 'key', 'owned']);
    assertValue(typeof input.key === 'string' && allowedOwn.has(input.key) && typeof input.owned === 'boolean');
    const key = input.key as string;
    if (input.owned) {
      next.ownedItems = [...new Set([...next.ownedItems, key])];
      const product = products.find(p => p.variants.some(v => productColorKey(p, v.id) === key));
      if (product) next.ownedItems = [...new Set([...next.ownedItems, product.id])];
    } else {
      assertValue(!starterKeys.has(key));
      next.ownedItems = next.ownedItems.filter(id => id !== key);
      const product = products.find(p => p.variants.some(v => productColorKey(p, v.id) === key));
      if (product) {
        const remaining = product.variants.some(v => next.ownedItems.includes(productColorKey(product, v.id)));
        if (!remaining) next.ownedItems = next.ownedItems.filter(id => id !== product.id);
      }
      if (product && next.equipped[product.category] === product.id &&
        !ownsProductColor(next, product, next.variants[product.id] ?? product.variants[0]?.id ?? ''))
        delete next.equipped[product.category];
      if (!next.ownedItems.includes(`bike:${next.bike}`)) next.bike = '125';
      if (!next.ownedItems.includes(`paint:${next.paint}`)) next.paint = '#e7e7df';
      if (!next.ownedItems.includes(`rims:${next.rims}`)) next.rims = '#a6acb0';
      if (next.helmet !== 'fullface' && !next.ownedItems.includes(`helmet:${next.helmet}`)) next.helmet = 'fullface';
      if (next.helmetColor !== '#d7dbd7' && !next.ownedItems.includes(`helmetColor:${next.helmetColor}`)) next.helmetColor = '#d7dbd7';
      if (next.helmetVisor !== '#34454d' && !next.ownedItems.includes(`helmetVisor:${next.helmetVisor}`)) next.helmetVisor = '#34454d';
    }
    return next;
  }
  if (input.kind === 'appearance') {
    exactKeys(input, ['kind', 'key', 'value']);
    assertValue(typeof input.key === 'string' && typeof input.value === 'string');
    const value = input.value as string;
    switch (input.key) {
      case 'bike': assertValue(BIKES.some(bike => bike.id === value) && next.ownedItems.includes(`bike:${value}`)); next.bike = value; break;
      case 'paint': assertValue(PAINTS.some(p => p.value === value) && next.ownedItems.includes(`paint:${value}`)); next.paint = value; break;
      case 'rims': assertValue(RIMS.some(p => p.value === value) && next.ownedItems.includes(`rims:${value}`)); next.rims = value; break;
      case 'helmet': assertValue(HELMETS.some(p => p.id === value) && (value === 'fullface' || next.ownedItems.includes(`helmet:${value}`))); next.helmet = value as Player['helmet']; break;
      case 'helmetColor': assertValue(HELMET_COLORS.some(p => p.value === value) && (value === '#d7dbd7' || next.ownedItems.includes(`helmetColor:${value}`))); next.helmetColor = value; break;
      case 'helmetVisor': assertValue(VISOR_COLORS.some(p => p.value === value) && (value === '#34454d' || next.ownedItems.includes(`helmetVisor:${value}`))); next.helmetVisor = value; break;
      case 'pantsColor': assertValue(PANTS_COLORS.some(p => p.value === value)); next.pantsColor = value; break;
      case 'shoesColor': assertValue(RIDER_COLORS.some(p => p.value === value)); next.shoesColor = value; break;
      default: throw new ApiError(400, 'invalid_cosmetic_change');
    }
    return next;
  }
  if (input.kind === 'equip') {
    exactKeys(input, ['kind', 'slot', 'productId', 'variantId']);
    assertValue(typeof input.slot === 'string' && slots.includes(input.slot as Slot));
    const slot = input.slot as Slot;
    if (input.productId === null) { delete next.equipped[slot]; return next; }
    assertValue(typeof input.productId === 'string');
    const product = stock.get(input.productId as string);
    assertValue(Boolean(product) && product?.category === slot && typeof input.variantId === 'string');
    if (!product || typeof input.variantId !== 'string') throw new ApiError(400, 'invalid_cosmetic_change');
    assertValue(product.variants.some(v => v.id === input.variantId) && ownsProductColor(next, product, input.variantId));
    next.equipped[slot] = product.id;
    next.variants[product.id] = input.variantId;
    return next;
  }
  if (input.kind === 'resetStickers') {
    exactKeys(input, ['kind', 'target']);
    assertValue(typeof input.target === 'string' && STICKER_TARGETS.includes(input.target));
    next.stickers[input.target as string] = [];
    return next;
  }
  if (input.kind === 'leaderboardName') {
    exactKeys(input, ['kind', 'value']);
    assertValue(typeof input.value === 'string' && input.value.length <= 24 &&
      (!input.value.trim() || Boolean(normalizeLeaderboardName(input.value))));
    next.leaderboardName = normalizeLeaderboardName(input.value);
    return next;
  }
  throw new ApiError(400, 'invalid_cosmetic_change');
}
