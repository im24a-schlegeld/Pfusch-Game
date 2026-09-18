import catalog from '../../public/catalog/products.json';
import type { Product } from './types';

/** sRGB channel values, one non-destructive 5% adjustment at catalog loading. */
export function darkenClothingColor(value: string): string {
  if (!/^#[\da-f]{6}$/i.test(value)) return value;
  return '#' + [1, 3, 5].map(i =>
    Math.round(parseInt(value.slice(i, i + 2), 16) * 0.95)
      .toString(16).padStart(2, '0'),
  ).join('');
}
export function isWearableProduct(product: Pick<Product, 'category'>) {
  return ['upper', 'lower', 'head', 'accessory'].includes(product.category);
}
/** Do not mutate catalog input, variant identities, photographs, or print ink. */
export function shadeClothingCatalog(products: readonly Product[]): Product[] {
  return products.map(p => !isWearableProduct(p) ? p : ({
    ...p,
    baseColor: darkenClothingColor(p.baseColor),
    variants: p.variants.map(v => ({ ...v, ...(v.baseColor
      ? { baseColor: darkenClothingColor(v.baseColor) } : {}) })),
    ...(p.preview ? { preview: {
      ...p.preview,
      colors: p.preview.colors.map(c => ({ ...c, baseColor: darkenClothingColor(c.baseColor) })),
    }} : {}),
  }));
}
export interface AppearanceColor { name: string; value: string }
const BASIC_COLORS: AppearanceColor[] = [
  { name: 'Schwarz', value: '#181818' },
  { name: 'Weiss', value: '#eeeeee' },
  { name: 'Grau', value: '#757575' },
  { name: 'Silber', value: '#a6acb0' },
  { name: 'Rot', value: '#b83232' },
  { name: 'Orange', value: '#dc632e' },
  { name: 'Gelb', value: '#d7bb43' },
  { name: 'Grün', value: '#3e6650' },
  { name: 'Blau', value: '#366bc0' },
  { name: 'Violett', value: '#7461a5' },
  { name: 'Rosa', value: '#c982a3' },
  { name: 'Braun', value: '#84624c' },
];
// Preserve older saved appearances. Every non-clothing picker uses the SAME set.
const LEGACY_COLORS: AppearanceColor[] = [
  { name: 'Hell', value: '#e7e7df' }, { name: 'Asphalt', value: '#323638' },
  { name: 'Signal', value: '#d9f365' }, { name: 'Kobalt', value: '#627dac' },
  { name: 'Eisblau', value: '#8ab9cf' }, { name: 'Tanne', value: '#3e5c52' },
  { name: 'Sand', value: '#b6a083' }, { name: 'Dunkel', value: '#24282b' },
  { name: 'Bronze', value: '#967847' }, { name: 'Kreide', value: '#d7dbd7' },
  { name: 'Graphit', value: '#202324' }, { name: 'Schiefer', value: '#69716b' },
  { name: 'Limette', value: '#b8ce47' },
];
function catalogColors(products: readonly Product[]): AppearanceColor[] {
  const result: AppearanceColor[] = [];
  for (const p of products) {
    if (!isWearableProduct(p)) continue;
    result.push({ name: p.title, value: darkenClothingColor(p.baseColor) });
    if (p.preview?.colors.length) {
      for (const c of p.preview.colors) result.push({
        value: darkenClothingColor(c.baseColor), name: c.label === 'Original' ? p.title : c.label,
      });
    }
    for (const v of p.variants) if (v.baseColor) result.push({
      name: v.options?.[0] || p.title, value: darkenClothingColor(v.baseColor),
    });
  }
  return result;
}
export const APPEARANCE_COLORS: readonly AppearanceColor[] = Object.freeze(
  [...new Map([...catalogColors(catalog as Product[]), ...BASIC_COLORS, ...LEGACY_COLORS]
    .filter(c => /^#[\da-f]{6}$/i.test(c.value))
    .map(c => [c.value.toLowerCase(), { ...c, value: c.value.toLowerCase() }])).values()],
);
export function pricedAppearanceColors(
  previous: readonly (AppearanceColor & { price: number })[], price: number,
) {
  return APPEARANCE_COLORS.map(c => ({
    ...c, price: previous.find(p => p.value.toLowerCase() === c.value)?.price ?? price,
  }));
}
