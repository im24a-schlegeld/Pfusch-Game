import type { Helmet, Player, Product, StickerPlacement } from './types';
import { BIKES } from './config.js';
import { HELMETS } from './helmet.js';
import { digitalPrice } from './progression.js';

export const MAX_STICKERS = 8;
/** New workshop placements start at 9 cm; existing saved sizes stay unchanged. */
export const DEFAULT_STICKER_SIZE = 0.09;
export const helmetStickerTarget = (helmet: Helmet) => `helmet:${helmet}`;
export const STICKER_TARGETS = [...BIKES.map((bike) => bike.id), ...HELMETS.map((helmet) => helmetStickerTarget(helmet.id))];
export const isHelmetStickerTarget = (target: string) => HELMETS.some((helmet) => helmetStickerTarget(helmet.id) === target);
export const stickerMaxSize = (target: string) => isHelmetStickerTarget(target) ? 0.16 : 0.4;
export const ownsStickerTarget = (player: Player, target: string) =>
  isHelmetStickerTarget(target) || (STICKER_TARGETS.includes(target) && player.ownedItems.includes(`bike:${target}`));
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
/** Schema 1 keeps the existing placement shape; helmet lists have separate keys. */
export function validStickerForTarget(target: string, value: unknown): value is StickerPlacement {
  if (!STICKER_TARGETS.includes(target) || !validSticker(value) || value.size > stickerMaxSize(target)) return false;
  return isHelmetStickerTarget(target)
    ? value.surface.startsWith(`helmet/${target.slice('helmet:'.length)}/`)
    : !value.surface.startsWith('helmet/');
}
/** New placement identities cost one unit each; editing the same copy stays free. */
export function stickerEditPrice(player: Player, drafts: Record<string, StickerPlacement[]>, products: Product[]): number | null {
  let total = 0;
  for (const [target, placements] of Object.entries(drafts)) {
    if (!ownsStickerTarget(player, target) || placements.length > MAX_STICKERS ||
      new Set(placements.map(placement => placement.id)).size !== placements.length) return null;
    for (const placement of placements) {
      const product = products.find(product => product.id === placement.productId && isSticker(product));
      if (!product || !validStickerForTarget(target, placement)) return null;
      const existing = player.stickers[target]?.some(saved => saved.id === placement.id && saved.productId === placement.productId);
      if (!existing) total += digitalPrice(product);
    }
  }
  return total;
}
/** Only an explicit save commits placements; previews may use locked shop items. */
export function saveStickers(player: Player, target: string, placements: StickerPlacement[], products: Product[]): Player | null {
  if (!ownsStickerTarget(player, target) || placements.length > MAX_STICKERS ||
    new Set(placements.map((p) => p.id)).size !== placements.length ||
    !placements.every((p) => validStickerForTarget(target, p) && products.some((product) => product.id === p.productId && isSticker(product)) &&
      (player.ownedItems.includes(p.productId) || player.irlItems.includes(p.productId)))) return null;
  return { ...player, stickers: { ...player.stickers, [target]: structuredClone(placements) } };
}
/** A workshop can edit bike and helmet together; either every draft saves or none. */
export function saveStickerTargets(player: Player, drafts: Record<string, StickerPlacement[]>, products: Product[]): Player | null {
  let next = player;
  for (const [target, placements] of Object.entries(drafts)) {
    const saved = saveStickers(next, target, placements, products);
    if (!saved) return null;
    next = saved;
  }
  return next;
}
