export interface GameEconomy { version: 1; flagCoinPrice: number }
export const DEFAULT_GAME_ECONOMY: Readonly<GameEconomy> = { version: 1, flagCoinPrice: 5000 };
export const MAX_FLAG_COIN_PRICE = 1_000_000_000;
export const validFlagCoinPrice = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= MAX_FLAG_COIN_PRICE;

/** Public configuration contains digital prices only, never customer or audit data. */
export function decodeGameEconomy(value: unknown): GameEconomy | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  return Object.hasOwn(data, 'version') && Object.hasOwn(data, 'flagCoinPrice')
    && data.version === 1 && validFlagCoinPrice(data.flagCoinPrice)
    && Object.keys(data).every(key => key === 'version' || key === 'flagCoinPrice')
    ? { version: 1, flagCoinPrice: data.flagCoinPrice } : null;
}
