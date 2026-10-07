import { describe, expect, it, vi } from 'vitest';
import { newPlayer } from '../app/domain/progression';
import { applySetup, saveSetup } from '../app/domain/setups';
import { hasSeenTutorial, markTutorialSeen, markTutorialsSeen, normalizeTutorialHints, TUTORIAL_HINTS } from '../app/domain/tutorial';
import type { Player } from '../app/domain/types';
import { decodePlayer, LocalPlayerRepository } from '../app/services';
import type { CloudTransport } from '../app/services/shopifyBridge';
import { ShopifyCloudRepository } from '../app/services/shopifyCloud';
import { sanitizeDigitalPlayer } from '../server/shopify/playerValidation';

function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe('additive schema-1 contextual tutorial progress', () => {
  it('starts unseen and migrates old local/cloud saves without reinterpreting the legacy guide flag', () => {
    expect(newPlayer().settings.tutorialHintsSeen).toEqual([]);
    for (const tutorialSeen of [false, true]) {
      const original = newPlayer();
      const legacy = { ...original, settings: { ...original.settings, tutorialSeen, tutorialHintsSeen: undefined } };
      for (const player of [decodePlayer(JSON.stringify(legacy)), sanitizeDigitalPlayer(legacy, '123')]) {
        expect(player.version).toBe(1);
        expect(player.settings.tutorialHintsSeen).toEqual([]);
        expect(player.settings.tutorialSeen).toBe(tutorialSeen);
        expect(player.coins).toBe(original.coins);
      }
    }
  });

  it('bounds local recovery to known unique lesson IDs and makes acknowledgements idempotent', () => {
    expect(normalizeTutorialHints(['radar', 'not-a-hint', 'controls', null, 'radar', 7])).toEqual(['controls', 'radar']);
    for (const invalid of [undefined, null, 'controls', { controls: true }]) expect(normalizeTutorialHints(invalid)).toEqual([]);
    const original = newPlayer(), ramp = markTutorialSeen(original, 'ramp');
    expect(ramp.settings.tutorialSeen).toBe(false);
    expect(hasSeenTutorial(ramp, 'ramp')).toBe(true);
    expect(markTutorialSeen(ramp, 'ramp')).toBe(ramp);
    const acknowledged = markTutorialsSeen(ramp, TUTORIAL_HINTS);
    expect(acknowledged.settings.tutorialHintsSeen).toEqual(TUTORIAL_HINTS);
    expect(acknowledged.settings.tutorialSeen).toBe(true);
    expect(markTutorialsSeen(acknowledged, TUTORIAL_HINTS)).toBe(acknowledged);
    expect({ ...acknowledged, settings: original.settings }).toEqual(original);
    expect(original.settings.tutorialHintsSeen).toEqual([]);
  });

  it('persists exact acknowledgements through local save recovery and cloud sanitization', async () => {
    const driver = storage(), repository = new LocalPlayerRepository(driver);
    const player = markTutorialsSeen(await repository.load(), ['controls', 'police']);
    repository.save(player);
    expect((await repository.load()).settings.tutorialHintsSeen).toEqual(['controls', 'police']);
    expect(sanitizeDigitalPlayer(player, '123').settings.tutorialHintsSeen).toEqual(['controls', 'police']);
    const recovered = decodePlayer(JSON.stringify({ ...player, settings: { ...player.settings, tutorialHintsSeen: ['radar', 'forged', 'radar'] } }));
    expect(recovered.settings.tutorialHintsSeen).toEqual(['radar']);
  });

  it('rejects unknown, malformed or excessive server lesson flags', () => {
    const player = newPlayer();
    for (const tutorialHintsSeen of ['controls', null, ['forged'], [1], [...TUTORIAL_HINTS, 'controls']]) {
      expect(() => sanitizeDigitalPlayer({ ...player, settings: { ...player.settings, tutorialHintsSeen } }, '123')).toThrow();
    }
    expect(() => sanitizeDigitalPlayer({ ...player, settings: { ...player.settings, arbitrary: true } }, '123')).toThrow();
  });

  it('applying a cosmetic setup never rolls tutorial progress back', () => {
    const original = saveSetup(newPlayer(), 'Vor dem Tutorial', 'before-hints')!;
    const taught = markTutorialsSeen(original, ['controls', 'ramp', 'radar']);
    const restored = applySetup({ ...taught, helmet: 'motocross' }, 'before-hints', [])!;
    expect(restored.helmet).toBe('fullface');
    expect(restored.settings).toEqual(taught.settings);
  });

  it('imports guest lesson progress once, sends it to cloud and keeps the accepted backup', async () => {
    const guest = markTutorialsSeen(newPlayer(), ['controls', 'ramp', 'police']);
    const driver = storage(); driver.setItem('pfusch:player:v1', JSON.stringify(guest));
    const request = vi.fn<CloudTransport['request']>(async (method, body) => ({ status: 200,
      data: { customer: { id: '123' }, player: method === 'GET' ? null : sanitizeDigitalPlayer((body as { player: Player }).player, '123'),
        compareDigest: method === 'GET' ? null : 'a'.repeat(64), csrfToken: 'test-tutorial-csrf-only',
        storage: { allowed: true, reason: 'subscribed', completedRuns: 0, freeRuns: 5 } } }));
    const repository = new ShopifyCloudRepository({ request }, driver, new LocalPlayerRepository(driver), decodePlayer);
    const imported = await repository.load();
    await repository.flush();
    expect(imported.settings.tutorialHintsSeen).toEqual(guest.settings.tutorialHintsSeen);
    const sent = request.mock.calls.find(([method]) => method === 'POST')?.[1] as { player: Player };
    expect(sent.player.settings.tutorialHintsSeen).toEqual(guest.settings.tutorialHintsSeen);
    const backup = JSON.parse(driver.getItem('pfusch:player:v1:shopify:123')!) as { player: Player };
    expect(backup.player.settings.tutorialHintsSeen).toEqual(guest.settings.tutorialHintsSeen);
    expect(driver.getItem('pfusch:player:v1:guest-imported')).toBe('123');
  });
});
