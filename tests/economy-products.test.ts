import { describe, expect, it, vi } from 'vitest';
import catalog from '../public/catalog/products.json';
import type { Product } from '../app/domain/types';
import { digitalPrice, newPlayer } from '../app/domain/progression';
import { commitGarageEdit, garageOffer } from '../app/domain/garageEdit';
import { initialConfiguration } from '../app/domain/preview';
import { GamePriceProductProvider, decodeGamePriceSnapshot } from '../app/services/gamePriceProducts';

const flag = catalog.find(product => product.category === 'cape') as Product;
const garment = catalog.find(product => product.category === 'upper') as Product;
const source = { list: async () => [flag, garment] };
const memoryStorage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
};

describe('configured flag coin price', () => {
  it('uses the configured price for both the garage offer and the single purchase', () => {
    const product = { ...flag, gameCoinPrice: 6250 };
    const player = { ...newPlayer(), xp: 5100, level: 8, coins: 7000 };
    const edit = { kind: 'product' as const, productId: product.id, configuration: initialConfiguration(player, product) };
    expect(digitalPrice(product)).toBe(6250);
    expect(garageOffer(player, edit, [product]).price).toBe(6250);
    const bought = commitGarageEdit(player, edit, [product]);
    expect(bought?.coins).toBe(750);
    expect(commitGarageEdit(bought!, edit, [product])?.coins).toBe(750);
    expect(commitGarageEdit({ ...player, coins: 6249 }, edit, [product])).toBeNull();
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 10001])('keeps the default for invalid overrides: %s', gameCoinPrice => {
    expect(digitalPrice({ ...flag, gameCoinPrice })).toBe(5000);
  });

  it('loads and caches the validated public price, then keeps it while offline', async () => {
    const storage = memoryStorage();
    const online = vi.fn<typeof fetch>(async () => Response.json({ prices: { [flag.id]: 6250, [garment.id]: 84 } }));
    const products = await new GamePriceProductProvider(source, storage, online).list();
    expect(products.map(digitalPrice)).toEqual([6250, 84]);
    expect(online).toHaveBeenCalledWith('/api/game-prices', expect.objectContaining({ cache: 'no-store', credentials: 'omit' }));
    const offline = vi.fn<typeof fetch>(async () => { throw new Error('Offline'); });
    expect((await new GamePriceProductProvider(source, storage, offline).list()).map(digitalPrice)).toEqual([6250, 84]);
    expect(flag).not.toHaveProperty('gameCoinPrice');
  });

  it('uses 5000 until a first valid setting and rejects malformed remote/cache values', async () => {
    const storage = { getItem: () => JSON.stringify({ version: 1, prices: { [flag.id]: -10 } }), setItem: vi.fn() };
    const bad = vi.fn<typeof fetch>(async () => Response.json({ prices: { [flag.id]: '1' } }));
    expect(digitalPrice((await new GamePriceProductProvider(source, storage, bad).list())[0])).toBe(5000);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('rejects inherited properties and unexpected public configuration keys', () => {
    const products = [flag, garment];
    expect(decodeGamePriceSnapshot(Object.create({ prices: { [flag.id]: 1 } }), products)).toBeNull();
    expect(decodeGamePriceSnapshot(JSON.parse('{"prices":{"__proto__":1}}'), products)).toBeNull();
    expect(decodeGamePriceSnapshot({ prices: { unknown: 1 } }, products)).toBeNull();
    expect(decodeGamePriceSnapshot({ prices: {}, audit: [] }, products)).toBeNull();
  });

  it('supports zero and resets the cached flag price to its default with an empty snapshot', async () => {
    const storage = memoryStorage();
    const online = vi.fn<typeof fetch>(async () => Response.json({ prices: { [flag.id]: 0 } }));
    expect(digitalPrice((await new GamePriceProductProvider(source, storage, online).list())[0])).toBe(0);
    const reset = vi.fn<typeof fetch>(async () => Response.json({ prices: {} }));
    expect(digitalPrice((await new GamePriceProductProvider(source, storage, reset).list())[0])).toBe(5000);
    expect(digitalPrice((await new GamePriceProductProvider(source, storage).list())[0])).toBe(5000);
  });

  it('keeps the last valid snapshot when a later response contains an unknown product', async () => {
    const storage = memoryStorage();
    storage.setItem('pfusch:game-prices:v1', JSON.stringify({ version: 1, prices: { [flag.id]: 6250 } }));
    const invalid = vi.fn<typeof fetch>(async () => Response.json({ prices: { [flag.id]: 7000, unknown: 1 } }));
    expect(digitalPrice((await new GamePriceProductProvider(source, storage, invalid).list())[0])).toBe(6250);
  });
});
