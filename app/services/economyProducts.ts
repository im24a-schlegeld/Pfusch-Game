import { decodeGameEconomy, DEFAULT_GAME_ECONOMY, type GameEconomy } from '../domain/economy';
import type { ProductProvider, StorageDriver } from './index';

const CACHE_KEY = 'pfusch:economy:v1';

/** Catalog overlay keeps offers and purchases on one validated price snapshot. */
export class EconomyProductProvider implements ProductProvider {
  private economy: GameEconomy = { ...DEFAULT_GAME_ECONOMY };
  constructor(private source: ProductProvider, private storage: StorageDriver, private request?: typeof fetch) {
    try {
      const cached = storage.getItem(CACHE_KEY);
      if (cached && cached.length <= 1024) this.economy = decodeGameEconomy(JSON.parse(cached)) ?? this.economy;
    } catch { /* Storage loss must never prevent a ride. */ }
  }

  async list() {
    const products = await this.source.list();
    if (this.request) {
      try {
        const response = await this.request('/api/game/economy', {
          method: 'GET', credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(2500),
        });
        if (!response.ok) throw new Error('Economy unavailable');
        const raw = await response.text();
        const economy = raw.length <= 1024 ? decodeGameEconomy(JSON.parse(raw)) : null;
        if (economy) {
          this.economy = economy;
          try { this.storage.setItem(CACHE_KEY, JSON.stringify(economy)); } catch { /* The in-memory price remains usable. */ }
        }
      } catch { /* Offline uses the last validated price, or the initial 5000 default. */ }
    }
    return products.map(product => product.category === 'cape' ? { ...product, digitalCoinPrice: this.economy.flagCoinPrice } : product);
  }
}
