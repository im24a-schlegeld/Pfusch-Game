import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  createGarmentGlowUpdater,
  createKeepUpInkGlow,
  inkEmissionPixels,
} from '../app/game/garmentGlow';

function canvasEnvironment() {
  const context = {
    fillStyle: '',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    putImageData: vi.fn(),
  };
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => context,
    }),
  });
  return context;
}

afterEach(() => vi.unstubAllGlobals());

describe('Keep Up ink emission', () => {
  it('uses ink alpha, leaving transparent fabric black even when its RGB is bright', () => {
    const source = new Uint8ClampedArray([
      255, 255, 255, 0, 12, 80, 140, 64, 160, 160, 160, 255,
    ]);
    const original = source.slice();
    expect([...inkEmissionPixels(source)]).toEqual([
      0, 0, 0, 255, 64, 64, 64, 255, 255, 255, 255, 255,
    ]);
    expect(source).toEqual(original);
  });

  it('allows only the three stable Keep Up IDs and starts with no daylight emission', () => {
    canvasEnvironment();
    for (const id of ['10237102096713', '10237099737417', '10237061759305']) {
      const material = new THREE.MeshStandardMaterial();
      const diffuse = new THREE.Texture();
      material.map = diffuse;
      expect(createKeepUpInkGlow(material, id, 1024)).toBeDefined();
      expect(material.emissiveMap).not.toBeNull();
      expect(material.emissive.getHexString()).toBe('1d6bff');
      expect(material.emissiveIntensity).toBe(0);
      expect(material.map).toBe(diffuse);
      material.dispose();
    }
    for (const id of [
      undefined,
      'keep-up-hoodie',
      '10237061759305-copy',
      'racing-zipper',
    ]) {
      const material = new THREE.MeshStandardMaterial();
      expect(createKeepUpInkGlow(material, id, 1024)).toBeUndefined();
      expect(material.emissiveMap).toBeNull();
      material.dispose();
    }
  });

  it('caches shared garment materials once and returns exactly to zero in daylight', () => {
    canvasEnvironment();
    const material = new THREE.MeshStandardMaterial();
    createKeepUpInkGlow(material, '10237061759305', 1024);
    const ordinary = new THREE.MeshStandardMaterial({
      emissiveIntensity: 0.07,
    });
    const root = new THREE.Group();
    const geometry = new THREE.BufferGeometry();
    root.add(new THREE.Mesh(geometry, material));
    root.add(new THREE.Mesh(geometry, [material, ordinary]));
    const traverse = vi.spyOn(root, 'traverse');
    const update = createGarmentGlowUpdater(root);
    update(0.5);
    expect(material.emissiveIntensity).toBeGreaterThan(0);
    expect(material.emissiveIntensity).toBeLessThan(0.95);
    update(1);
    expect(material.emissiveIntensity).toBeCloseTo(0.95);
    update(0);
    expect(material.emissiveIntensity).toBe(0);
    update(Number.NaN);
    expect(material.emissiveIntensity).toBe(0);
    expect(ordinary.emissiveIntensity).toBe(0.07);
    expect(traverse).toHaveBeenCalledTimes(1);
    material.dispose();
    ordinary.dispose();
    geometry.dispose();
  });

  it('disposes the mask and ignores late image completion or cached dark updates', () => {
    const context = canvasEnvironment();
    const material = new THREE.MeshStandardMaterial();
    const ink = createKeepUpInkGlow(material, '10237099737417', 1024)!;
    const texture = material.emissiveMap!;
    const disposed = vi.fn();
    texture.addEventListener('dispose', disposed);
    const geometry = new THREE.BufferGeometry();
    const root = new THREE.Mesh(geometry, material);
    const update = createGarmentGlowUpdater(root);
    update(0.5);
    material.dispose();
    ink.paint({} as HTMLCanvasElement, 10, 20, 30, 40);
    update(1);
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(material.emissiveIntensity).toBe(0);
    expect(context.drawImage).not.toHaveBeenCalled();
    geometry.dispose();
  });
});
