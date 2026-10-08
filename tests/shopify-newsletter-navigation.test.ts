import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../integrations/shopify/assets/pfusch-cloud-bridge.js', import.meta.url), 'utf8');
interface Bridge {
  connectedCallback(): void;
  disconnectedCallback(): void;
  handle(event: { origin: string; source: object; data: unknown }): Promise<void>;
}
function harness(customerState: string | null = null) {
  let Registered: new () => Bridge;
  const frameWindow = { postMessage: vi.fn() };
  const titleFocus = vi.fn(), frameFocus = vi.fn(), fetch = vi.fn(), navigate = vi.fn();
  const listeners = new Map<string, (event?: unknown) => void>();
  const mainClass = { add: vi.fn(), remove: vi.fn() };
  const pageClass = { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() };
  const gameClass = { remove: vi.fn(), toggle: vi.fn() };
  const setProperty = vi.fn();
  const observe = vi.fn(), disconnect = vi.fn();
  let resizeCallback: () => void;
  const frame = { src: 'https://pfusch-game.vercel.app/', contentWindow: frameWindow, isConnected: true, focus: frameFocus };
  const dialog = {
    open: false,
    showModal: vi.fn(() => { dialog.open = true; }),
    close: vi.fn(() => { dialog.open = false; listeners.get('close')?.(); }),
    addEventListener: vi.fn((type: string, callback: (event?: unknown) => void) => listeners.set(type, callback)),
    removeEventListener: vi.fn((type: string) => listeners.delete(type)),
    querySelector: vi.fn(() => ({ focus: titleFocus })),
  };
  const header = {};
  const viewport = { height: 844, offsetTop: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  let top = 115;
  class Element {
    isConnected = true;
    classList = gameClass;
    style = { setProperty };
    querySelector(selector: string) { return selector === 'iframe' ? frame : dialog; }
    closest() { return { classList: mainClass }; }
    getBoundingClientRect() { return { top }; }
    getAttribute(name: string) {
      if (name === 'data-customer-state') return customerState;
      if (name === 'data-login-origin') return 'https://wheelie-escape-77d79498580990584461.o2.myshopify.dev';
      return null;
    }
  }
  runInNewContext(source, {
    URL, HTMLElement: Element, TextEncoder, AbortController, setTimeout, clearTimeout, fetch,
    ResizeObserver: class {
      constructor(callback: () => void) { resizeCallback = callback; }
      observe = observe;
      disconnect = disconnect;
    },
    customElements: { get: () => undefined, define: (_name: string, constructor: new () => Bridge) => { Registered = constructor; } },
    location: { origin: 'https://pfusch-clothing.ch', href: 'https://pfusch-clothing.ch/?preview_theme_id=189577920841&view=wheelie-escape' },
    document: {
      activeElement: frame,
      documentElement: { classList: pageClass },
      querySelectorAll: () => [header],
      querySelector: () => null,
    },
    window: { addEventListener: vi.fn(), removeEventListener: vi.fn(), visualViewport: viewport, innerHeight: 844, location: { assign: navigate } },
  });
  const bridge = new Registered!();
  bridge.connectedCallback();
  return { bridge, frameWindow, titleFocus, frameFocus, fetch, dialog, listeners, pageClass, mainClass, gameClass, setProperty, observe, disconnect, navigate,
    resize: (nextTop: number, nextHeight: number, offsetTop = 0) => {
      top = nextTop; viewport.height = nextHeight; viewport.offsetTop = offsetTop; resizeCallback();
    } };
}

const openMessage = { type: 'pfusch:open-newsletter', version: 1 };
describe('newsletter navigation from the embedded game', () => {
  it('starts server OAuth at the configured Oxygen origin and returns to the game', async () => {
    const context = harness();
    const message = { type: 'pfusch:open-login', version: 1 };
    await context.bridge.handle({ origin: 'https://evil.example', source: context.frameWindow, data: message });
    await context.bridge.handle({ origin: 'https://pfusch-game.vercel.app', source: context.frameWindow, data: { ...message, customerId: '123' } });
    expect(context.navigate).not.toHaveBeenCalled();
    await context.bridge.handle({ origin: 'https://pfusch-game.vercel.app', source: context.frameWindow, data: message });
    const login = new URL(context.navigate.mock.calls[0][0]);
    expect(login.origin + login.pathname).toBe('https://wheelie-escape-77d79498580990584461.o2.myshopify.dev/auth/login');
    expect(login.searchParams.get('return_to')).toBe('https://wheelie-escape-77d79498580990584461.o2.myshopify.dev/');
    expect(context.fetch).not.toHaveBeenCalled();
  });
  it('keeps the newsletter closed on load and opens the modal without subscribing or leaving the draft', async () => {
    const context = harness();
    expect(context.dialog.showModal).not.toHaveBeenCalled();
    await context.bridge.handle({ origin: 'https://pfusch-game.vercel.app', source: context.frameWindow, data: openMessage });
    expect(context.dialog.showModal).toHaveBeenCalledOnce();
    expect(context.titleFocus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(context.fetch).not.toHaveBeenCalled();
  });

  it('returns focus to the game when the close button or native Escape closes the modal', async () => {
    const context = harness();
    await context.bridge.handle({ origin: 'https://pfusch-game.vercel.app', source: context.frameWindow, data: openMessage });
    context.listeners.get('click')?.({ target: { closest: () => ({}) } });
    expect(context.dialog.close).toHaveBeenCalledOnce();
    expect(context.frameFocus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    await context.bridge.handle({ origin: 'https://pfusch-game.vercel.app', source: context.frameWindow, data: openMessage });
    // Browsers dispatch close after the dialog's native Escape handling.
    context.dialog.close();
    expect(context.frameFocus).toHaveBeenCalledTimes(2);
  });

  it('ignores repeated open events while the form is in use', async () => {
    const context = harness();
    await context.bridge.handle({ origin: 'https://pfusch-game.vercel.app', source: context.frameWindow, data: openMessage });
    await context.bridge.handle({ origin: 'https://pfusch-game.vercel.app', source: context.frameWindow, data: openMessage });
    expect(context.dialog.showModal).toHaveBeenCalledOnce();
    expect(context.titleFocus).toHaveBeenCalledOnce();
  });

  it.each(['origin', 'source', 'payload'] as const)('rejects a message with an untrusted %s', async (invalid) => {
    const context = harness();
    await context.bridge.handle({ origin: invalid === 'origin' ? 'https://example.com' : 'https://pfusch-game.vercel.app',
      source: invalid === 'source' ? {} : context.frameWindow,
      data: { ...openMessage, ...(invalid === 'payload' ? { subscribe: true } : {}) } });
    expect(context.dialog.showModal).not.toHaveBeenCalled();
    expect(context.titleFocus).not.toHaveBeenCalled();
    expect(context.fetch).not.toHaveBeenCalled();
  });

  it('fits below the measured shop header and follows mobile viewport changes', () => {
    const context = harness();
    expect(context.setProperty).toHaveBeenLastCalledWith('--pfusch-game-height', '729px');
    expect(context.observe).toHaveBeenCalledOnce();
    context.resize(83, 640);
    expect(context.setProperty).toHaveBeenLastCalledWith('--pfusch-game-height', '557px');
    context.resize(83, 400, 40);
    expect(context.setProperty).toHaveBeenLastCalledWith('--pfusch-game-height', '357px');
  });

  it('removes page-specific layout and observer/listeners when the game section is removed', () => {
    const context = harness();
    context.bridge.disconnectedCallback();
    expect(context.disconnect).toHaveBeenCalledOnce();
    expect(context.mainClass.remove).toHaveBeenCalledWith('pfusch-game-main');
    expect(context.pageClass.remove).toHaveBeenCalledWith('pfusch-game-page', 'pfusch-game-ride');
    expect(context.gameClass.remove).toHaveBeenCalledWith('pfusch-game--riding');
    expect(context.dialog.removeEventListener).toHaveBeenCalledTimes(2);
  });
});

describe('explicit Liquid guest trial without an account proxy', () => {
  const request = { type: 'pfusch:cloud-request', version: 1, requestId: 'guest-request-00001', method: 'GET', resource: 'player' };
  it('uses only a server-rendered guest marker to select the local trial', async () => {
    const context = harness('guest');
    await context.bridge.handle({ origin: 'https://pfusch-game.vercel.app', source: context.frameWindow, data: request });
    expect(context.frameWindow.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: 'pfusch:cloud-response', version: 1, requestId: request.requestId, status: 401, data: { error: 'guest' },
    }, 'https://pfusch-game.vercel.app');
    expect(context.fetch).not.toHaveBeenCalled();
  });

  it.each(['customer', 'unknown', '', 'Guest', null])('keeps the real proxy and fails closed for %s pages', async state => {
    const context = harness(state);
    await context.bridge.handle({ origin: 'https://pfusch-game.vercel.app', source: context.frameWindow, data: request });
    expect(context.fetch).toHaveBeenCalledOnce();
    expect(context.frameWindow.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ status: 503, data: { error: 'unavailable' } }), 'https://pfusch-game.vercel.app');
  });

  it('never bypasses the proxy for a guest write', async () => {
    const context = harness('guest');
    await context.bridge.handle({ origin: 'https://pfusch-game.vercel.app', source: context.frameWindow,
      data: { ...request, method: 'POST', payload: { player: {}, compareDigest: null, csrfToken: 'test-only-csrf-token' } } });
    expect(context.fetch).toHaveBeenCalledOnce();
    expect(context.frameWindow.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ status: 503 }), 'https://pfusch-game.vercel.app');
  });

  it('does not treat public rankings as a guest permission decision', async () => {
    const context = harness('guest');
    await context.bridge.handle({ origin: 'https://pfusch-game.vercel.app', source: context.frameWindow,
      data: { ...request, resource: 'leaderboard', period: 'day' } });
    expect(context.fetch).toHaveBeenCalledOnce();
  });

  it.each([{ payload: {} }, { period: 'day' }, { method: 'POST', payload: {} }])('validates the request before any guest response: %j', async invalid => {
    const context = harness('guest');
    await context.bridge.handle({ origin: 'https://pfusch-game.vercel.app', source: context.frameWindow, data: { ...request, ...invalid } });
    expect(context.fetch).not.toHaveBeenCalled();
    expect(context.frameWindow.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ status: 400 }), 'https://pfusch-game.vercel.app');
  });

  it.each(['origin', 'source', 'payload'] as const)('rejects untrusted guest %s', async invalid => {
    const context = harness('guest');
    await context.bridge.handle({ origin: invalid === 'origin' ? 'https://example.com' : 'https://pfusch-game.vercel.app',
      source: invalid === 'source' ? {} : context.frameWindow,
      data: { ...request, ...(invalid === 'payload' ? { customerState: 'guest' } : {}) } });
    expect(context.fetch).not.toHaveBeenCalled();
    expect(context.frameWindow.postMessage).not.toHaveBeenCalled();
  });
});

describe('embedded ride viewport', () => {
  it('fills the viewport for the ride/results and restores measured header space only when requested', async () => {
    const context = harness();
    expect(context.pageClass.toggle).not.toHaveBeenCalled();
    await context.bridge.handle({ origin: 'https://pfusch-game.vercel.app', source: context.frameWindow,
      data: { type: 'pfusch:ride-viewport', version: 1, active: true } });
    expect(context.gameClass.toggle).toHaveBeenLastCalledWith('pfusch-game--riding', true);
    expect(context.pageClass.toggle).toHaveBeenLastCalledWith('pfusch-game-ride', true);
    expect(context.setProperty).toHaveBeenLastCalledWith('--pfusch-game-height', '844px');
    context.resize(115, 640);
    expect(context.setProperty).toHaveBeenLastCalledWith('--pfusch-game-height', '640px');
    // Opening/closing consent must not leave the ride's full viewport.
    await context.bridge.handle({ origin: 'https://pfusch-game.vercel.app', source: context.frameWindow, data: openMessage });
    context.dialog.close();
    expect(context.pageClass.toggle).toHaveBeenCalledTimes(1);
    await context.bridge.handle({ origin: 'https://pfusch-game.vercel.app', source: context.frameWindow,
      data: { type: 'pfusch:ride-viewport', version: 1, active: false } });
    expect(context.gameClass.toggle).toHaveBeenLastCalledWith('pfusch-game--riding', false);
    expect(context.pageClass.toggle).toHaveBeenLastCalledWith('pfusch-game-ride', false);
    expect(context.setProperty).toHaveBeenLastCalledWith('--pfusch-game-height', '525px');
    expect(context.fetch).not.toHaveBeenCalled();
  });

  it.each(['origin', 'source', 'version', 'active', 'extra'] as const)('rejects invalid ride viewport %s', async invalid => {
    const context = harness();
    await context.bridge.handle({
      origin: invalid === 'origin' ? 'https://example.com' : 'https://pfusch-game.vercel.app',
      source: invalid === 'source' ? {} : context.frameWindow,
      data: { type: 'pfusch:ride-viewport', version: invalid === 'version' ? 2 : 1,
        active: invalid === 'active' ? 'true' : true, ...(invalid === 'extra' ? { fullscreen: true } : {}) },
    });
    expect(context.gameClass.toggle).not.toHaveBeenCalled();
    expect(context.pageClass.toggle).not.toHaveBeenCalled();
    expect(context.fetch).not.toHaveBeenCalled();
  });
});
