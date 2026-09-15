import type { Helmet, Player } from './types';

export const HELMETS = [
  { id: 'fullface', name: 'Full-face' },
  { id: 'motocross', name: 'Motocross' },
] as const satisfies readonly { id: Helmet; name: string }[];

export const HELMET_COLORS = [
  { value: '#d7dbd7', name: 'Chalk' },
  { value: '#202324', name: 'Black' },
  { value: '#69716b', name: 'Slate' },
  { value: '#b8ce47', name: 'Signal' },
  { value: '#366bc0', name: 'Cobalt' },
  { value: '#b83232', name: 'Racing red' },
  { value: '#dc632e', name: 'Burnt orange' },
  { value: '#b6a083', name: 'Sand' },
] as const;

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
