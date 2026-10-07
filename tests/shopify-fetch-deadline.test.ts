import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withFetchDeadline } from '../server/shopify/http';

const anyDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'any')!;

describe('fetch deadline on workers without AbortSignal.any', () => {
  beforeEach(() => { Object.defineProperty(AbortSignal, 'any', { ...anyDescriptor, value: undefined }); });
  afterEach(() => {
    Object.defineProperty(AbortSignal, 'any', anyDescriptor);
    vi.restoreAllMocks();
  });

  it('preserves caller cancellation and releases its listeners', async () => {
    const caller = new AbortController();
    const removed = vi.spyOn(caller.signal, 'removeEventListener');
    let combined!: AbortSignal;
    const request = vi.fn<typeof fetch>(async (_input, init) => {
      combined = init!.signal!;
      return new Response('ready');
    });
    await withFetchDeadline(request, 1000)('https://example.invalid', { signal: caller.signal });
    expect(combined.aborted).toBe(false);
    const reason = new Error('caller cancelled');
    caller.abort(reason);
    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe(reason);
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('passes an already aborted caller through without adding listeners', async () => {
    const caller = new AbortController();
    const reason = new Error('already cancelled');
    caller.abort(reason);
    const added = vi.spyOn(caller.signal, 'addEventListener');
    const request = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init!.signal!.aborted).toBe(true);
      throw init!.signal!.reason;
    });
    await expect(withFetchDeadline(request, 1000)('https://example.invalid', { signal: caller.signal }))
      .rejects.toBe(reason);
    expect(added).not.toHaveBeenCalled();
  });

  it('keeps the shared deadline after response headers and aborts a pending body', async () => {
    const caller = new AbortController();
    const removed = vi.spyOn(caller.signal, 'removeEventListener');
    const request = vi.fn<typeof fetch>(async (_input, init) => new Response(new ReadableStream({
      start(controller) {
        const signal = init!.signal!;
        if (signal.aborted) controller.error(signal.reason);
        else signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
      },
    })));
    const bounded = withFetchDeadline(request, 20);
    const response = await bounded('https://example.invalid', { signal: caller.signal });
    await expect(response.text()).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));

    // Reusing the operation after its deadline cannot grant another timeout.
    const later = await bounded('https://example.invalid', { signal: new AbortController().signal });
    await expect(later.text()).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
