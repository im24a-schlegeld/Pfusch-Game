import { describe, expect, it } from 'vitest';
import { BIKES, LEVELS } from '../app/domain/config';
import { newPlayer, unlock } from '../app/domain/progression';
import { LocalPlayerRepository, decodePlayer } from '../app/services';
import { applySetup, saveSetup } from '../app/domain/setups';

describe('additional Moped ownership and schema-one save', () => {
  it('sits between Roller and Supermoto without changing the Töffli identity', () => {
    expect(BIKES.map(bike => bike.id)).toEqual(['125', 'scooter', 'moped', '450', '701']);
    expect(BIKES[0]).toMatchObject({ id: '125', name: 'Töffli', price: 0 });
    expect(BIKES.find(bike => bike.id === 'moped')).toMatchObject({
      name: 'Moped', price: 350, level: 3, maxSpeed: 134 / 3.6,
      acceleration: .228, handling: 14.5, stability: 1,
    });
  });
  it('requires the level and balance, charges once, and equips only explicitly', async () => {
    const bike = BIKES.find(candidate => candidate.id === 'moped')!;
    const item = `bike:${bike.id}`;
    expect(unlock({ ...newPlayer(), coins: 1000 }, item, bike.price, bike.level)).toBeNull();
    const eligible = { ...newPlayer(), xp: LEVELS[2], level: 3, coins: 349 };
    expect(unlock(eligible, item, bike.price, bike.level)).toBeNull();
    const purchased = unlock({ ...eligible, coins: 500 }, item, bike.price, bike.level)!;
    expect(purchased.coins).toBe(150);
    expect(purchased.bike).toBe('125');
    expect(purchased.ownedItems).toContain(item);
    expect(unlock(purchased, item, bike.price, bike.level)).toBe(purchased);
    const bytes = new Map<string, string>();
    const repository = new LocalPlayerRepository({
      getItem: key => bytes.get(key) ?? null,
      setItem: (key, value) => { bytes.set(key, value); },
    });
    const equipped = { ...purchased, bike: 'moped' };
    repository.save(equipped);
    expect(await repository.load()).toEqual(equipped);
    expect(decodePlayer(JSON.stringify(equipped)).version).toBe(1);
    const saved = saveSetup(equipped, 'Mein Moped', 'moped-setup')!;
    expect(applySetup({ ...saved, bike: '125' }, 'moped-setup', [])?.bike).toBe('moped');
    expect(applySetup({ ...saved, ownedItems: saved.ownedItems.filter(id => id !== item) }, 'moped-setup', [])).toBeNull();
  });
});
