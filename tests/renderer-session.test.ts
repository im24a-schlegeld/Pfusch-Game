import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebGLRenderer, WebGLRenderTarget } from 'three';
import { createRendererSessionPool } from '../app/game/rendererSession';

function setup() {
  vi.useFakeTimers();
  const mocks = new Map<WebGLRenderer, {
    dispose: ReturnType<typeof vi.fn>;
    environmentDispose: ReturnType<typeof vi.fn>;
    forceContextLoss: ReturnType<typeof vi.fn>;
  }>();
  const create = vi.fn(() => {
    const canvas = Object.assign(new EventTarget(), { remove: vi.fn() });
    const context = { isContextLost: vi.fn(() => false) };
    const renderer = {
      domElement: canvas,
      getContext: () => context,
      renderLists: { dispose: vi.fn() },
      dispose: vi.fn(),
      forceContextLoss: vi.fn(),
    };
    const environment = { dispose: vi.fn() };
    mocks.set(renderer as unknown as WebGLRenderer, {
      dispose: renderer.dispose,
      environmentDispose: environment.dispose,
      forceContextLoss: renderer.forceContextLoss,
    });
    return {
      renderer: renderer as unknown as WebGLRenderer,
      environment: environment as unknown as WebGLRenderTarget,
    };
  });
  return { pool: createRendererSessionPool(create, 30_000), create, mocks };
}

afterEach(() => vi.useRealTimers());

describe('bounded renderer sessions', () => {
  it('reuses the context and PMREM, retiring old material programs after the next frame', () => {
    const { pool, create } = setup();
    const menu = pool.acquire(true);
    menu.afterRender();
    const cleanMenu = vi.fn();
    menu.release(cleanMenu);
    const garage = pool.acquire(true);
    expect(garage.renderer).toBe(menu.renderer);
    expect(garage.environment).toBe(menu.environment);
    expect(create).toHaveBeenCalledTimes(1);
    expect(cleanMenu).not.toHaveBeenCalled();
    garage.afterRender();
    garage.afterRender();
    expect(cleanMenu).toHaveBeenCalledTimes(1);
    garage.release();
    pool.disposeIdle();
  });

  it('isolates simultaneous views and antialias settings; transient release is idempotent', () => {
    const { pool, mocks } = setup();
    const menu = pool.acquire(true);
    const concurrent = pool.acquire(true);
    const low = pool.acquire(false);
    expect(concurrent.renderer).not.toBe(menu.renderer);
    expect(low.renderer).not.toBe(menu.renderer);
    concurrent.afterRender();
    const cleanup = vi.fn();
    concurrent.release(cleanup);
    concurrent.release(cleanup);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(mocks.get(concurrent.renderer)!.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.get(menu.renderer)!.dispose).not.toHaveBeenCalled();
    menu.release();
    low.release();
    pool.disposeIdle();
  });

  it('keeps one warm material set across StrictMode mounts and early unmounts', () => {
    const { pool } = setup();
    const initial = pool.acquire(true);
    initial.afterRender();
    const prepared = vi.fn();
    initial.release(prepared);
    const interrupted = pool.acquire(true);
    const unrendered = vi.fn();
    interrupted.release(unrendered);
    expect(unrendered).toHaveBeenCalledTimes(1);
    expect(prepared).not.toHaveBeenCalled();
    const active = pool.acquire(true);
    active.afterRender();
    expect(prepared).toHaveBeenCalledTimes(1);
    active.release();
    pool.disposeIdle();
  });

  it('expires idle resources but cancels expiration while a lease is active', () => {
    const { pool, mocks } = setup();
    const first = pool.acquire(true);
    first.afterRender();
    const cleanup = vi.fn();
    first.release(cleanup);
    vi.advanceTimersByTime(29_000);
    const active = pool.acquire(true);
    vi.advanceTimersByTime(60_000);
    expect(mocks.get(active.renderer)!.dispose).not.toHaveBeenCalled();
    active.afterRender();
    active.release();
    vi.advanceTimersByTime(30_000);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(mocks.get(active.renderer)!.environmentDispose).toHaveBeenCalledTimes(1);
    expect(mocks.get(active.renderer)!.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.get(active.renderer)!.forceContextLoss).toHaveBeenCalledTimes(1);
  });

  it('discards lost contexts without destroying their active replacement', () => {
    const { pool, mocks } = setup();
    const lost = pool.acquire(true);
    lost.renderer.domElement.dispatchEvent(new Event('webglcontextlost'));
    const replacement = pool.acquire(true);
    expect(replacement.renderer).not.toBe(lost.renderer);
    lost.release();
    expect(mocks.get(lost.renderer)!.dispose).toHaveBeenCalledTimes(1);
    replacement.afterRender();
    replacement.release();
    expect(pool.acquire(true).renderer).toBe(replacement.renderer);
    expect(mocks.get(replacement.renderer)!.dispose).not.toHaveBeenCalled();
  });

  it('drops an idle context immediately on context loss', () => {
    const { pool, mocks } = setup();
    const idle = pool.acquire(true);
    idle.afterRender();
    const cleanup = vi.fn();
    idle.release(cleanup);
    idle.renderer.domElement.dispatchEvent(new Event('webglcontextlost'));
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(mocks.get(idle.renderer)!.environmentDispose).toHaveBeenCalledTimes(1);
    const next = pool.acquire(true);
    expect(next.renderer).not.toBe(idle.renderer);
    next.release();
    pool.disposeIdle();
  });
});
