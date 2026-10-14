import { describe, expect, it } from 'vitest';
import { newPlayer } from '../app/domain/progression';
import { decodePlayer, LocalPlayerRepository } from '../app/services';
import * as bells from '../app/domain/guardianBells';
import { digitalPlayer } from '../app/services/shopifyCloud';

describe('additive v1 Guardian Bell save migration', () => {
  it('starts new and legacy saves with zero bells without resetting existing progress', () => {
    const player = newPlayer();
    const legacy = { ...player, coins: 712, xp: 5000 } as Record<string, unknown>;
    delete legacy.guardianBells;
    expect(player).toHaveProperty('guardianBells', { earned: 0, spent: 0, spentRunIds: [] });
    expect(decodePlayer(JSON.stringify(legacy))).toMatchObject({ coins: 712, xp: 5000,
      guardianBells: { earned: 0, spent: 0, spentRunIds: [] } });
  });

  it('recovers malformed Bell state instead of turning it into a spendable balance', async () => {
    const data = new Map([['pfusch:player:v1', JSON.stringify({ ...newPlayer(), guardianBells: { earned: 1, spent: -1, spentRunIds: [] } })]]);
    const repo = new LocalPlayerRepository({ getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } });
    const recovered = await repo.load();
    expect(data.has('pfusch:player:v1:recovery')).toBe(true);
    expect(recovered).toHaveProperty('guardianBells', { earned: 0, spent: 0, spentRunIds: [] });
  });
});

describe('Guardian Bell debit', () => {
  it('consumes one earned Bell per run without changing coins or progress', () => {
    const player = { ...newPlayer(), id: 'shopify:123', coins: 871,
      guardianBells: { earned: 2, spent: 0, spentRunIds: [] } };
    const spent = bells.spendGuardianBell(player, 'run-1')!;
    expect(spent.guardianBells).toEqual({ earned: 2, spent: 1, spentRunIds: ['run-1'] });
    expect(spent.coins).toBe(871); expect(spent.xp).toBe(player.xp);
    expect(player.guardianBells.spent).toBe(0);
    expect(bells.guardianBellBalance(spent)).toBe(1);
    expect(bells.spendGuardianBell(spent, 'run-1')).toBeNull();
    const empty = bells.spendGuardianBell(spent, 'run-2')!;
    expect(bells.guardianBellBalance(empty)).toBe(0);
    expect(bells.spendGuardianBell(empty, 'run-3')).toBeNull();
    expect(bells.spendGuardianBell(player, '')).toBeNull();
    expect(bells.spendGuardianBell({ ...player, id: 'guest-local' }, 'guest')).toBeNull();
  });

  it('bounds recent receipts while retaining the cumulative spent counter through serialization', () => {
    let player = { ...newPlayer(), id: 'shopify:123', guardianBells: { earned: 200, spent: 0, spentRunIds: [] as string[] } };
    for (let i = 0; i < 150; i++) player = bells.spendGuardianBell(player, `run-${i}`)!;
    const restored = digitalPlayer(decodePlayer(JSON.stringify(player)), '123');
    expect(restored.guardianBells.spentRunIds).toHaveLength(100);
    expect(restored.guardianBells.spentRunIds[0]).toBe('run-50');
    expect(restored.guardianBells.spent).toBe(150);
    expect(bells.guardianBellBalance(restored)).toBe(50);
    expect(bells.spendGuardianBell(restored, 'run-149')).toBeNull();
  });
});
