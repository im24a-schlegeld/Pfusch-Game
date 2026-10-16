import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { StickerPlacement } from '../app/domain/types';
import { adjustStickerPlacement, applyBikeStickers, stickerSurfaces } from '../app/game/bikeStickers';

function panels() {
  const root = new THREE.Group();
  root.position.set(3, 2, -4);
  root.rotation.y = 0.4;
  const material = new THREE.MeshBasicMaterial();
  const right = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.5, 0.8), material);
  right.position.set(0.35, 0.7, 0.2);
  const left = new THREE.Mesh(right.geometry.clone(), material);
  left.position.set(-0.35, 0.7, 0.2);
  root.add(right, left);
  const surfaces = new Map([['body/right:0', right], ['body/left:1', left]]);
  const placement: StickerPlacement = {
    id: 'same-sticker', productId: 'chrome', surface: 'body/right:0',
    point: [0.01, 0.13, 0.24], normal: [1, 0, 0], size: 0.09, rotation: 0.42,
  };
  return { root, right, left, surfaces, placement };
}

describe('sticker position actions', () => {
  it('centers on the current physical panel without crossing to its other skin', () => {
    const { root, surfaces, placement } = panels();
    const before = structuredClone(placement);
    const centered = adjustStickerPlacement(root, surfaces, placement, 'center')!;
    expect(centered).toMatchObject({ id: placement.id, productId: placement.productId, surface: placement.surface, size: 0.09, rotation: 0.42 });
    expect(centered.point[0]).toBeCloseTo(0.01);
    expect(centered.point[1]).toBeCloseTo(0);
    expect(centered.point[2]).toBeCloseTo(0);
    expect(centered.normal[0]).toBeCloseTo(1);
    expect(Math.hypot(centered.normal[1], centered.normal[2])).toBeCloseTo(0);
    expect(placement).toEqual(before);
  });

  it('mirrors attachment onto the real opposite panel in target space, preserving the print', () => {
    const { root, right, left, surfaces, placement } = panels();
    const before = structuredClone(placement);
    const mirrored = adjustStickerPlacement(root, surfaces, placement, 'mirror')!;
    expect(mirrored).toMatchObject({ id: placement.id, productId: placement.productId, surface: 'body/left:1', size: 0.09, rotation: 0.42 });
    expect(mirrored.point[0]).toBeCloseTo(-0.01);
    expect(mirrored.point[1]).toBeCloseTo(0.13);
    expect(mirrored.point[2]).toBeCloseTo(0.24);
    expect(mirrored.normal).toEqual([-1, 0, 0]);
    const beforeWorld = right.localToWorld(new THREE.Vector3(...placement.point));
    const afterWorld = left.localToWorld(new THREE.Vector3(...mirrored.point));
    const beforeTarget = root.worldToLocal(beforeWorld), afterTarget = root.worldToLocal(afterWorld);
    expect(afterTarget.x).toBeCloseTo(-beforeTarget.x);
    expect(afterTarget.y).toBeCloseTo(beforeTarget.y);
    expect(afterTarget.z).toBeCloseTo(beforeTarget.z);
    expect(placement).toEqual(before);
    const roundTrip = adjustStickerPlacement(root, surfaces, mirrored, 'mirror')!;
    expect(roundTrip.surface).toBe(placement.surface);
    for (let i = 0; i < 3; i++) expect(roundTrip.point[i]).toBeCloseTo(placement.point[i]);
  });

  it('snaps to a real triangle and uses its normal rather than storing a floating reflected point', () => {
    const { root, left, surfaces, placement } = panels();
    left.position.y += 0.06;
    left.rotation.z = -0.1;
    const mirrored = adjustStickerPlacement(root, surfaces, placement, 'mirror')!;
    expect(mirrored.surface).toBe('body/left:1');
    expect(mirrored.point[0]).toBeCloseTo(-0.01);
    expect(Math.hypot(...mirrored.normal)).toBeCloseTo(1);
    expect(mirrored.normal).toEqual([-1, 0, 0]);
    expect(mirrored.rotation).toBe(placement.rotation);
    expect(mirrored.point[1]).not.toBe(placement.point[1]);
  });

  it('does not move a decal onto a missing opposite surface or a helmet visor material', () => {
    const { root, right, surfaces, placement } = panels();
    expect(adjustStickerPlacement(root, new Map([['body/right:0', right]]), placement, 'mirror')).toBeUndefined();
    const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshBasicMaterial());
    // The only opposite-facing X triangle group belongs to the visor.
    helmet.geometry.groups.forEach(group => { group.materialIndex = 1; });
    const helmetRoot = new THREE.Group(); helmetRoot.add(helmet);
    const helmetPlacement = { ...placement, surface: 'helmet/fullface/shell', point: [0.2, 0.1, 0.1] as [number, number, number] };
    expect(adjustStickerPlacement(helmetRoot, new Map([[helmetPlacement.surface, helmet]]), helmetPlacement, 'mirror', true)).toBeUndefined();
    expect(surfaces.size).toBe(2);
  });

  it('renders the same unmirrored artwork with positive UV orientation on both sides', () => {
    const load = vi.spyOn(THREE.TextureLoader.prototype, 'load').mockReturnValue(new THREE.Texture());
    try {
      const { root, right, left, placement } = panels();
      right.userData.bikeStickerSurface = left.userData.bikeStickerSurface = true;
      const rider = new THREE.Group(), surfaces = stickerSurfaces(root, rider, '#ffffff');
      const surface = [...surfaces].find(([, mesh]) => mesh === right)![0];
      const original = { ...placement, surface };
      const mirrored = adjustStickerPlacement(root, surfaces, original, 'mirror')!;
      applyBikeStickers(root, rider, '#ffffff', [original, mirrored]);
      const decals = [right, left].map(mesh => mesh.getObjectByName(`sticker-${original.id}`) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>);
      expect(decals[0].material.map).toBe(decals[1].material.map);
      expect(decals[0].material.map!.repeat.toArray()).toEqual([1, 1]);
      expect(decals[0].material.map!.rotation).toBe(0);
      for (const decal of decals) {
        const uv = decal.geometry.getAttribute('uv'), indices = decal.geometry.getIndex()!;
        expect(indices.count).toBeGreaterThan(0);
        const a = indices.getX(0), b = indices.getX(1), c = indices.getX(2);
        const uvArea = (uv.getX(b) - uv.getX(a)) * (uv.getY(c) - uv.getY(a)) - (uv.getY(b) - uv.getY(a)) * (uv.getX(c) - uv.getX(a));
        expect(uvArea).toBeGreaterThan(0);
      }
    } finally { load.mockRestore(); }
  });
});
