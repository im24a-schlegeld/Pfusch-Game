import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../integrations/shopify/assets/pfusch-cloud-bridge.js', import.meta.url), 'utf8');
const gameOrigin = 'https://pfusch-game.vercel.app';
const csrfToken = 'test-only-csrf-token';
const uuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const save = { player: { version: 1, coins: 150 }, compareDigest: null, csrfToken };
const ack = { acknowledgedGiftIds: [uuid(1)], csrfToken };

interface Bridge {
  gameOrigin: string;
  frame: { contentWindow: object };
  active: Map<string, AbortController>;
  isConnected: boolean;
  handle(event: { origin: string; source: object; data: unknown }): Promise<void>;
}

function harness() {
  let Registered!: new () => Bridge;
  const frameWindow = { postMessage: vi.fn() };
  const fetch = vi.fn(async () => new Response(JSON.stringify({ acknowledgedGiftIds: [uuid(1)], gifts: [] }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }));
  runInNewContext(source, {
    HTMLElement: class {}, TextEncoder, AbortController, setTimeout, clearTimeout, fetch,
    customElements: { get: () => undefined, define: (_name: string, constructor: new () => Bridge) => { Registered = constructor; } },
  });
  const bridge = new Registered();
  Object.assign(bridge, { gameOrigin, frame: { contentWindow: frameWindow }, active: new Map(), isConnected: true });
  const send = (payload: unknown, overrides: Record<string, unknown> = {}) => bridge.handle({
    origin: gameOrigin, source: frameWindow,
    data: { type: 'pfusch:cloud-request', version: 1, requestId: 'bridge-request-00001', method: 'POST', resource: 'player', payload },
    ...overrides,
  });
  return { send, fetch, frameWindow };
}

describe('storefront cloud bridge POST whitelist', () => {
  it.each([1, 20])('forwards an exact acknowledgment-only batch of %i UUIDs', async count => {
    const context = harness();
    const payload = { ...ack, acknowledgedGiftIds: Array.from({ length: count }, (_, index) => uuid(index + 1)) };
    await context.send(payload);
    expect(context.fetch).toHaveBeenCalledExactlyOnceWith('/apps/pfusch-game/player', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', cache: 'no-store', body: JSON.stringify(payload),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    }));
    expect(context.frameWindow.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: 'pfusch:cloud-response', version: 1, requestId: 'bridge-request-00001', status: 200,
      data: { acknowledgedGiftIds: [uuid(1)], gifts: [] },
    }, gameOrigin);
  });

  it.each([
    ['empty batch', []],
    ['over twenty IDs', Array.from({ length: 21 }, (_, index) => uuid(index + 1))],
    ['duplicate IDs', [uuid(1), uuid(1)]],
    ['non-array batch', uuid(1)],
    ['non-string ID', [1]],
    ['sparse batch', Array(1)],
    ['malformed UUID', ['not-a-uuid']],
    ['truncated UUID', [uuid(1).slice(1)]],
    ['UUID with suffix', [`${uuid(1)}-extra`]],
    ['non-hex UUID', [uuid(1).replace('4000', 'g000')]],
    ['noncanonical UUID', [uuid(1).replace('4000', 'A000')]],
    ['UUID with whitespace', [` ${uuid(1)}`]],
  ])('rejects %s without a proxy request', async (_name, ids) => {
    const context = harness();
    await context.send({ ...ack, acknowledgedGiftIds: ids });
    expect(context.fetch).not.toHaveBeenCalled();
    expect(context.frameWindow.postMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      status: 400, data: { error: 'invalid_request' },
    }), gameOrigin);
  });

  it.each([
    ['missing CSRF', { acknowledgedGiftIds: [uuid(1)] }],
    ['non-string CSRF', { ...ack, csrfToken: null }],
    ['oversized CSRF', { ...ack, csrfToken: 'x'.repeat(4097) }],
    ['extra field', { ...ack, extra: true }],
    ['save combined with acknowledgment', { ...save, ...ack }],
    ['gift sending', { gift: { id: uuid(1), kind: 'coins', amount: 100 }, csrfToken }],
    ['gift sending combined with acknowledgment', { ...ack, gift: { id: uuid(2), kind: 'coins', amount: 100 } }],
    ['gift sending combined with save', { ...save, gifts: [{ id: uuid(1), kind: 'coins', amount: 100 }] }],
  ])('rejects an acknowledgment/write with %s', async (_name, payload) => {
    const context = harness();
    await context.send(payload);
    expect(context.fetch).not.toHaveBeenCalled();
    expect(context.frameWindow.postMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 400 }), gameOrigin);
  });

  it.each([null, 'a'.repeat(64)])('preserves the exact three-key player save with digest %s', async compareDigest => {
    const context = harness();
    const payload = { ...save, compareDigest };
    await context.send(payload);
    expect(context.fetch).toHaveBeenCalledExactlyOnceWith('/apps/pfusch-game/player', expect.objectContaining({ body: JSON.stringify(payload) }));
  });

  it.each([
    { player: {}, csrfToken },
    { ...save, compareDigest: 'invalid' },
    { ...save, player: [] },
    { ...save, csrfToken: 123 },
    { ...save, extra: true },
  ])('preserves rejection of invalid player saves: %j', async payload => {
    const context = harness();
    await context.send(payload);
    expect(context.fetch).not.toHaveBeenCalled();
    expect(context.frameWindow.postMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 400 }), gameOrigin);
  });

  it.each(['origin', 'source'])('rejects acknowledgment messages from an untrusted %s', async invalid => {
    const context = harness();
    await context.send(ack, invalid === 'origin' ? { origin: 'https://evil.example' } : { source: {} });
    expect(context.fetch).not.toHaveBeenCalled();
    expect(context.frameWindow.postMessage).not.toHaveBeenCalled();
  });
});
