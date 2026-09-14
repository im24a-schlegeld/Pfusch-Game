import { describe, expect, it } from 'vitest';
import { HELMETS, HELMET_COLORS, equipHelmet } from '../app/domain/helmet';
import { newPlayer } from '../app/domain/progression';
import type { Helmet } from '../app/domain/types';
import { decodePlayer, LocalPlayerRepository } from '../app/services';

describe('stock helmet options', () => {
  it('migrates older v1 saves with the original appearance and all progress intact', () => {
    const player = {
      ...newPlayer(),
      xp: 480,
      coins: 815,
      runsPlayed: 7,
      equipped: { head: 'catalog-cap', upper: 'catalog-jersey' },
    };
    const legacy = { ...player, helmet: undefined, helmetColor: undefined };
    const migrated = decodePlayer(JSON.stringify(legacy));
    expect(migrated).toMatchObject({
      version: 1,
      helmet: 'fullface',
      helmetColor: '#d7dbd7',
      xp: player.xp,
      coins: player.coins,
      runsPlayed: player.runsPlayed,
      equipped: player.equipped,
    });
  });

  it('round trips every supported style and color without purchasing anything', () => {
    const player = { ...newPlayer(), coins: 0 };
    for (const helmet of HELMETS) {
      for (const color of HELMET_COLORS) {
        const equipped = equipHelmet(player, {
          helmet: helmet.id,
          helmetColor: color.value,
        })!;
        expect(decodePlayer(JSON.stringify(equipped))).toEqual(equipped);
        expect(equipped.coins).toBe(0);
        expect(equipped.ownedItems).toEqual(player.ownedItems);
      }
    }
  });

  it.each([
    { helmet: 'cap', helmetColor: '#ffffff' },
    { helmet: null, helmetColor: 'red' },
    { helmet: 2, helmetColor: {} },
  ])(
    'recovers invalid optional appearance values without resetting the save',
    (invalid) => {
      const player = { ...newPlayer(), coins: 931, runsPlayed: 17 };
      const recovered = decodePlayer(JSON.stringify({ ...player, ...invalid }));
      expect(recovered).toEqual(player);
    },
  );

  it('recovers invalid style and color independently', () => {
    const player = newPlayer();
    expect(
      decodePlayer(
        JSON.stringify({
          ...player,
          helmet: 'motocross',
          helmetColor: '#123456',
        }),
      ),
    ).toMatchObject({ helmet: 'motocross', helmetColor: '#d7dbd7' });
    expect(
      decodePlayer(
        JSON.stringify({
          ...player,
          helmet: 'openface',
          helmetColor: '#202324',
        }),
      ),
    ).toMatchObject({ helmet: 'fullface', helmetColor: '#202324' });
  });

  it('Equip Helmet saves only the helmet even when a locked bike and garment are previewed', async () => {
    const player = {
      ...newPlayer(),
      equipped: { head: 'owned-cap' },
      ownedItems: [...newPlayer().ownedItems, 'owned-cap'],
    };
    const original = structuredClone(player);
    const preview = {
      ...player,
      helmet: 'motocross' as const,
      helmetColor: '#202324',
      bike: '701',
      paint: '#d9f365',
      rims: '#000000',
      equipped: { ...player.equipped, upper: 'locked-jersey' },
      variants: { 'locked-jersey': 'locked-variant' },
      customizations: { 'locked-jersey': { customNumber: '72' } },
    };
    expect(player).toEqual(original);
    const equipped = equipHelmet(player, preview)!;
    expect(equipped).toEqual({
      ...player,
      helmet: 'motocross',
      helmetColor: '#202324',
    });
    const saves = new Map<string, string>();
    const repository = new LocalPlayerRepository({
      getItem: (key) => saves.get(key) ?? null,
      setItem: (key, value) => {
        saves.set(key, value);
      },
    });
    repository.save(equipped);
    expect(await repository.load()).toEqual(equipped);
    expect(player).toEqual(original);
  });

  it('rejects an unsupported helmet selection at the equip boundary', () => {
    const player = newPlayer();
    expect(
      equipHelmet(player, {
        helmet: 'cap' as Helmet,
        helmetColor: '#d7dbd7',
      }),
    ).toBeNull();
    expect(
      equipHelmet(player, {
        helmet: 'motocross',
        helmetColor: '#123456',
      }),
    ).toBeNull();
  });
});
