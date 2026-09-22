import type { Player, Product, ProductConfiguration } from './types';
export const equippable = (product: Product) =>
  product.category !== 'collectible';
export const supportsHood = (product: Product) =>
  product.handle === 'unisex-windbreaker';
export const canEquip = (player: Player, product: Product) =>
  equippable(product) &&
  (player.ownedItems.includes(product.id) ||
    player.irlItems.includes(product.id));
export function initialConfiguration(
  player: Player,
  product: Product,
): ProductConfiguration {
  const variant =
    product.variants.find((v) => v.id === player.variants[product.id]) ??
    product.variants[0];
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
    equipped: { ...player.equipped, [product.category]: product.id },
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
  if (!canEquip(player, product) || !validConfiguration(product, config))
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
