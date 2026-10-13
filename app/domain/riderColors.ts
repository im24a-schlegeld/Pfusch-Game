export const DEFAULT_PANTS_COLOR = '#242d31';
export const DEFAULT_SHOES_COLOR = '#e6e4dd';
/** Free digital wardrobe colours; no shop variants or carbon entitlement. */
export const RIDER_COLORS = [
  { value: DEFAULT_PANTS_COLOR, name: 'Anthrazit' },
  { value: '#141c20', name: 'Schwarz' },
  { value: DEFAULT_SHOES_COLOR, name: 'Weiss' },
  { value: '#7a8389', name: 'Grau' },
  { value: '#c7ad85', name: 'Sand' },
  { value: '#6e7856', name: 'Oliv' },
  { value: '#315877', name: 'Dunkelblau' },
  { value: '#627dac', name: 'Blau' },
  { value: '#7461a5', name: 'Violett' },
  { value: '#b83232', name: 'Rot' },
  { value: '#dc632e', name: 'Orange' },
  { value: '#d1b345', name: 'Gelb' },
] as const;

export function isRiderColor(value: unknown): value is string {
  return typeof value === 'string' && RIDER_COLORS.some(color => color.value === value);
}
export function getPantsColor(player: { pantsColor?: string }) {
  return isRiderColor(player.pantsColor) ? player.pantsColor : DEFAULT_PANTS_COLOR;
}
export function getShoesColor(player: { shoesColor?: string }) {
  return isRiderColor(player.shoesColor) ? player.shoesColor : DEFAULT_SHOES_COLOR;
}
