import type { Player, Product, StickerPlacement } from './types';

export const MAX_STICKERS = 8;
export const isSticker = (p: Product) => p.handle === 'chrome-sticker';
const triple = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 20);
export function validSticker(v: unknown): v is StickerPlacement {
  if (!v || typeof v !== 'object') return false;
  const s = v as StickerPlacement;
  return typeof s.id === 'string' && s.id.length <= 80 &&
    typeof s.productId === 'string' && s.productId.length <= 80 &&
    typeof s.surface === 'string' && s.surface.length > 0 && s.surface.length < 300 &&
    triple(s.point) && triple(s.normal) && Math.hypot(...s.normal) > 0.9 && Math.hypot(...s.normal) < 1.1 &&
    Number.isFinite(s.size) && s.size >= 0.04 && s.size <= 0.4 &&
    Number.isFinite(s.rotation) && Math.abs(s.rotation) <= Math.PI * 2;
}
/** Only an explicit save commits placements; previews may use locked shop items. */
export function saveStickers(player: Player, bike: string, placements: StickerPlacement[], products: Product[]): Player | null {
  if (!player.ownedItems.includes(`bike:${bike}`) || placements.length > MAX_STICKERS ||
    new Set(placements.map((p) => p.id)).size !== placements.length ||
    !placements.every((p) => validSticker(p) && products.some((product) => product.id === p.productId && isSticker(product)) &&
      (player.ownedItems.includes(p.productId) || player.irlItems.includes(p.productId)))) return null;
  return { ...player, stickers: { ...player.stickers, [bike]: structuredClone(placements) } };
}
