import type { Product } from '../domain/types';
import type { ProductProvider, StorageDriver } from './index';

const CACHE_KEY = 'pfusch:game-prices:v1';
const MAX_SNAPSHOT_LENGTH = 30_000;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Accept only own, known product IDs and the shared digital-price range. */
export function decodeGamePriceSnapshot(value: unknown, products: readonly Product[], cached = false): Record<string, number> | null {
  if (!isRecord(value) || !Object.hasOwn(value, 'prices') || !isRecord(value.prices)
    || (cached && (!Object.hasOwn(value, 'version') || value.version !== 1))
    || Object.keys(value).some(key => key !== 'prices' && !(cached && key === 'version'))) return null;
  const known = new Set(products.map(product => product.id));
  if (Object.keys(value.prices).length > known.size) return null;
  const prices: Record<string, number> = {};
  for (const [id, price] of Object.entries(value.prices)) {
    if (!known.has(id) || typeof price !== 'number' || !Number.isSafeInteger(price) || price < 0 || price > 10000) return null;
    prices[id] = price;
  }
  return prices;
}

/** One catalog snapshot keeps displayed offers and purchase checks consistent. */
export class GamePriceProductProvider implements ProductProvider {
  private prices: Record<string, number> | null = null;
  constructor(private source: ProductProvider, private storage: StorageDriver, private request?: typeof fetch) {}

  async list(): Promise<Product[]> {
    const products = await this.source.list();
    let prices: Record<string, number> = this.prices ?? {};
    try {
      const raw = this.prices === null ? this.storage.getItem(CACHE_KEY) : null;
      if (raw && raw.length <= MAX_SNAPSHOT_LENGTH) prices = decodeGamePriceSnapshot(JSON.parse(raw), products, true) ?? prices;
    } catch { /* Storage loss cannot prevent a ride. */ }
    if (this.request) {
      try {
        const response = await this.request('/api/game-prices', { method: 'GET', credentials: 'omit', cache: 'no-store',
          headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4500) });
        if (response.ok) {
          const raw = await response.text();
          const fresh = raw.length <= MAX_SNAPSHOT_LENGTH ? decodeGamePriceSnapshot(JSON.parse(raw), products) : null;
          if (fresh) {
            prices = fresh;
            try { this.storage.setItem(CACHE_KEY, JSON.stringify({ version: 1, prices })); } catch { /* Use the fresh in-memory price. */ }
          }
        }
      } catch { /* Offline retains the last validated full snapshot. */ }
    }
    this.prices = prices;
    return products.map(product => Object.hasOwn(prices, product.id) ? { ...product, gameCoinPrice: prices[product.id] } : product);
  }
}
