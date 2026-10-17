import type { Player, Product, ProductConfiguration, Slot } from './types';
import { ownsProductColor } from './productOwnership';
export const equipmentSlot = (product: Product): Slot =>
  product.handle === 'schlusselanhanger' ? 'keychain' : product.category;
export const equippable = (product: Product) =>
  product.category !== 'collectible';
export const supportsHood = (product: Product) =>
  product.handle === 'unisex-windbreaker';
export const canEquip = (player: Player, product: Product, variantId = player.variants[product.id] ?? product.variants[0]?.id ?? '') =>
  equippable(product) &&
  ownsProductColor(player, product, variantId);
export function initialConfiguration(
  player: Player,
  product: Product,
): ProductConfiguration {
  const variant =
    product.variants.find((v) => v.id === player.variants[product.id]) ??
    product.variants.find(v => ownsProductColor(player, product, v.id)) ?? product.variants[0];
  return {
    productId: product.id,
    variantId: variant?.id ?? '',
    ...(supportsHood(product)
      ? { hoodEnabled: player.customizations[product.id]?.hoodEnabled === true }
      : {}),
    ...(product.preview?.numberCustomization
      ? {
          customNumber: player.customizations[product.id]?.customNumber ?? '',
        }
      : {}),
  };
}
export function validConfiguration(
  product: Product,
  config: ProductConfiguration,
) {
  return (
    config.productId === product.id &&
    product.variants.some((v) => v.id === config.variantId) &&
    (config.hoodEnabled === undefined ||
      (supportsHood(product) && typeof config.hoodEnabled === 'boolean')) &&
    (!product.preview?.numberCustomization ||
      /^\d{1,2}$/.test(config.customNumber ?? ''))
  );
}
/** A derived display value only. Never write this value to PlayerRepository. */
export function previewLoadout(
  player: Player,
  product: Product,
  config: ProductConfiguration,
): Player {
  if (!equippable(product) || config.productId !== product.id) return player;
  return {
    ...player,
    equipped: { ...player.equipped, [equipmentSlot(product)]: product.id },
    variants: { ...player.variants, [product.id]: config.variantId },
    customizations: {
      ...player.customizations,
      [product.id]: {
        customNumber: config.customNumber,
        ...(supportsHood(product)
          ? { hoodEnabled: config.hoodEnabled === true }
          : {}),
      },
    },
  };
}
/** Ownership is checked here even if the UI mistakenly exposes an equip action. */
export function equipConfiguration(
  player: Player,
  product: Product,
  config: ProductConfiguration,
): Player | null {
  if (!canEquip(player, product, config.variantId) || !validConfiguration(product, config))
    return null;
  return previewLoadout(player, product, config);
}
export function productColors(product: Product) {
  if (product.preview?.colors.length) return product.preview.colors;
  const colorIndex = product.options.findIndex((o) =>
    /farbe|colou?r|couleur/i.test(o.name),
  );
  return (
    colorIndex < 0 ? ['Shop color'] : product.options[colorIndex].values
  ).map((label, index) => ({
    id: String(index),
    label,
    optionValue: colorIndex < 0 ? null : label,
    variantIds: product.variants
      .filter((v) => colorIndex < 0 || v.options[colorIndex] === label)
      .map((v) => v.id),
    baseColor: product.baseColor,
    front: null,
    back: null,
  }));
}
export const imagePath = (path: string) =>
  path.startsWith('http') || path.startsWith('/') ? path : `/${path}`;

export type ProductImageView = 'shop' | 'front' | 'back';
/** The catalog cache is the first Shopify image; side mappings are explicit views only. */
export function productImage(product: Product, view: ProductImageView = 'shop', variantId?: string): string {
  const first = product.localImage || product.images[0] || product.image;
  if (view === 'shop') return first;
  const colors = productColors(product);
  const color = colors.find(item => item.variantIds.includes(variantId ?? '')) ?? colors[0];
  const photo = color?.[view] ?? color?.front ?? color?.back;
  const variant = product.variants.find(item => item.id === variantId);
  return photo?.localImage || photo?.source || variant?.image || first;
}

/** Changing color retains its real photos in their original Shopify order. */
export function firstColorImageView(product: Product, variantId?: string): 'front' | 'back' {
  const colors = productColors(product);
  const color = colors.find(item => item.variantIds.includes(variantId ?? '')) ?? colors[0];
  const front = color?.front ? product.images.indexOf(color.front.source) : -1;
  const back = color?.back ? product.images.indexOf(color.back.source) : -1;
  return back >= 0 && (front < 0 || back < front) ? 'back' : 'front';
}
