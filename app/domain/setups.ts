import { BIKES, PAINTS, RIMS } from './config.js';
import { isHelmet, isHelmetColor, isVisorColor, unownedHelmetFinishes } from './helmet.js';
import { canEquip, equipmentSlot, validConfiguration } from './preview.js';
import { helmetStickerTarget, isSticker, MAX_STICKERS, validStickerForTarget } from './stickers.js';
import type { Player, PlayerAppearance, Product, SavedSetup, Slot, StickerPlacement } from './types';

export const MAX_SAVED_SETUPS = 8;
export const SETUP_NAME_MAX_LENGTH = 32;
/** Leave space in the 128 KiB cloud request for inventory, history and live decals. */
export const MAX_SAVED_SETUPS_BYTES = 49152;
const slots: Slot[] = ['upper', 'lower', 'head', 'accessory', 'keychain', 'cape', 'collectible', 'bike'];
const appearanceKeys = ['equipped', 'variants', 'customizations', 'bike', 'paint', 'rims', 'helmet', 'helmetColor', 'helmetVisor', 'stickers'];
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasControlCharacter = (value: string) => [...value].some(character => {
  const code = character.charCodeAt(0);
  return code < 32 || code === 127;
});
const identifier = (value: unknown): value is string => typeof value === 'string' &&
  value.length > 0 && value.length <= 80 && !hasControlCharacter(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);
const owns = (player: Player, id: string) => player.ownedItems.includes(id) || player.irlItems.includes(id);
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

export function normalizeSetupName(value: unknown): string {
  if (typeof value !== 'string' || hasControlCharacter(value)) return '';
  const name = value.trim().replace(/\s+/g, ' ');
  return name.length <= SETUP_NAME_MAX_LENGTH ? name : '';
}

function appearance(value: unknown): PlayerAppearance | null {
  if (!record(value) || Object.keys(value).some(key => !appearanceKeys.includes(key)) ||
    !BIKES.some(bike => bike.id === value.bike) || !PAINTS.some(color => color.value === value.paint) ||
    !RIMS.some(color => color.value === value.rims) || !isHelmet(value.helmet) ||
    !isHelmetColor(value.helmetColor) || !isVisorColor(value.helmetVisor) ||
    !record(value.equipped) || Object.keys(value.equipped).length > slots.length ||
    !record(value.variants) || Object.keys(value.variants).length > slots.length ||
    !record(value.customizations) || Object.keys(value.customizations).length > slots.length || !record(value.stickers)) return null;
  const equipped: PlayerAppearance['equipped'] = {};
  for (const [slot, id] of Object.entries(value.equipped)) {
    if (!slots.includes(slot as Slot) || !identifier(id)) return null;
    equipped[slot as Slot] = id;
  }
  const ids = Object.values(equipped);
  const variants: PlayerAppearance['variants'] = {};
  for (const [id, variant] of Object.entries(value.variants)) {
    if (!identifier(id) || !ids.includes(id) || !identifier(variant)) return null;
    variants[id] = variant;
  }
  const customizations: PlayerAppearance['customizations'] = {};
  for (const [id, selection] of Object.entries(value.customizations)) {
    if (!identifier(id) || !ids.includes(id) || !record(selection) ||
      Object.keys(selection).some(key => !['customNumber', 'hoodEnabled'].includes(key))) return null;
    const config: PlayerAppearance['customizations'][string] = {};
    if (selection.customNumber !== undefined) {
      if (typeof selection.customNumber !== 'string' || !/^\d{1,2}$/.test(selection.customNumber)) return null;
      config.customNumber = selection.customNumber;
    }
    if (selection.hoodEnabled !== undefined) {
      if (typeof selection.hoodEnabled !== 'boolean') return null;
      config.hoodEnabled = selection.hoodEnabled;
    }
    customizations[id] = config;
  }
  const targets = [value.bike as string, helmetStickerTarget(value.helmet)];
  if (Object.keys(value.stickers).some(target => !targets.includes(target))) return null;
  const stickers: PlayerAppearance['stickers'] = {};
  for (const target of targets) {
    const placements = value.stickers[target] ?? [];
    if (!Array.isArray(placements) || placements.length > MAX_STICKERS) return null;
    const seen = new Set<string>();
    const copy: StickerPlacement[] = [];
    for (const placement of placements) {
      if (!validStickerForTarget(target, placement) || !identifier(placement.id) ||
        !identifier(placement.productId) || seen.has(placement.id)) return null;
      seen.add(placement.id);
      copy.push({ id: placement.id, productId: placement.productId, surface: placement.surface,
        point: [...placement.point], normal: [...placement.normal], size: placement.size, rotation: placement.rotation });
    }
    stickers[target] = copy;
  }
  return { bike: value.bike as string, paint: value.paint as string, rims: value.rims as string,
    helmet: value.helmet, helmetColor: value.helmetColor, helmetVisor: value.helmetVisor,
    equipped, variants, customizations, stickers };
}

function available(player: Player, selection: PlayerAppearance): boolean {
  const bike = BIKES.find(candidate => candidate.id === selection.bike);
  return !!bike && player.level >= bike.level && owns(player, `bike:${bike.id}`) &&
    owns(player, `paint:${selection.paint}`) && owns(player, `rims:${selection.rims}`) &&
    unownedHelmetFinishes(player, selection).length === 0 &&
    Object.values(selection.equipped).every(id => owns(player, id)) &&
    Object.values(selection.stickers).every(placements => placements.every(sticker => owns(player, sticker.productId)));
}

/** Additive schema-1 migration. Invalid optional setups never erase valid progress. */
export function sanitizeSavedSetups(value: unknown, player: Player): SavedSetup[] {
  if (!Array.isArray(value)) return [];
  const setups: SavedSetup[] = [];
  const seen = new Set<string>();
  for (const input of value.slice(0, MAX_SAVED_SETUPS)) {
    if (!record(input) || Object.keys(input).some(key => !['id', 'name', 'appearance'].includes(key)) ||
      !identifier(input.id) || seen.has(input.id)) continue;
    const name = normalizeSetupName(input.name);
    if (!name) continue;
    const selection = appearance(input.appearance);
    if (!selection || !available(player, selection)) continue;
    const setup = { id: input.id, name, appearance: selection };
    if (bytes([...setups, setup]) > MAX_SAVED_SETUPS_BYTES) continue;
    seen.add(input.id);
    setups.push(setup);
  }
  return setups;
}

/** Capture only committed equipment, never another Player snapshot or a preview. */
export function saveSetup(player: Player, name: string, id: string): Player | null {
  const normalized = normalizeSetupName(name);
  if (!identifier(id) || !normalized) return null;
  const current = player.savedSetups ?? [];
  if (!current.some(setup => setup.id === id) && current.length >= MAX_SAVED_SETUPS) return null;
  const variants: PlayerAppearance['variants'] = {};
  const customizations: PlayerAppearance['customizations'] = {};
  for (const productId of Object.values(player.equipped)) {
    if (player.variants[productId]) variants[productId] = player.variants[productId];
    if (player.customizations[productId]) customizations[productId] = player.customizations[productId];
  }
  const helmetTarget = helmetStickerTarget(player.helmet);
  const selection = appearance({ bike: player.bike, paint: player.paint, rims: player.rims,
    helmet: player.helmet, helmetColor: player.helmetColor, helmetVisor: player.helmetVisor,
    equipped: player.equipped, variants, customizations,
    stickers: { [player.bike]: player.stickers[player.bike] ?? [], [helmetTarget]: player.stickers[helmetTarget] ?? [] } });
  if (!selection || !available(player, selection)) return null;
  const setup: SavedSetup = { id, name: normalized, appearance: selection };
  const savedSetups = current.some(entry => entry.id === id)
    ? current.map(entry => entry.id === id ? setup : entry) : [...current, setup];
  return bytes(savedSetups) <= MAX_SAVED_SETUPS_BYTES ? { ...player, savedSetups } : null;
}

/** Recheck ownership and current catalog before an explicit equip, without spending or granting anything. */
export function applySetup(player: Player, id: string, products: Product[]): Player | null {
  const saved = player.savedSetups.find(setup => setup.id === id);
  const selection = saved ? appearance(saved.appearance) : null;
  if (!selection || !available(player, selection)) return null;
  for (const [slot, productId] of Object.entries(selection.equipped)) {
    const product = products.find(candidate => candidate.id === productId);
    // Old equipped garments may predate remembered variants. Match the garage's
    // first-variant default, but never replace an explicitly saved stale variant.
    const variantId = selection.variants[productId] ?? product?.variants[0]?.id ?? '';
    if (!product || !canEquip(player, product, variantId) || equipmentSlot(product) !== slot ||
      !validConfiguration(product, { productId, variantId,
        ...selection.customizations[productId] })) return null;
    selection.variants[productId] = variantId;
  }
  if (Object.values(selection.stickers).some(placements => placements.some(sticker =>
    !products.some(product => product.id === sticker.productId && isSticker(product))))) return null;
  // Preserve remembered choices for unequipped garments and other motorcycles.
  const customizations = { ...player.customizations };
  for (const productId of Object.values(selection.equipped)) delete customizations[productId];
  return { ...player, ...selection, variants: { ...player.variants, ...selection.variants },
    customizations: { ...customizations, ...selection.customizations },
    stickers: { ...player.stickers, ...selection.stickers } };
}

export function deleteSetup(player: Player, id: string): Player {
  return { ...player, savedSetups: player.savedSetups.filter(setup => setup.id !== id) };
}
