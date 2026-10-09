import { BIKES, PAINTS, RIMS } from './config';
import { equipHelmet, isHelmet, isHelmetColor, isVisorColor, unownedHelmetFinishes } from './helmet';
import { CARBON_PRICE } from './carbon';
import { equipConfiguration, equipmentSlot, equippable, previewLoadout, validConfiguration } from './preview';
import { digitalLevel, digitalPrice, unlock } from './progression';
import { colorName } from './paletteView';
import { isSticker, saveStickerTargets } from './stickers';
import type { Player, Product, ProductConfiguration, Slot, StickerPlacement } from './types';

/** A draft contains one logical part only. Inventory and progress always come from the account. */
export type GarageEdit =
  | { kind: 'model'; value: string }
  | { kind: 'paint' | 'rims'; value: string }
  | { kind: 'helmet'; helmet: Player['helmet']; helmetColor: string; helmetVisor: string }
  | { kind: 'product'; productId: string; configuration: ProductConfiguration }
  | { kind: 'remove'; slot: Slot };

export interface GarageOffer {
  name: string;
  price: number;
  owned: boolean;
  requiredLevel: number;
  blocked: string | null;
  collectible: boolean;
}

export function garageAppearance(player: Player, edit: GarageEdit | null, products: Product[]): Player {
  if (!edit) return player;
  if (edit.kind === 'model') return { ...player, bike: edit.value };
  if (edit.kind === 'paint' || edit.kind === 'rims') return { ...player, [edit.kind]: edit.value };
  if (edit.kind === 'helmet') return { ...player, helmet: edit.helmet, helmetColor: edit.helmetColor, helmetVisor: edit.helmetVisor };
  if (edit.kind === 'remove') {
    const equipped = { ...player.equipped };
    delete equipped[edit.slot];
    return { ...player, equipped };
  }
  if (edit.kind === 'product') {
    const product = products.find(p => p.id === edit.productId);
    return product ? previewLoadout(player, product, edit.configuration) : player;
  }
  return player;
}

export function garageOffer(player: Player, edit: GarageEdit, products: Product[]): GarageOffer {
  let id = '', name = '', price = 0, requiredLevel = 1, valid = true, collectible = false;
  if (edit.kind === 'model') {
    const bike = BIKES.find(b => b.id === edit.value);
    id = `bike:${edit.value}`;
    name = bike?.name ?? 'Motorrad'; price = bike?.price ?? 0; requiredLevel = bike?.level ?? 1; valid = !!bike;
  } else if (edit.kind === 'paint' || edit.kind === 'rims') {
    const palette = edit.kind === 'paint' ? PAINTS : RIMS;
    const color = palette.find(c => c.value === edit.value);
    id = `${edit.kind}:${edit.value}`;
    const label = colorName(edit.value);
    name = palette.filter(c => colorName(c.value) === label).length > 1 ? `${label} · ${edit.value.toUpperCase()}` : label;
    price = color?.price ?? 0;
    // Legacy purchased colors retain their identity even if the current palette no longer lists them.
    valid = !!color || (player.ownedItems.includes(id) && /^#[\da-f]{6}$/i.test(edit.value));
  } else if (edit.kind === 'helmet') {
    const purchases = unownedHelmetFinishes(player, edit);
    price = purchases.length * CARBON_PRICE;
    valid = isHelmet(edit.helmet) && isHelmetColor(edit.helmetColor) && isVisorColor(edit.helmetVisor);
    return { name: purchases.length ? 'Dunkles Karbon · Helm' : 'Helm', price, owned: purchases.length === 0, requiredLevel: 1, collectible: false,
      blocked: !valid ? 'Diese Auswahl ist nicht verfügbar' : purchases.length && player.level < 1 ? 'Ab Level 1 verfügbar' : player.coins < price ? `Dir fehlen ${price - player.coins} Coins` : null };
  } else if (edit.kind === 'remove') name = 'Standard / ohne Artikel';
  else if (edit.kind === 'product') {
    const product = products.find(p => p.id === edit.productId);
    id = edit.productId; name = product?.title ?? 'Artikel'; price = product ? digitalPrice(product) : 0;
    requiredLevel = product ? digitalLevel(product) : 1;
    valid = !!product && validConfiguration(product, edit.configuration);
    collectible = !!product && !equippable(product);
    if (product?.preview?.numberCustomization && !/^\d{1,2}$/.test(edit.configuration.customNumber ?? '')) {
      return { name, price, owned: player.ownedItems.includes(id) || player.irlItems.includes(id), requiredLevel, blocked: 'Nummer mit 1–2 Ziffern eingeben', collectible };
    }
  }
  const owned = !id || player.ownedItems.includes(id) || player.irlItems.includes(id);
  const blocked = !valid ? 'Diese Auswahl ist nicht verfügbar' : player.level < requiredLevel && (!owned || edit.kind === 'model') ? `Ab Level ${requiredLevel} verfügbar`
    : !owned && player.coins < price ? `Dir fehlen ${price - player.coins} Coins` : null;
  return { name, price, owned, requiredLevel, blocked, collectible };
}

/** All validation precedes the single returned account update: a failed equip never deducts coins. */
export function commitGarageEdit(player: Player, edit: GarageEdit, products: Product[]): Player | null {
  const offer = garageOffer(player, edit, products);
  if (offer.blocked) return null;
  if (edit.kind === 'helmet') return equipHelmet(player, edit);
  if (edit.kind === 'remove') return garageAppearance(player, edit, products);
  const id = edit.kind === 'model' ? `bike:${edit.value}` : edit.kind === 'product' ? edit.productId : `${edit.kind}:${edit.value}`;
  const unlocked = unlock(player, id, offer.price, offer.requiredLevel);
  if (!unlocked) return null;
  if (edit.kind === 'product') {
    const product = products.find(p => p.id === edit.productId);
    if (!product) return null;
    return equippable(product) ? equipConfiguration(unlocked, product, edit.configuration) : unlocked;
  }
  return garageAppearance(unlocked, edit, products);
}

/** Buying the sticker and saving every edited surface is one all-or-nothing account update. */
export function commitStickerEdit(player: Player, drafts: Record<string, StickerPlacement[]>, products: Product[]): Player | null {
  if (Object.keys(drafts).length === 0) return null;
  const sticker = products.find(isSticker);
  if (!sticker) return null;
  const needsSticker = Object.values(drafts).some(placements => placements.length > 0);
  const unlocked = needsSticker ? unlock(player, sticker.id, digitalPrice(sticker)) : player;
  return unlocked ? saveStickerTargets(unlocked, drafts, products) : null;
}

export function garageEditChanged(player: Player, edit: GarageEdit | null, products: Product[]): boolean {
  if (!edit) return false;
  if (edit.kind === 'model') return player.bike !== edit.value;
  if (edit.kind === 'paint' || edit.kind === 'rims') return player[edit.kind] !== edit.value;
  if (edit.kind === 'helmet') return player.helmet !== edit.helmet || player.helmetColor !== edit.helmetColor || player.helmetVisor !== edit.helmetVisor;
  if (edit.kind === 'remove') return !!player.equipped[edit.slot];
  if (edit.kind === 'product') {
    const p = products.find(value => value.id === edit.productId);
    if (!p) return true;
    if (!equippable(p)) return !player.ownedItems.includes(p.id) && !player.irlItems.includes(p.id);
    const c = edit.configuration, saved = player.customizations[p.id];
    return player.equipped[equipmentSlot(p)] !== p.id || player.variants[p.id] !== c.variantId ||
      (saved?.customNumber ?? '') !== (c.customNumber ?? '') || (saved?.hoodEnabled === true) !== (c.hoodEnabled === true);
  }
  return false;
}
