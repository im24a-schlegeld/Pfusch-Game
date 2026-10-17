import { describe, expect, it, vi } from 'vitest';
import { newPlayer } from '../app/domain/progression';
import { decodePlayer, LocalPlayerRepository } from '../app/services';
import { ShopifyCloudRepository } from '../app/services/shopifyCloud';
import type { CloudResponse, CloudTransport } from '../app/services/shopifyBridge';

const gift = { id: '78ef760a-dc5d-4281-96d1-8263a070dc93', kind: 'coins', amount: 100,
  message: 'Viel Spass beim Fahren!', sentAt: '2026-10-16T18:00:00.000Z' };
const hash = 'a'.repeat(64), token = 'gift-client-csrf-token';
const snapshot = (gifts: unknown[] = [], coins = 500, compareDigest = hash): CloudResponse => ({ status: 200,
  data: { customer: { id: '123' }, player: { ...newPlayer(), coins }, compareDigest, csrfToken: token, gifts,
    storage: { allowed: true, reason: 'subscribed', completedRuns: 0, freeRuns: 5 } } });
function repository(responses: CloudResponse[]) {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
  const request = vi.fn(async () => {
    const response = responses.shift();
    if (!response) throw new Error('No response');
    return response;
  });
  const transport: CloudTransport = { request };
  return { request, repo: new ShopifyCloudRepository(transport, storage, new LocalPlayerRepository(storage), decodePlayer) };
}

describe('server gift notifications', () => {
  it('loads pending gifts without crediting the already credited server balance again', async () => {
    const { repo } = repository([snapshot([gift])]);
    expect((await repo.load()).coins).toBe(500);
    expect(repo.gifts).toEqual([gift]);
    expect((await repo.load()).coins).toBe(500);
  });

  it('acknowledges a displayed gift separately from the player save', async () => {
    const { repo, request } = repository([snapshot([gift]), { status: 200,
      data: { acknowledgedGiftIds: [gift.id], gifts: [] } }, snapshot([gift])]);
    await repo.load();
    await repo.acknowledgeGifts([gift.id]);
    expect(request).toHaveBeenLastCalledWith('POST', { acknowledgedGiftIds: [gift.id], csrfToken: token });
    expect(repo.gifts).toEqual([]);
    await repo.refreshAccess();
    expect(repo.gifts).toEqual([]);
    expect((await repo.load()).coins).toBe(500);
  });

  it('keeps notifications pending when server acknowledgement fails', async () => {
    const { repo } = repository([snapshot([gift]), { status: 503, data: { error: 'unavailable' } }]);
    await repo.load();
    await expect(repo.acknowledgeGifts([gift.id])).rejects.toThrow();
    expect(repo.gifts).toEqual([gift]);
  });

  it('delivers gifts on a later sync and adopts only the server balance increment', async () => {
    const { repo } = repository([snapshot(), snapshot([gift], 600, 'b'.repeat(64))]);
    await repo.load();
    await repo.refreshAccess();
    expect(repo.gifts).toEqual([gift]);
    expect((await repo.load()).coins).toBe(600);
  });

  it('does not expose another account’s notifications after session rejection', async () => {
    const { repo } = repository([snapshot([gift])]);
    await repo.load();
    repo.invalidateSession();
    expect(repo.gifts).toEqual([]);
  });

  it('rebases a queued purchase onto a concurrent gift after a stale save without dropping its notification', async () => {
    const { repo, request } = repository([snapshot(), { status: 409, data: { error: 'conflict' } },
      snapshot([gift], 600, 'b'.repeat(64)), snapshot([gift], 590, 'c'.repeat(64))]);
    const player = await repo.load();
    repo.save({ ...player, coins: player.coins - 10 });
    await repo.flush();
    expect((await repo.load()).coins).toBe(590);
    expect(repo.gifts).toEqual([gift]);
    expect(request).toHaveBeenLastCalledWith('POST', expect.objectContaining({ compareDigest: 'b'.repeat(64),
      player: expect.objectContaining({ coins: 590 }) }));
  });
});
