import { newPlayer } from './progression';
import { ownsHelmetOption } from './helmet';
import { ownsProductColor } from './productOwnership';
import { sanitizeSavedSetups } from './setups';
import type { Player, Product } from './types';

/** The independent local guest keeps purchases made in that slot only. Cached
 * account entitlements are display-only for an offline account, never a guest. */
export function guestInventory(player: Player, products: Product[]): Player {
  const defaults = newPlayer();
  const guest = { ...player, id: defaults.id, irlItems: [], equipped: { ...player.equipped }, stickers: { ...player.stickers } };
  for (const slot of Object.keys(guest.equipped) as Array<keyof Player['equipped']>) {
    const id = guest.equipped[slot], product = products.find(item => item.id === id);
    if (!product || !ownsProductColor(guest, product, guest.variants[product.id] ?? product.variants[0]?.id ?? '')) delete guest.equipped[slot];
  }
  for (const slot of ['bike', 'paint', 'rims'] as const)
    if (!guest.ownedItems.includes(`${slot}:${guest[slot]}`)) guest[slot] = defaults[slot];
  if (!ownsHelmetOption(guest, 'helmet', guest.helmet)) guest.helmet = defaults.helmet;
  if (!ownsHelmetOption(guest, 'helmetColor', guest.helmetColor)) guest.helmetColor = defaults.helmetColor;
  if (!ownsHelmetOption(guest, 'helmetVisor', guest.helmetVisor)) guest.helmetVisor = defaults.helmetVisor;
  for (const [target, placements] of Object.entries(guest.stickers))
    guest.stickers[target] = placements.filter(sticker => guest.ownedItems.includes(sticker.productId));
  guest.savedSetups = sanitizeSavedSetups(guest.savedSetups, guest);
  return guest;
}
