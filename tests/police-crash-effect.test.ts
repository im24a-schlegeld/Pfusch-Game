import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera } from 'three';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import {
  createPoliceCrashEffect,
  policeImpactPlacement,
} from '../app/game/policeCrashEffect';
import type { PoliceImpactEvent } from '../app/game/policePursuit';

describe('offscreen police impact feedback', () => {
  it.each([390 / 844, 320 / 568, 1280 / 720])(
    'projects on/offscreen impacts without changing camera at aspect %s',
    (aspect) => {
      const camera = new PerspectiveCamera(80, aspect, 0.1, 190);
      camera.position.set(0, 4.4, 10.4);
      camera.lookAt(0, 1.4, -12);
      const pose = [
        ...camera.position.toArray(),
        ...camera.quaternion.toArray(),
      ];
      const impact: PoliceImpactEvent = {
        serial: 1,
        targetSpawnId: 42,
        x: 0,
        z: 18,
        worldDistance: 118,
        fallback: false,
      };
      expect(policeImpactPlacement(impact, camera, 100).show).toBe(false);
      for (const distant of [
        { ...impact, worldDistance: 80 },
        { ...impact, x: 60 },
        { ...impact, fallback: true },
      ]) {
        const placement = policeImpactPlacement(distant, camera, 100);
        expect(placement.show).toBe(true);
        expect(placement.x).toBeGreaterThanOrEqual(20);
        expect(placement.x).toBeLessThanOrEqual(80);
        expect(placement.y).toBe(100);
      }
      expect([
        ...camera.position.toArray(),
        ...camera.quaternion.toArray(),
      ]).toEqual(pose);
    },
  );

  it('retains the actual lateral crash side behind the camera without mirroring or recentering', () => {
    const camera = new PerspectiveCamera(80, 320 / 568, 0.1, 190);
    camera.position.set(0, 4.4, 10.4);
    camera.lookAt(0, 1.4, -12);
    const impact: PoliceImpactEvent = {
      serial: 1,
      targetSpawnId: 42,
      x: -1.8,
      z: -20,
      worldDistance: 80,
      fallback: false,
    };
    const left = policeImpactPlacement(impact, camera, 100);
    const right = policeImpactPlacement({ ...impact, x: 1.8 }, camera, 100);
    expect(left.show).toBe(true);
    expect(right.show).toBe(true);
    expect(left.x).toBeLessThan(40);
    expect(right.x).toBeGreaterThan(60);
    expect(left.x + right.x).toBeCloseTo(100);
    expect(left.y).toBe(100);
    expect(right.y).toBe(100);
    // Moving the same wreck farther behind the rider preserves its side.
    expect(policeImpactPlacement(impact, camera, 130).x).toBeCloseTo(left.x);
  });

  it('places the burst relative to the camera rather than the road center', () => {
    const camera = new PerspectiveCamera(80, 390 / 844, 0.1, 190);
    camera.position.set(2.8, 4.4, 10.4);
    camera.lookAt(2.8, 1.4, -12);
    const placement = policeImpactPlacement(
      {
        serial: 1,
        targetSpawnId: 42,
        x: 1,
        z: -20,
        worldDistance: 80,
        fallback: false,
      },
      camera,
      100,
    );
    expect(placement.show).toBe(true);
    expect(placement.x).toBeLessThan(40);
    expect(placement.y).toBe(100);
  });
});

describe('police burst lifecycle', () => {
  afterEach(() => vi.unstubAllGlobals());
  function setup(initialSerial = 0) {
    function shape() {
      const attributes: Record<string, string> = {};
      return {
        attributes,
        setAttribute: vi.fn((name: string, value: string) => {
          attributes[name] = value;
        }),
      };
    }
    const fire = shape(),
      core = shape(),
      ring = shape();
    const embers = Array.from({ length: 8 }, shape);
    const shapes = [fire, core, ring, ...embers];
    const namedShapes: Record<string, ReturnType<typeof shape>> = {
      '.police-impact-fire': fire,
      '.police-impact-core': core,
      '.police-impact-ring': ring,
    };
    const node = {
      style: {} as Record<string, string>,
      dataset: {} as Record<string, string>,
      className: '',
      innerHTML: '',
      querySelector: vi.fn((selector: string) => namedShapes[selector]),
      querySelectorAll: vi.fn((selector: string) =>
        selector === '.police-impact-ember' ? embers : [],
      ),
      setAttribute: vi.fn(),
      remove: vi.fn(),
    };
    const host = { appendChild: vi.fn() };
    vi.stubGlobal('document', { createElement: vi.fn(() => node) });
    const effect = createPoliceCrashEffect(
      host as unknown as HTMLElement,
      initialSerial,
    );
    const camera = new PerspectiveCamera(80, 390 / 844, 0.1, 190);
    camera.position.set(0, 4.4, 10.4);
    camera.lookAt(0, 1.4, -12);
    const impact: PoliceImpactEvent = {
      serial: 1,
      targetSpawnId: 42,
      x: 0,
      z: -20,
      worldDistance: 80,
      fallback: false,
    };
    return { node, host, effect, camera, impact, shapes };
  }

  it('does not replay a historical event when the renderer is rebuilt, but displays the next one', () => {
    const { node, host, effect, camera, impact } = setup(1);
    for (let count = 0; count < 20; count++)
      effect.update(impact, camera, 100, 0.1, true, false);
    expect(node.style.display).toBe('none');
    expect(node.dataset.policeImpact).toBeUndefined();
    effect.update({ ...impact, serial: 2 }, camera, 100, 0.01, true, false);
    expect(node.style.display).toBe('block');
    expect(node.dataset.policeImpact).toBe('2');
    expect(host.appendChild).toHaveBeenCalledTimes(1);
    effect.dispose();
    expect(node.remove).toHaveBeenCalledTimes(1);
  });

  it('gives the real fire, core and eight embers black boundaries in the existing reusable SVG', () => {
    const { node, host, effect, camera, impact } = setup();
    for (const layer of ['fire', 'core'])
      expect(node.innerHTML).toMatch(new RegExp(`class="police-impact-${layer}"[^>]*stroke="#080a0e"[^>]*stroke-width="3.5"[^>]*stroke-linejoin="round"`));
    expect(node.innerHTML.match(/class="police-impact-ember"[^>]*stroke="#080a0e"/g)).toHaveLength(8);
    const original = node.innerHTML;
    effect.update(impact, camera, 100, 0.1, true, true);
    effect.update({ ...impact, serial: 2 }, camera, 100, 0.1, true, false);
    expect(node.innerHTML).toBe(original);
    expect(host.appendChild).toHaveBeenCalledTimes(1);
  });

  it('rasterizes the real closing fire outline and retains every visible frame inside its viewport', async () => {
    try {
      const probe = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
      probe.free();
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('Wasm has not been initialized')) throw error;
      await initWasm(await readFile(createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm')));
    }
    const { node, effect, camera, impact, shapes } = setup();
    let closingOutlinePixels = 0;
    for (let frame = 1; frame <= 20; frame++) {
      effect.update(impact, camera, 100, 0.05, true, false);
      expect(node.style.display).toBe('block');
      let ember = 3;
      // Serialize attributes actually written by update() onto the production
      // SVG paths. This existing lightweight DOM fixture avoids a browser/GPU.
      const svg = node.innerHTML.replace(/(<(?:g|ellipse)\b[^>]*?class="police-impact-(fire|core|ring|ember)"[^>]*?)(\/?>)/g,
        (_, tag: string, name: string, end: string) => {
          const shape = shapes[name === 'ember' ? ember++ : { fire: 0, core: 1, ring: 2 }[name as 'fire' | 'core' | 'ring']];
          return tag + Object.entries(shape.attributes).map(([key, value]) => ` ${key}="${value}"`).join('') + end;
        });
      const decoder = new Resvg(svg), image = decoder.render(), pixels = image.pixels;
      try {
        let bottom = -1;
        for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
          const offset = (y * image.width + x) * 4;
          if (pixels[offset + 3] > 0) bottom = Math.max(bottom, y);
          if (frame === 5 && y >= 232 && y <= 236 && x >= 40 && x <= 320 &&
              pixels[offset + 3] > 150 && Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) < 50)
            closingOutlinePixels++;
        }
        expect(bottom, `Visible age ${frame * 0.05} must leave room below fire, ring and embers`).toBeLessThan(image.height - 2);
        const [width, height] = node.style.aspectRatio.split('/').map(Number);
        expect(width / height).toBeCloseTo(image.width / image.height, 8);
      } finally { image.free(); decoder.free(); }
    }
    expect(closingOutlinePixels).toBeGreaterThan(100); // Real black baseline, not a mirrored viewBox assertion.
    effect.dispose();
  });

  it('freezes throughout pause or blur and expires without replay during an active crash presentation', () => {
    const { node, effect, camera, impact, shapes } = setup();
    effect.update(impact, camera, 100, 0.05, true, false);
    const initialTransforms = shapes.map((shape) => shape.attributes.transform);
    effect.update(impact, camera, 100, 0.05, true, false);
    for (let index = 0; index < shapes.length; index++) {
      expect(shapes[index].attributes.transform).toBeDefined();
      expect(shapes[index].attributes.transform).not.toBe(
        initialTransforms[index],
      );
    }
    const paused = { ...node.style };
    const pausedShapes = shapes.map((shape) => ({ ...shape.attributes }));
    for (let count = 0; count < 80; count++)
      effect.update(impact, camera, 100, 0.1, false, false);
    expect(node.style).toEqual(paused);
    expect(shapes.map((shape) => shape.attributes)).toEqual(pausedShapes);
    expect(node.style.top).toBe('100%');
    expect(node.style.transform).toBe('translate(-50%, -100%)');
    expect(node.innerHTML).not.toMatch(
      /<text\b|police-impact-(?:smoke|cloud)/i,
    );
    // SceneView keeps presentation active for a terminal crash, unlike pause.
    for (let count = 0; count < 11; count++)
      effect.update(impact, camera, 100, 0.1, true, false);
    expect(node.style.display).toBe('none');
    for (let count = 0; count < 20; count++)
      effect.update(impact, camera, 100, 0.1, true, false);
    expect(node.style.display).toBe('none');
    expect(node.dataset.policeImpact).toBe('1');
  });
});
