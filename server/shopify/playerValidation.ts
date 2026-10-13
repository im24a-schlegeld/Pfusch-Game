import type { Player, Slot, StickerPlacement } from '../../app/domain/types.js';
import { levelForXp, newPlayer, normalizeLeaderboardName, refreshDaily } from '../../app/domain/progression.js';
import { MAX_STICKERS, STICKER_TARGETS, validStickerForTarget } from '../../app/domain/stickers.js';
import { BIKES, REWARDS } from '../../app/domain/config.js';
import { DARK_CARBON } from '../../app/domain/carbon.js';
import { MAX_SAVED_SETUPS, MAX_SAVED_SETUPS_BYTES, sanitizeSavedSetups } from '../../app/domain/setups.js';
import { isTutorialHint, normalizeTutorialHints, TUTORIAL_HINTS } from '../../app/domain/tutorial.js';
import { ApiError } from './auth.js';
import catalog from '../../public/catalog/products.json';
import type { Product } from '../../app/domain/types.js';
import { migrateProductInventory, ownsProductColor } from '../../app/domain/productOwnership.js';
import { migrateHelmetInventory } from '../../app/domain/helmet.js';

export const MAX_BODY_BYTES = 131072;
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const invalid = (): never => { throw new ApiError(400, 'invalid_player'); };
const numeric = (value: unknown, max = 1e12): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : invalid();
function text(value: unknown, max = 160): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || [...value].some(character => character.charCodeAt(0) < 32)) invalid();
  return value as string;
}
function stringList(value: unknown, max: number) {
  if (!Array.isArray(value) || value.length > max) invalid();
  return [...new Set((value as unknown[]).map(item => text(item)))];
}
function record(value: unknown, max: number): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).length > max) invalid();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) invalid();
  for (const key of Object.keys(result)) text(key);
  return result;
}
function date(value: unknown) {
  const result = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result)) ||
    new Date(result).toISOString().slice(0, 10) !== result) invalid();
  return result;
}
const slots: Slot[] = ['upper', 'lower', 'head', 'accessory', 'keychain', 'cape', 'collectible', 'bike'];
const digitalRewards = new Set<string>(REWARDS.filter(reward => reward.kind === 'coins' || reward.kind === 'cosmetic').map(reward => reward.id));

/** This is a backup of untrusted digital game progress, never proof of a
 * purchase, a prize entitlement, or a verified competitive score. Reconstruct
 * every field rather than persisting arbitrary client properties. */
export function sanitizeDigitalPlayer(value: unknown, customerId: string, verifiedItems: string[] = []): Player {
  const input = record(value, 33), player = newPlayer();
  if (input.version !== 1 || Object.keys(input).some(key => !Object.prototype.hasOwnProperty.call(player, key))) invalid();
  player.id = `shopify:${customerId}`;
  if (input.leaderboardName !== undefined) {
    const name = normalizeLeaderboardName(input.leaderboardName);
    if (typeof input.leaderboardName !== 'string' || (input.leaderboardName.trim() && !name)) invalid();
    player.leaderboardName = name;
  }
  for (const field of ['xp', 'coins', 'highScore', 'totalDistance', 'runsPlayed', 'totalNearMisses', 'totalWheelieMeters'] as const)
    player[field] = numeric(input[field]);
  if (!Number.isInteger(player.runsPlayed)) invalid();
  player.level = levelForXp(player.xp);
  player.ownedItems = stringList(input.ownedItems, 500).filter(id => !id.startsWith('decal:'));
  // IRL ownership and redeemable balances must come from a separate trusted
  // purchase/reward adapter. They are never imported from this digital backup.
  stringList(input.irlItems, 500);
  numeric(input.tickets);
  player.irlItems = [...verifiedItems]; player.tickets = 0;
  player.redeemedRewards = stringList(input.redeemedRewards, 100).filter(id => digitalRewards.has(id));
  player.processedRuns = stringList(input.processedRuns, 100);
  const bikeId = text(input.bike);
  if (!BIKES.some(bike => bike.id === bikeId)) invalid();
  player.bike = bikeId;
  for (const field of ['paint', 'rims', 'helmetColor', 'helmetVisor'] as const) {
    if (input[field] === undefined && ['helmetColor', 'helmetVisor'].includes(field)) continue;
    const color = text(input[field], 32);
    // Carbon is a digital inventory finish, not a hex color. Keep the same
    // ownership requirement as the client so equipped finishes survive backup.
    if (color === DARK_CARBON) {
      if (!player.ownedItems.includes(`${field}:${DARK_CARBON}`)) invalid();
    } else if (!/^#[a-f0-9]{6}$/i.test(color)) invalid();
    player[field] = color;
  }
  if (input.helmet !== undefined) {
    if (input.helmet !== 'fullface' && input.helmet !== 'motocross') invalid();
    player.helmet = input.helmet as Player['helmet'];
  }
  const equipped = record(input.equipped, slots.length);
  for (const [key, item] of Object.entries(equipped)) {
    if (!slots.includes(key as Slot)) invalid();
    const id = text(item);
    if (player.ownedItems.includes(id) || player.irlItems.includes(id)) player.equipped[key as Slot] = id;
  }
  for (const [id, variant] of Object.entries(record(input.variants, 500))) player.variants[id] = text(variant);
  player.ownedItems = migrateProductInventory(migrateHelmetInventory(player), catalog as Product[]).ownedItems;
  for (const [slot, id] of Object.entries(player.equipped)) {
    const product = (catalog as Product[]).find(product => product.id === id);
    if (product && !ownsProductColor(player, product, player.variants[id] ?? product.variants[0]?.id ?? '')) delete player.equipped[slot as Slot];
  }
  if (input.customizations !== undefined)
    for (const [id, value] of Object.entries(record(input.customizations, 500))) {
      const config = record(value, 2);
      if (Object.keys(config).some(key => !['customNumber', 'hoodEnabled'].includes(key))) invalid();
      const selection: Player['customizations'][string] = {};
      if (config.customNumber !== undefined) {
        if (typeof config.customNumber !== 'string' || !/^\d{1,2}$/.test(config.customNumber)) invalid();
        selection.customNumber = config.customNumber as string;
      }
      if (config.hoodEnabled !== undefined) {
        if (typeof config.hoodEnabled !== 'boolean') invalid();
        selection.hoodEnabled = config.hoodEnabled as boolean;
      }
      player.customizations[id] = selection;
    }
  if (input.stickers !== undefined)
    for (const [target, value] of Object.entries(record(input.stickers, STICKER_TARGETS.length))) {
      if (!STICKER_TARGETS.includes(target) || !Array.isArray(value) || value.length > MAX_STICKERS) invalid();
      const placements: StickerPlacement[] = [];
      for (const item of value as unknown[]) {
        if (!validStickerForTarget(target, item)) invalid();
        const s = item as StickerPlacement;
        if (!player.ownedItems.includes(s.productId) && !player.irlItems.includes(s.productId)) continue;
        if (placements.some(placement => placement.id === s.id)) invalid();
        placements.push({ id: s.id, productId: s.productId, surface: s.surface,
          point: [...s.point], normal: [...s.normal], size: s.size, rotation: s.rotation });
      }
      player.stickers[target] = placements;
    }
  const challenges = record(input.challenges, 3);
  const values: Record<string, number> = {};
  for (const [key, value] of Object.entries(record(challenges.values, 40))) values[key] = numeric(value);
  player.challenges = { date: date(challenges.date), values, claimed: stringList(challenges.claimed, 40) };
  const settings = record(input.settings, 6);
  if (Object.keys(settings).some(key => !['muted', 'reducedMotion', 'tutorialSeen', 'quality', 'tutorialHintsSeen', 'touchControls'].includes(key))) invalid();
  for (const field of ['muted', 'reducedMotion', 'tutorialSeen'] as const) {
    if (typeof settings[field] !== 'boolean') invalid();
    player.settings[field] = settings[field] as boolean;
  }
  if (settings.quality !== 'auto' && settings.quality !== 'low') invalid();
  player.settings.quality = settings.quality as Player['settings']['quality'];
  // Optional only for older schema-1 snapshots; explicit values must be supported touch modes.
  if (settings.touchControls !== undefined) {
    if (settings.touchControls !== 'swipe' && settings.touchControls !== 'buttons') invalid();
    player.settings.touchControls = settings.touchControls as Player['settings']['touchControls'];
  } else player.settings.touchControls = 'swipe';
  // Optional only for older schema-1 snapshots; server writes accept exactly the shipped lesson IDs.
  if (settings.tutorialHintsSeen !== undefined) {
    if (!Array.isArray(settings.tutorialHintsSeen) || settings.tutorialHintsSeen.length > TUTORIAL_HINTS.length ||
      !settings.tutorialHintsSeen.every(isTutorialHint)) invalid();
    player.settings.tutorialHintsSeen = normalizeTutorialHints(settings.tutorialHintsSeen);
  }
  if (!Array.isArray(input.history) || input.history.length > 200) invalid();
  player.history = (input.history as unknown[]).map(value => {
    const entry = record(value, 2);
    return { score: numeric(entry.score), date: date(entry.date) };
  });
  // Additive v1 migration: absent libraries stay empty. Bound nested cosmetics,
  // then reconstruct them without trusting embedded inventory or progress.
  if (input.savedSetups !== undefined) {
    if (!Array.isArray(input.savedSetups) || input.savedSetups.length > MAX_SAVED_SETUPS ||
      new TextEncoder().encode(JSON.stringify(input.savedSetups)).length > MAX_SAVED_SETUPS_BYTES) invalid();
    player.savedSetups = sanitizeSavedSetups(input.savedSetups, player);
  }
  return refreshDaily(player, player.challenges.date);
}
