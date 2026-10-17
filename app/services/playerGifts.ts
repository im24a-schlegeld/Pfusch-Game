export interface PlayerGift {
  id: string;
  kind: 'coins' | 'guardianBells';
  amount: number;
  message: string;
  sentAt: string;
}

export const NO_GIFTS: readonly PlayerGift[] = [];

/** Notifications describe a server credit. They never grant currency locally. */
export function readPlayerGifts(value: unknown): PlayerGift[] {
  if (!Array.isArray(value) || value.length > 20) return [];
  const gifts: PlayerGift[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const gift = item as Record<string, unknown>;
    if (typeof gift.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(gift.id)
      || !['coins', 'guardianBells'].includes(String(gift.kind)) || !Number.isInteger(gift.amount)
      || Number(gift.amount) < 1 || Number(gift.amount) > (gift.kind === 'coins' ? 2000 : 5)
      || typeof gift.message !== 'string' || gift.message.length > 80
      || typeof gift.sentAt !== 'string' || !Number.isFinite(Date.parse(gift.sentAt))
      || gifts.some(existing => existing.id === gift.id)) continue;
    gifts.push({ id: gift.id, kind: gift.kind as PlayerGift['kind'], amount: Number(gift.amount),
      message: gift.message, sentAt: gift.sentAt });
  }
  return gifts;
}
