import { describe, expect, it } from 'vitest';
import { LEVELS, PAINTS, REWARDS, RIMS } from '../app/domain/config';
import { newPlayer } from '../app/domain/progression';
import { MockRewardService } from '../app/services';

describe('digital level rewards', () => {
  const service = new MockRewardService();
  it('awards configured coins once without changing the equipped setup', () => {
    let player = { ...newPlayer(), xp: LEVELS[5], level: 6, coins: 0 };
    for (const id of ['starter-coins', 'city-coins', 'street-coins', 'sport-coins']) {
      player = service.redeem(player, id)!;
      expect(service.redeem(player, id)).toBeNull();
    }
    expect(player.coins).toBe(750);
    expect(player.redeemedRewards).toHaveLength(4);
    expect(player.bike).toBe('125');
    expect(player.paint).toBe(newPlayer().paint);
  });

  it('rejects unreached levels, unknown IDs and every future real-world offer', () => {
    const player = newPlayer();
    expect(service.redeem(player, 'city-coins')).toBeNull();
    expect(service.redeem(player, 'amethyst-paint')).toBeNull();
    expect(service.redeem(player, 'unknown-reward')).toBeNull();
    for (const reward of REWARDS.filter((entry) => entry.kind === 'future')) {
      expect(service.redeem({ ...player, level: 10 }, reward.id)).toBeNull();
    }
    expect(player.redeemedRewards).toEqual([]);
  });

  it('grants real selectable cosmetics without duplicates or auto-equipping', () => {
    const initial = { ...newPlayer(), xp: LEVELS[7], level: 8 };
    expect(RIMS.some((entry) => entry.value === '#7461a5')).toBe(true);
    expect(PAINTS.some((entry) => entry.value === '#7461a5')).toBe(true);
    const rims = service.redeem({ ...initial, ownedItems: [...initial.ownedItems, 'rims:#7461a5'] }, 'exclusive-rims')!;
    expect(rims.ownedItems.filter((id) => id === 'rims:#7461a5')).toHaveLength(1);
    const paint = service.redeem(rims, 'amethyst-paint')!;
    expect(paint.ownedItems).toContain('paint:#7461a5');
    expect(paint.paint).toBe(initial.paint);
    expect(paint.rims).toBe(initial.rims);
    expect(paint.coins).toBe(initial.coins);
    expect(service.redeem(paint, 'amethyst-paint')).toBeNull();
  });
});
