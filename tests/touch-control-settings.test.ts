import { describe, expect, it, vi } from 'vitest';
import { newPlayer } from '../app/domain/progression';
import { applySetup, saveSetup } from '../app/domain/setups';
import type { Player } from '../app/domain/types';
import { decodePlayer, LocalPlayerRepository } from '../app/services';
import type { CloudTransport } from '../app/services/shopifyBridge';
import { ShopifyCloudRepository } from '../app/services/shopifyCloud';
import { sanitizeDigitalPlayer } from '../server/shopify/playerValidation';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe('additive schema-1 touch control preference', () => {
  it('defaults to swipe and accepts old local/account saves without changing progress', () => {
    const original = newPlayer();
    expect(original.settings.touchControls).toBe('swipe');
    const legacy = { ...original, coins: 432, settings: { ...original.settings, touchControls: undefined } };
    for (const player of [decodePlayer(JSON.stringify(legacy)), sanitizeDigitalPlayer(legacy, '123')]) {
      expect(player.version).toBe(1);
      expect(player.settings).toEqual(original.settings);
      expect(player.coins).toBe(432);
    }
  });

  it('persists either selected touch mode through local and server saves', async () => {
    const driver = storage(), repository = new LocalPlayerRepository(driver);
    for (const touchControls of ['buttons', 'swipe'] as const) {
      const player = await repository.load();
      player.settings.touchControls = touchControls;
      repository.save(player);
      expect((await repository.load()).settings.touchControls).toBe(touchControls);
      expect(sanitizeDigitalPlayer(player, '123').settings.touchControls).toBe(touchControls);
    }
  });

  it('recovers malformed local modes while rejecting malformed server values and unknown settings', () => {
    const player = newPlayer();
    for (const touchControls of [null, true, 1, '', 'keyboard', 'BUTTONS', [], {}]) {
      const malformed = { ...player, settings: { ...player.settings, touchControls } };
      expect(decodePlayer(JSON.stringify(malformed)).settings.touchControls).toBe('swipe');
      expect(() => sanitizeDigitalPlayer(malformed, '123')).toThrow();
    }
    expect(() => sanitizeDigitalPlayer({ ...player, settings: { ...player.settings, arbitrary: true } }, '123')).toThrow();
  });

  it('keeps the selected controls when applying a cosmetic setup', () => {
    const player = saveSetup(newPlayer(), 'Before buttons', 'before-buttons')!;
    player.settings.touchControls = 'buttons';
    const applied = applySetup({ ...player, helmet: 'motocross' }, 'before-buttons', [])!;
    expect(applied.helmet).toBe('fullface');
    expect(applied.settings.touchControls).toBe('buttons');
  });

  it('imports guest controls once and retains later account changes in the accepted backup', async () => {
    const guest = newPlayer(); guest.settings.touchControls = 'buttons';
    const driver = storage(); driver.setItem('pfusch:player:v1', JSON.stringify(guest));
    let account: Player | null = null;
    const request = vi.fn<CloudTransport['request']>(async (method, body) => {
      if (method === 'POST') account = sanitizeDigitalPlayer((body as { player: Player }).player, '123');
      return { status: 200, data: { customer: { id: '123' }, player: account,
        compareDigest: account ? 'a'.repeat(64) : null, csrfToken: 'test-touch-csrf-only',
        storage: { allowed: true, reason: 'subscribed', completedRuns: 0, freeRuns: 5 } } };
    });
    const repository = new ShopifyCloudRepository({ request }, driver, new LocalPlayerRepository(driver), decodePlayer);
    const imported = await repository.load();
    await repository.flush();
    expect(imported.settings.touchControls).toBe('buttons');
    expect(request).toHaveBeenLastCalledWith('POST', expect.objectContaining({
      player: expect.objectContaining({ settings: expect.objectContaining({ touchControls: 'buttons' }) }),
    }));
    expect(driver.getItem('pfusch:player:v1:guest-imported')).toBe('123');
    repository.save({ ...imported, settings: { ...imported.settings, touchControls: 'swipe' } });
    await repository.flush();
    const backup = JSON.parse(driver.getItem('pfusch:player:v1:shopify:123')!) as { player: Player };
    expect(backup.player.settings.touchControls).toBe('swipe');
    const reloaded = new ShopifyCloudRepository({ request }, driver, new LocalPlayerRepository(driver), decodePlayer);
    expect((await reloaded.load()).settings.touchControls).toBe('swipe');
    expect(JSON.parse(driver.getItem('pfusch:player:v1')!).settings.touchControls).toBe('buttons');
  });
});
