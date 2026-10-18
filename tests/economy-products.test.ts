import { describe, expect, it, vi } from 'vitest';
import catalog from '../public/catalog/products.json';
import type { Product } from '../app/domain/types';
import { digitalPrice, newPlayer } from '../app/domain/progression';
import { commitGarageEdit, garageOffer } from '../app/domain/garageEdit';
import { initialConfiguration } from '../app/domain/preview';
import { EconomyProductProvider } from '../app/services/economyProducts';
import { decodeGameEconomy } from '../app/domain/economy';

const flag = catalog.find(product => product.category === 'cape') as Product;

describe('configured flag coin price', () => {
  it('uses the configured price for both the garage offer and the single purchase', () => {
    const product = { ...flag, digitalCoinPrice: 6250 };
    const player = { ...newPlayer(), xp: 5100, level: 8, coins: 7000 };
    const edit = { kind: 'product' as const, productId: product.id, configuration: initialConfiguration(player, product) };
    expect(digitalPrice(product)).toBe(6250);
    expect(garageOffer(player, edit, [product]).price).toBe(6250);
    const bought = commitGarageEdit(player, edit, [product]);
    expect(bought?.coins).toBe(750);
    expect(commitGarageEdit(bought!, edit, [product])?.coins).toBe(750);
    expect(commitGarageEdit({ ...player, coins: 6249 }, edit, [product])).toBeNull();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1_000_000_001])('keeps the default for invalid overrides: %s', digitalCoinPrice => {
    expect(digitalPrice({ ...flag, digitalCoinPrice })).toBe(5000);
  });

  it('loads and caches the validated public price, then keeps it while offline', async () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const source = { list: async () => [flag] };
    const online = vi.fn<typeof fetch>(async () => Response.json({ version: 1, flagCoinPrice: 6250 }));
    expect(digitalPrice((await new EconomyProductProvider(source, storage, online).list())[0])).toBe(6250);
    expect(online).toHaveBeenCalledWith('/api/game/economy', expect.objectContaining({ cache: 'no-store', credentials: 'omit' }));
    const offline = vi.fn<typeof fetch>(async () => { throw new Error('Offline'); });
    expect(digitalPrice((await new EconomyProductProvider(source, storage, offline).list())[0])).toBe(6250);
    expect(flag).not.toHaveProperty('digitalCoinPrice');
  });

  it('uses 5000 until a first valid setting and rejects malformed remote/cache values', async () => {
    const storage = { getItem: () => '{"version":1,"flagCoinPrice":-10}', setItem: vi.fn() };
    const source = { list: async () => [flag] };
    const bad = vi.fn<typeof fetch>(async () => Response.json({ version: 1, flagCoinPrice: '1' }));
    expect(digitalPrice((await new EconomyProductProvider(source, storage, bad).list())[0])).toBe(5000);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('rejects inherited properties and unexpected public configuration keys', () => {
    expect(decodeGameEconomy(Object.create({ version: 1, flagCoinPrice: 1 }))).toBeNull();
    expect(decodeGameEconomy(JSON.parse('{"version":1,"flagCoinPrice":6250,"__proto__":{}}'))).toBeNull();
    expect(decodeGameEconomy({ version: 1, flagCoinPrice: 6250, audit: [] })).toBeNull();
  });
});
