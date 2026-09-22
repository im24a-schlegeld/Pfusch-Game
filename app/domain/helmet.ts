import type { Helmet, Player } from './types';
import { APPEARANCE_COLORS } from './appearanceColors';

export const HELMETS = [
  { id: 'fullface', name: 'Integralhelm' },
  { id: 'motocross', name: 'Motocross' },
] as const satisfies readonly { id: Helmet; name: string }[];

export const HELMET_COLORS = [
  { name: 'Kreide (Original)', value: '#d7dbd7' },
  { name: 'Schwarz (Original)', value: '#202324' },
  ...APPEARANCE_COLORS.filter((color) => !['#d7dbd7', '#202324'].includes(color.value)),
];

export const DEFAULT_HELMET: Helmet = 'fullface';
export const DEFAULT_HELMET_COLOR = '#d7dbd7';
export const VISOR_COLORS = [
  { name: 'Klar / Silber', value: '#b8ced2' },
  { name: 'Rauchgrau', value: '#34454d' },
  { name: 'Dunkel', value: '#111b23' },
  { name: 'Blau verspiegelt', value: '#287a9d' },
  { name: 'Gold verspiegelt', value: '#9b792f' },
] as const;
export const DEFAULT_VISOR_COLOR = '#34454d';
export const isVisorColor = (value: unknown): value is string =>
  VISOR_COLORS.some((color) => color.value === value);

export const isHelmet = (value: unknown): value is Helmet =>
  HELMETS.some((helmet) => helmet.id === value);
export const isHelmetColor = (value: unknown): value is string =>
  HELMET_COLORS.some((color) => color.value === value);

/** Stock helmets are free. Commit only their fields from a temporary loadout. */
export function equipHelmet(
  player: Player,
  selection: Pick<Player, 'helmet' | 'helmetColor'> & Partial<Pick<Player, 'helmetVisor'>>,
): Player | null {
  if (!isHelmet(selection.helmet) || !isHelmetColor(selection.helmetColor) ||
    (selection.helmetVisor !== undefined && !isVisorColor(selection.helmetVisor)))
    return null;
  return {
    ...player,
    helmet: selection.helmet,
    helmetColor: selection.helmetColor,
    helmetVisor: selection.helmetVisor ?? player.helmetVisor,
  };
}
