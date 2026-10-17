import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { PlayerRepository } from '../services';
import { NO_GIFTS } from '../services/playerGifts';
import './gift-notification.css';

export default function GiftNotification({ repository, active }: { repository: PlayerRepository; active: boolean }) {
  const subscribe = useCallback((listener: () => void) => repository.subscribeSync?.(listener) ?? (() => {}), [repository]);
  const snapshot = useCallback(() => repository.gifts ?? NO_GIFTS, [repository]);
  const gifts = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const gift = active ? gifts.find(item => !seen.has(item.id)) : undefined;
  const giftId = gift?.id;
  useEffect(() => {
    if (!giftId) return;
    const timer = window.setTimeout(() => {
      setSeen(previous => new Set(previous).add(giftId));
      // A failed acknowledgement leaves the notification durable for the next
      // opening. Currency was already credited atomically by the server.
      void repository.acknowledgeGifts?.([giftId]).catch(() => {});
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [giftId, repository]);
  if (!gift) return null;
  return <output className="toast gift-notification">
    <strong>GESCHENK ERHALTEN</strong>
    <span>+{gift.amount.toLocaleString('de-CH')} {gift.kind === 'coins' ? 'Coins' : 'Guardian Bells'}</span>
    {gift.message && <span>{gift.message}</span>}
  </output>;
}
