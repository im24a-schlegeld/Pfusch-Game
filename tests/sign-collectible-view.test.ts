import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type BufferGeometry, type Mesh, type MeshBasicMaterial } from 'three';
import { SIGN_COLLECTIBLES, SIGN_IDS } from '../app/game/signCollectibles';

beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function artworkStub() {
  const pending: TestImage[] = [];
  const contexts: { rotate: ReturnType<typeof vi.fn> }[] = [];
  class TestImage {
    src = '';
    naturalWidth = 0;
    naturalHeight = 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
      pending.push(this);
    }
  }
  vi.stubGlobal('Image', TestImage);
  vi.stubGlobal('document', {
    createElement: () => {
      const context = {
        save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), ellipse: vi.fn(),
        moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(),
        quadraticCurveTo: vi.fn(), rect: vi.fn(), clip: vi.fn(),
        drawImage: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
      };
      contexts.push(context);
      return { width: 0, height: 0, getContext: () => context };
    },
  });
  return {
    pending,
    contexts,
    complete() {
      pending.forEach((image, i) => {
        [image.naturalWidth, image.naturalHeight] = SIGN_COLLECTIBLES[i].sourceSize;
        image.onload?.();
      });
    },
  };
}

describe('bounded original-artwork sign renderer', () => {
  it('uses all six complete standalone signs and shares resources across recycled slots', async () => {
    const artwork = artworkStub();
    const { makeSignCollectibleView } = await import('../app/game/signCollectibleView');
    const { loadOriginalSignArtwork } = await import('../app/game/signArtwork');
    const view = makeSignCollectibleView(8, 2.8);
    // The overlapped hoodie print must never supply isolated world pickups.
    expect(artwork.pending.map((image) => image.src)).toEqual(
      SIGN_COLLECTIBLES.map((definition) => definition.asset),
    );
    artwork.complete();
    const originals = await loadOriginalSignArtwork();
    expect(await loadOriginalSignArtwork()).toBe(originals);
    expect(artwork.pending).toHaveLength(6);
    for (const definition of SIGN_COLLECTIBLES) {
      expect(artwork.contexts.some((ctx) =>
        ctx.rotate.mock.calls.some(([angle]) => angle === -definition.rotation),
      )).toBe(true);
    }
    const seenGeometry = new Set<BufferGeometry>(),
      seenMaterials = new Set<MeshBasicMaterial>();
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
        // Original canvases already contain the intended sign rotation.
        expect(group.rotation.z).toBe(0);
        const face = group.getObjectByName('sign-original-artwork') as Mesh<BufferGeometry, MeshBasicMaterial>;
        expect(face.material.map?.image).toBe(originals[SIGN_IDS.indexOf(signs[i].id)].canvas);
        seenGeometry.add(face.geometry);
        seenMaterials.add(face.material);
      });
    }
    expect(seenGeometry.size).toBe(6);
    expect(seenMaterials.size).toBe(6);
    view.update([], 100);
    expect(view.root.children.every((group) => !group.visible)).toBe(true);
    const disposals = [
      ...[...seenGeometry].map((geometry) => vi.spyOn(geometry, 'dispose')),
      ...[...seenMaterials].flatMap((material) => [
        vi.spyOn(material, 'dispose'),
        vi.spyOn(material.map!, 'dispose'),
      ]),
    ];
    view.dispose();
    view.dispose();
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps pending signs invisible and ignores late artwork after disposal', async () => {
    const artwork = artworkStub();
    const { makeSignCollectibleView } = await import('../app/game/signCollectibleView');
    const { loadOriginalSignArtwork } = await import('../app/game/signArtwork');
    const view = makeSignCollectibleView(8, 2.8, true);
    view.update([{ active: true, id: 'P', lane: 0, z: 10 }], 0);
    expect(view.root.children[0].visible).toBe(false);
    view.dispose();
    artwork.complete();
    await loadOriginalSignArtwork();
    view.update([{ active: true, id: 'P', lane: 0, z: 10 }], 1);
    expect(view.root.children.every((group) => !group.visible && group.children.length === 0)).toBe(true);
  });
});
