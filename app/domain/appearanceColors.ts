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

type NamedColor = AppearanceColor & { source: 'catalog' | 'basic' | 'legacy' };

const BASIC_COLORS: readonly NamedColor[] = [
  { name: 'Tiefschwarz', value: '#181818', source: 'basic' },
  { name: 'Polarweiß', value: '#eeeeee', source: 'basic' },
  { name: 'Graphit', value: '#757575', source: 'basic' },
  { name: 'Silber', value: '#a6acb0', source: 'basic' },
  { name: 'Rennrot', value: '#b83232', source: 'basic' },
  { name: 'Mandarine', value: '#dc632e', source: 'basic' },
  { name: 'Sonnengelb', value: '#d7bb43', source: 'basic' },
  { name: 'Tannengrün', value: '#3e6650', source: 'basic' },
  { name: 'Royalblau', value: '#366bc0', source: 'basic' },
  { name: 'Amethyst', value: '#7461a5', source: 'basic' },
  { name: 'Mauve', value: '#c982a3', source: 'basic' },
  { name: 'Walnuss', value: '#84624c', source: 'basic' },
];
const LEGACY_COLORS: readonly NamedColor[] = [
  { name: 'Kreide', value: '#e7e7df', source: 'legacy' },
  { name: 'Asphalt', value: '#323638', source: 'legacy' },
  { name: 'Kobalt', value: '#627dac', source: 'legacy' },
  { name: 'Eisblau', value: '#8ab9cf', source: 'legacy' },
  { name: 'Tanne', value: '#3e5c52', source: 'legacy' },
  { name: 'Sandstein', value: '#b6a083', source: 'legacy' },
  { name: 'Bronze', value: '#967847', source: 'legacy' },
  { name: 'Schiefer', value: '#69716b', source: 'legacy' },
];

function hexRgb(value: string) {
  return [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16)) as [number, number, number];
}
function colorDistance(a: string, b: string) {
  const [ar, ag, ab] = hexRgb(a), [br, bg, bb] = hexRgb(b);
  return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
}
function normalizeName(name: string) {
  const compact = name.replace(/\s+/g, ' ').trim();
  return compact
    .replace(/\bhoodie\b/gi, 'Hoodie')
    .replace(/\btee\b/gi, 'Tee')
    .replace(/\bzipper\b/gi, 'Zipper')
    .replace(/\bjacke\b/gi, 'Jacke')
    .replace(/\bcolor\b/gi, 'Color')
    .replace(/\boriginal\b/gi, 'Original');
}
function guessCatalogName(product: Product, rawLabel: string | undefined, value: string) {
  const label = normalizeName(rawLabel || product.title);
  const lower = label.toLowerCase();
  const tags: [string, string][] = [
    ['schwarz', 'Tiefschwarz'], ['black', 'Tiefschwarz'], ['weiß', 'Polarweiß'], ['weiss', 'Polarweiß'], ['white', 'Polarweiß'],
    ['grau', 'Graphit'], ['gray', 'Graphit'], ['grey', 'Graphit'], ['silber', 'Silber'], ['silver', 'Silber'],
    ['rot', 'Rennrot'], ['red', 'Rennrot'], ['orange', 'Mandarine'], ['gelb', 'Sonnengelb'], ['yellow', 'Sonnengelb'],
    ['grün', 'Tannengrün'], ['green', 'Tannengrün'], ['blau', 'Royalblau'], ['blue', 'Royalblau'],
    ['violett', 'Amethyst'], ['purple', 'Amethyst'], ['rosa', 'Mauve'], ['pink', 'Mauve'], ['braun', 'Walnuss'], ['brown', 'Walnuss'],
  ];
  for (const [needle, renamed] of tags) if (lower.includes(needle)) return renamed;
  const [r, g, b] = hexRgb(value);
  if (r < 32 && g < 32 && b < 32) return 'Tiefschwarz';
  if (r > 228 && g > 228 && b > 228) return 'Polarweiß';
  if (Math.max(r, g, b) - Math.min(r, g, b) < 12) return 'Graphit';
  return label;
}
function colorPriority(color: NamedColor) {
  return color.source === 'catalog' ? 0 : color.source === 'basic' ? 1 : 2;
}
function catalogColors(products: readonly Product[]): NamedColor[] {
  const result: NamedColor[] = [];
  for (const p of products) {
    if (!isWearableProduct(p)) continue;
    const base = darkenClothingColor(p.baseColor).toLowerCase();
    result.push({ name: guessCatalogName(p, p.title, base), value: base, source: 'catalog' });
    if (p.preview?.colors.length) {
      for (const c of p.preview.colors) {
        const value = darkenClothingColor(c.baseColor).toLowerCase();
        result.push({
          value,
          name: guessCatalogName(p, c.label === 'Original' ? p.title : c.label, value),
          source: 'catalog',
        });
      }
    }
    for (const v of p.variants) if (v.baseColor) {
      const value = darkenClothingColor(v.baseColor).toLowerCase();
      result.push({
        name: guessCatalogName(p, v.options?.[0] || p.title, value),
        value,
        source: 'catalog',
      });
    }
  }
  return result;
}
function preferName(current: NamedColor, next: NamedColor) {
  const currentScore = colorPriority(current) * 100 + current.name.length;
  const nextScore = colorPriority(next) * 100 + next.name.length;
  return nextScore < currentScore ? next : current;
}
function dedupeColors(colors: readonly NamedColor[]) {
  const chosen: NamedColor[] = [];
  for (const candidate of colors) {
    if (!/^#[\da-f]{6}$/i.test(candidate.value)) continue;
    const exact = chosen.findIndex(c => c.value.toLowerCase() === candidate.value.toLowerCase());
    if (exact >= 0) {
      chosen[exact] = preferName(chosen[exact], { ...candidate, value: candidate.value.toLowerCase() });
      continue;
    }
    const similar = chosen.findIndex(c => colorDistance(c.value, candidate.value) < 13);
    if (similar >= 0) {
      chosen[similar] = preferName(chosen[similar], { ...candidate, value: candidate.value.toLowerCase() });
      continue;
    }
    chosen.push({ ...candidate, value: candidate.value.toLowerCase() });
  }
  return chosen;
}
export const APPEARANCE_COLORS: readonly AppearanceColor[] = Object.freeze(
  dedupeColors([...catalogColors(catalog as Product[]), ...BASIC_COLORS, ...LEGACY_COLORS])
    .map(({ name, value }) => ({ name, value })),
);
export function pricedAppearanceColors(
  previous: readonly (AppearanceColor & { price: number })[], price: number,
) {
  return APPEARANCE_COLORS.map(c => ({
    ...c, price: previous.find(p => p.value.toLowerCase() === c.value)?.price ?? price,
  }));
}
