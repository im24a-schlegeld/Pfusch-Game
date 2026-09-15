import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageBitmapLoader, Mesh, Texture } from 'three';
import { makeSignCollectibleView } from '../app/game/signCollectibleView';
import { SIGN_COLLECTIBLES, SIGN_IDS } from '../app/game/signCollectibles';

afterEach(() => vi.restoreAllMocks());

function loaderStub() {
  const pending: {
    url: string;
    ready: (bitmap: ImageBitmap) => void;
    options: ImageBitmapOptions;
  }[] = [];
  vi.spyOn(ImageBitmapLoader.prototype, 'load').mockImplementation(
    function (this: ImageBitmapLoader, url, ready) {
      pending.push({ url, ready: ready!, options: { ...this.options } });
    },
  );
  return pending;
}

describe('bounded original-artwork sign renderer', () => {
  it('shares six bounded textures and mesh resources while recycling every pool slot', () => {
    const pending = loaderStub();
    const view = makeSignCollectibleView(8, 2.8);
    expect(pending).toHaveLength(6);
    expect(pending.map((entry) => entry.url)).toEqual(
      SIGN_COLLECTIBLES.map((entry) => entry.asset),
    );
    const bitmaps = pending.map((entry) => {
      expect(entry.options.resizeWidth).toBeLessThanOrEqual(512);
      expect(entry.options.resizeHeight).toBeLessThanOrEqual(512);
      expect(entry.options.imageOrientation).toBe('flipY');
      const close = vi.fn();
      const bitmap = { close } as unknown as ImageBitmap;
      entry.ready(bitmap);
      return { bitmap, close };
    });
    const seenGeometry = new Set(),
      seenMaterials = new Set();
    for (let step = 0; step < 60; step++) {
      const signs = Array.from({ length: 8 }, (_, i) => ({
        active: true,
        id: SIGN_IDS[(step + i) % SIGN_IDS.length],
        lane: (i % 3) - 1,
        z: 10 + i * 10,
      }));
      view.update(signs, step);
      expect(view.root.children).toHaveLength(8);
      view.root.children.forEach((group, i) => {
        expect(group.visible).toBe(true);
        expect(group.position.x).toBe(signs[i].lane * 2.8);
        expect(group.position.z).toBe(-signs[i].z);
        const definition = SIGN_COLLECTIBLES.find((d) => d.id === signs[i].id)!;
        expect(group.rotation.z).toBe(definition.rotation);
        const face = group.getObjectByName('sign-original-artwork') as Mesh;
        seenGeometry.add(face.geometry);
        seenMaterials.add(face.material);
      });
    }
    expect(seenGeometry.size).toBe(6);
    expect(seenMaterials.size).toBe(6);
    view.update([], 100);
    expect(view.root.children.every((group) => !group.visible)).toBe(true);
    const textures = [...seenMaterials].map((material) =>
      vi.spyOn((material as { map: Texture }).map, 'dispose'),
    );
    view.dispose();
    view.dispose();
    for (const dispose of textures) expect(dispose).toHaveBeenCalledTimes(1);
    for (const { close } of bitmaps) expect(close).toHaveBeenCalledTimes(1);
  });

  it('keeps pending assets invisible and closes late decodes after unmount', () => {
    const pending = loaderStub();
    const view = makeSignCollectibleView(8, 2.8, true);
    view.update([{ active: true, id: 'P', lane: 0, z: 10 }], 0);
    expect(view.root.children[0].visible).toBe(false);
    view.dispose();
    for (const entry of pending) {
      expect(entry.options.resizeWidth).toBeLessThanOrEqual(256);
      expect(entry.options.resizeHeight).toBeLessThanOrEqual(256);
      const close = vi.fn();
      entry.ready({ close } as unknown as ImageBitmap);
      expect(close).toHaveBeenCalledTimes(1);
    }
    view.update([{ active: true, id: 'P', lane: 0, z: 10 }], 1);
    expect(view.root.children[0].visible).toBe(false);
  });
});
