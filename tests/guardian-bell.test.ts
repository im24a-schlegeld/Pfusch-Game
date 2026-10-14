import { afterEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { GuardianBell, GuardianBellBurst, createGuardianBellBurstCompletion } from '../app/ui/GuardianBell';

afterEach(() => vi.useRealTimers());

it('renders an accessible code-native bell icon without external imagery or interactive controls', () => {
  const icon = renderToStaticMarkup(createElement(GuardianBell, { size: 40, className: 'test-bell' }));
  expect(icon).toContain('role="img"'); expect(icon).toContain('aria-label="Guardian Bell"');
  expect(icon).toContain('width="40"'); expect(icon).toContain('class="guardian-bell test-bell"');
  expect(icon).toContain('<path'); expect(icon).toContain('<ellipse');
  expect(icon).not.toMatch(/<image\b|<img\b|<button\b|<a\b|tabindex=/i);
  const burst = renderToStaticMarkup(createElement(GuardianBellBurst, { onComplete() {}, reducedMotion: true }));
  expect(burst).toContain('aria-hidden="true"');
  expect(burst).not.toMatch(/<button\b|<a\b|tabindex=/i);
});

it('gives the body and hanger independent angles while keeping the entire attached bell inside its icon', async () => {
  const svg = renderToStaticMarkup(createElement(GuardianBell, { size: 512 }));
  const angles = [...svg.matchAll(/transform="rotate\(([-\d.]+)/g)].map(match => Number(match[1]));
  expect(angles).toHaveLength(2);
  expect(angles[0] * angles[1]).toBeLessThan(0);
  expect(Math.abs(angles[0] - angles[1])).toBeGreaterThanOrEqual(12);
  try {
    const probe = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'); probe.free();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('Wasm has not been initialized')) throw error;
    await initWasm(await readFile(createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm')));
  }
  const decoder = new Resvg(svg), image = decoder.render(), pixels = image.pixels;
  try {
    const solid = new Uint8Array(image.width * image.height);
    let minX = image.width, minY = image.height, maxX = -1, maxY = -1;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const index = y * image.width + x;
      if (pixels[index * 4 + 3] === 0) continue;
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      solid[index] = pixels[index * 4 + 3] > 127 ? 1 : 0;
    }
    expect(minX).toBeGreaterThan(2); expect(minY).toBeGreaterThan(2);
    expect(maxX).toBeLessThan(image.width - 3); expect(maxY).toBeLessThan(image.height - 3);
    let components = 0;
    for (let index = 0; index < solid.length; index++) if (solid[index]) {
      const queue = [index]; solid[index] = 0; let count = 0;
      for (let head = 0; head < queue.length; head++) {
        const current = queue[head]; count++;
        for (const next of [current - image.width, current + image.width, current - 1, current + 1])
          if (next >= 0 && next < solid.length && solid[next]) { solid[next] = 0; queue.push(next); }
      }
      if (count > 20) components++;
    }
    expect(components).toBe(1); // A detached bail or neck creates another real raster component.
  } finally { image.free(); decoder.free(); }
});

it('settles once when animation completion races its fallback timer', () => {
  vi.useFakeTimers(); const onComplete = vi.fn();
  const burst = createGuardianBellBurstCompletion(onComplete);
  vi.advanceTimersByTime(799); expect(onComplete).not.toHaveBeenCalled();
  burst.complete(); vi.runAllTimers(); burst.complete();
  expect(onComplete).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});

it('continues after a bounded fallback when no animation event arrives', () => {
  vi.useFakeTimers(); const onComplete = vi.fn();
  const burst = createGuardianBellBurstCompletion(onComplete);
  vi.advanceTimersByTime(800); expect(onComplete).toHaveBeenCalledTimes(1);
  burst.complete(); expect(onComplete).toHaveBeenCalledTimes(1);
});

it('uses a brief reduced-motion completion and cancels safely on unmount', () => {
  vi.useFakeTimers(); const onComplete = vi.fn();
  const burst = createGuardianBellBurstCompletion(onComplete, true);
  vi.advanceTimersByTime(179); expect(onComplete).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1); expect(onComplete).toHaveBeenCalledTimes(1);
  const cancelled = createGuardianBellBurstCompletion(onComplete);
  cancelled.cancel(); vi.runAllTimers(); cancelled.complete();
  expect(onComplete).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
