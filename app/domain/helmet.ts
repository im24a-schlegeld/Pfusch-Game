import type { Helmet, Player } from './types';
import { APPEARANCE_COLORS } from './appearanceColors.js';
import { CARBON_FINISH, CARBON_PRICE, DARK_CARBON } from './carbon.js';
import { colorName } from './paletteView.js';
import { unlock } from './progression.js';

export const HELMETS = [
  { id: 'fullface', name: 'Integralhelm', price: 0 },
  { id: 'motocross', name: 'Motocross', price: 150 },
] as const satisfies readonly { id: Helmet; name: string; price: number }[];

export const HELMET_COLORS = [
  { name: 'Kreide', value: '#d7dbd7' },
  { name: 'Nachtschwarz', value: '#202324' },
  ...APPEARANCE_COLORS.filter((color) => !['#d7dbd7', '#202324'].includes(color.value))
    .map(color => ({ ...color, name: colorName(color.value) })),
  { name: 'Neongelb', value: '#f1ef25' },
  { name: 'Neonlimette', value: '#98ee28' },
  { name: 'Türkis', value: '#22cbd0' },
  { name: 'Signalblau', value: '#2854ee' },
  { name: 'Violett', value: '#ae37e5' },
  { name: 'Signalpink', value: '#f23ca0' },
  CARBON_FINISH,
];

export const DEFAULT_HELMET: Helmet = 'fullface';
export const DEFAULT_HELMET_COLOR = '#d7dbd7';
export const VISOR_COLORS = [
  { name: 'Klar / Silber', value: '#b8ced2' },
  { name: 'Rauchgrau', value: '#34454d' },
  { name: 'Dunkel', value: '#111b23' },
  { name: 'Blau verspiegelt', value: '#287a9d' },
  { name: 'Gold verspiegelt', value: '#9b792f' },
  CARBON_FINISH,
] as const;
export const DEFAULT_VISOR_COLOR = '#34454d';
export const isVisorColor = (value: unknown): value is string =>
  VISOR_COLORS.some((color) => color.value === value);

export const isHelmet = (value: unknown): value is Helmet =>
  HELMETS.some((helmet) => helmet.id === value);
export const isHelmetColor = (value: unknown): value is string =>
  HELMET_COLORS.some((color) => color.value === value);

export const HELMET_INVENTORY_MIGRATION = 'helmet:priced-v1';
export function helmetOptionPrice(slot: 'helmet' | 'helmetColor' | 'helmetVisor', value: string): number {
  if (slot === 'helmet') return HELMETS.find(item => item.id === value)?.price ?? 0;
  if (value === DARK_CARBON) return CARBON_PRICE;
  return value === (slot === 'helmetColor' ? DEFAULT_HELMET_COLOR : DEFAULT_VISOR_COLOR) ? 0 : slot === 'helmetColor' ? 40 : 60;
}
export function ownsHelmetOption(player: Player, slot: 'helmet' | 'helmetColor' | 'helmetVisor', value: string): boolean {
  return helmetOptionPrice(slot, value) === 0 || player.ownedItems.includes(`${slot}:${value}`);
}
export function unownedHelmetFinishes(player: Player, selection: { helmet?: Helmet; helmetColor: string; helmetVisor?: string }) {
  return (['helmet', 'helmetColor', 'helmetVisor'] as const)
    .filter(slot => selection[slot] !== undefined && !ownsHelmetOption(player, slot, selection[slot]!))
    .map(slot => ({ id: `${slot}:${selection[slot]}`, price: helmetOptionPrice(slot, selection[slot]!) }));
}

/** Additive schema-1 migration preserves already committed equipment once. */
export function migrateHelmetInventory(player: Player): Player {
  if (player.ownedItems.includes(HELMET_INVENTORY_MIGRATION)) return player;
  const grants = unownedHelmetFinishes(player, player).filter(item => !item.id.endsWith(`:${DARK_CARBON}`));
  return { ...player, ownedItems: [...player.ownedItems, HELMET_INVENTORY_MIGRATION, ...grants.map(item => item.id)] };
}

/** The free base helmet and all paid options commit atomically on explicit Equip. */
export function equipHelmet(
  player: Player,
  selection: Pick<Player, 'helmet' | 'helmetColor'> & Partial<Pick<Player, 'helmetVisor'>>,
): Player | null {
  if (!isHelmet(selection.helmet) || !isHelmetColor(selection.helmetColor) ||
    (selection.helmetVisor !== undefined && !isVisorColor(selection.helmetVisor)))
    return null;
  const purchases = unownedHelmetFinishes(player, selection);
  if (player.coins < purchases.reduce((total, item) => total + item.price, 0) || (purchases.length > 0 && player.level < 1)) return null;
  let purchased = player;
  for (const { id, price } of purchases) {
    const next = unlock(purchased, id, price);
    if (!next) return null;
    purchased = next;
  }
  return {
    ...purchased,
    helmet: selection.helmet,
    helmetColor: selection.helmetColor,
    helmetVisor: selection.helmetVisor ?? player.helmetVisor,
  };
}
