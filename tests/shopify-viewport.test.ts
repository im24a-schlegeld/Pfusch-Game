import { describe, expect, it, vi } from 'vitest';
import { shopifyParentOrigin } from '../app/services/shopifyBridge';
import { rideViewportParentOrigin, syncShopifyRideViewport } from '../app/services/shopifyViewport';

function harness(standalone = false) {
  const postMessage = vi.fn();
  const listeners = new Map<string, () => void>();
  const host = {
    parent: { postMessage },
    location: { origin: 'http://127.0.0.1:5175' },
    addEventListener: vi.fn((type: string, listener: () => void) => listeners.set(type, listener)),
    removeEventListener: vi.fn((type: string) => listeners.delete(type)),
  };
  if (standalone) Object.assign(host, { parent: host });
  return { host: host as unknown as Window, postMessage, listeners };
}

describe('embedded ride viewport lifecycle', () => {
  it('enters ride mode only on the exact shop origin and returns to shop layout on cleanup', () => {
    const context = harness();
    const dispose = syncShopifyRideViewport(context.host, 'https://pfusch-clothing.ch', true);
    expect(context.postMessage).toHaveBeenLastCalledWith({ type: 'pfusch:ride-viewport', version: 1, active: true }, 'https://pfusch-clothing.ch');
    dispose();
    expect(context.postMessage).toHaveBeenLastCalledWith({ type: 'pfusch:ride-viewport', version: 1, active: false }, 'https://pfusch-clothing.ch');
    expect(context.listeners.size).toBe(0);
  });

  it('releases the header on pagehide and restores a cached active ride on pageshow', () => {
    const context = harness();
    syncShopifyRideViewport(context.host, 'https://pfusch-clothing.ch', true);
    context.listeners.get('pagehide')!();
    expect(context.postMessage.mock.lastCall?.[0].active).toBe(false);
    context.listeners.get('pageshow')!();
    expect(context.postMessage.mock.lastCall?.[0].active).toBe(true);
    expect([...context.listeners.keys()]).toEqual(['pageshow', 'pagehide']);
  });

  it('keeps the shop layout when restoring a garage page', () => {
    const context = harness();
    syncShopifyRideViewport(context.host, 'https://pfusch-clothing.ch', false);
    context.listeners.get('pageshow')!();
    expect(context.postMessage.mock.calls.every(([message]) => message.active === false)).toBe(true);
  });

  it.each([null, 'https://example.com', 'http://pfusch-clothing.ch', 'http://localhost:5175'])('ignores untrusted or different-origin parent %s', (origin) => {
    const context = harness();
    syncShopifyRideViewport(context.host, origin, true)();
    expect(context.postMessage).not.toHaveBeenCalled();
    expect(context.listeners.size).toBe(0);
  });

  it('does not intercept a standalone browser', () => {
    const context = harness(true);
    syncShopifyRideViewport(context.host, 'https://pfusch-clothing.ch', true)();
    expect(context.postMessage).not.toHaveBeenCalled();
  });

  it('allows an explicit same-origin loopback development layout preview without enabling cloud auth', () => {
    const context = harness();
    const origin = rideViewportParentOrigin(true, 'http://127.0.0.1:5175/.build-check/embedded-game-qa.html', 'http://127.0.0.1:5175');
    expect(origin).toBe('http://127.0.0.1:5175');
    syncShopifyRideViewport(context.host, origin, true)();
    expect(context.postMessage).toHaveBeenCalledTimes(2);
    expect(shopifyParentOrigin(true, 'http://127.0.0.1:5175/')).toBeNull();
    expect(rideViewportParentOrigin(true, 'http://127.0.0.1:5175/')).toBeNull();
    expect(rideViewportParentOrigin(true, 'http://localhost:5175/', 'http://127.0.0.1:5175')).toBeNull();
    expect(rideViewportParentOrigin(true, 'https://example.com/', 'https://example.com')).toBeNull();
    expect(rideViewportParentOrigin(false, 'http://127.0.0.1:5175/', 'http://127.0.0.1:5175')).toBeNull();
  });
});
