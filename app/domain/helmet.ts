import type { Helmet, Player } from './types';
import { APPEARANCE_COLORS } from './appearanceColors';

export const HELMETS = [
  { id: 'fullface', name: 'Integralhelm' },
  { id: 'motocross', name: 'Motocross' },
] as const satisfies readonly { id: Helmet; name: string }[];

export const HELMET_COLORS = APPEARANCE_COLORS;

export const DEFAULT_HELMET: Helmet = 'fullface';
export const DEFAULT_HELMET_COLOR = '#d7dbd7';

export const isHelmet = (value: unknown): value is Helmet =>
  HELMETS.some((helmet) => helmet.id === value);
export const isHelmetColor = (value: unknown): value is string =>
  HELMET_COLORS.some((color) => color.value === value);

/** Stock helmets are free. Commit only their fields from a temporary loadout. */
export function equipHelmet(
  player: Player,
  selection: Pick<Player, 'helmet' | 'helmetColor'>,
): Player | null {
  if (!isHelmet(selection.helmet) || !isHelmetColor(selection.helmetColor))
    return null;
  return {
    ...player,
    helmet: selection.helmet,
    helmetColor: selection.helmetColor,
  };
}
