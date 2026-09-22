import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { StickerPlacement } from '../app/domain/types';
import { applyBikeStickers, clearBikeStickers, stickerSurfaces } from '../app/game/bikeStickers';

const paint = '#d4ad26';
beforeAll(() => {
  vi.spyOn(THREE.TextureLoader.prototype, 'load').mockReturnValue(new THREE.Texture());
});
afterAll(() => vi.restoreAllMocks());

function fixture() {
  const body = new THREE.Group();
  const rider = new THREE.Group();
  const suspension = new THREE.Group();
  suspension.name = 'suspension';
  body.add(suspension, rider);
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.6, 0.012),
    new THREE.MeshStandardMaterial({ color: paint }),
  );
  shell.name = 'radiator-shroud';
  suspension.add(shell);
  const surface = [...stickerSurfaces(body, rider, paint).keys()][0];
  const placement: StickerPlacement = {
    id: 'chrome-1', productId: 'chrome-product', surface,
    point: [0, 0, 0.006], normal: [0, 0, 1], size: 0.24, rotation: 0,
  };
  return { body, rider, suspension, shell, placement };
}

function decal(shell: THREE.Mesh, id = 'chrome-1') {
  const result = shell.getObjectByName(`sticker-${id}`);
  expect(result).toBeInstanceOf(THREE.Mesh);
  return result as THREE.Mesh;
}

describe('bike sticker geometry', () => {
  it('renders a sticker only on the selected side of thin bodywork', () => {
    const { body, rider, shell, placement } = fixture();
    applyBikeStickers(body, rider, paint, [placement]);
    body.updateMatrixWorld(true);
    const sticker = decal(shell);
    const ray = new THREE.Raycaster();
    ray.set(new THREE.Vector3(0.02, 0.01, 1), new THREE.Vector3(0, 0, -1));
    expect(ray.intersectObject(sticker, false).length).toBeGreaterThan(0);
    // The projector reaches both skins of this 12 mm panel. The inside must
    // remain blank even though its triangles lie inside the projection box.
    ray.set(new THREE.Vector3(0.02, 0.01, -1), new THREE.Vector3(0, 0, 1));
    expect(ray.intersectObject(sticker, false)).toHaveLength(0);
  });

  it('keeps surface paths stable when stickers are added, replaced and removed', () => {
    const { body, rider, shell, placement } = fixture();
    const child = new THREE.Mesh(shell.geometry.clone(), shell.material);
    child.name = 'tail-shell';
    shell.add(child);
    const before = stickerSurfaces(body, rider, paint);
    const childPath = [...before].find(([, mesh]) => mesh === child)![0];
    const placements = [placement, { ...placement, id: 'chrome-2', surface: childPath }];
    const paths = [...before.keys()];
    applyBikeStickers(body, rider, paint, placements);
    expect([...stickerSurfaces(body, rider, paint).keys()]).toEqual(paths);
    let disposed = 0;
    decal(shell).geometry.addEventListener('dispose', () => { disposed++; });
    applyBikeStickers(body, rider, paint, placements);
    expect(disposed).toBe(1);
    expect([...stickerSurfaces(body, rider, paint).keys()]).toEqual(paths);
    clearBikeStickers(body);
    expect([...stickerSurfaces(body, rider, paint).keys()]).toEqual(paths);
    expect(shell.getObjectByName('sticker-chrome-1')).toBeUndefined();
    expect(child.getObjectByName('sticker-chrome-2')).toBeUndefined();
  });

  it('restores saved local coordinates and follows parent suspension transforms', () => {
    const { body, rider, suspension, shell, placement } = fixture();
    body.position.set(2, -0.4, 3);
    body.rotation.set(0.2, -0.7, 0.1);
    body.scale.setScalar(1.45);
    suspension.position.set(0.1, 0.8, -0.3);
    shell.rotation.set(0.15, 0.25, -0.2);
    shell.scale.set(0.8, 1.2, 1);
    const saved: StickerPlacement = structuredClone({ ...placement, point: [0.1, -0.08, 0.006], rotation: 0.4 });
    applyBikeStickers(body, rider, paint, [saved]);
    const sticker = decal(shell);
    expect(sticker.parent).toBe(shell);
    const positions = sticker.geometry.getAttribute('position');
    const indices = sticker.geometry.getIndex()!;
    expect(indices.count).toBeGreaterThan(0);
    const bounds = new THREE.Box3();
    for (let i = 0; i < indices.count; i++) bounds.expandByPoint(new THREE.Vector3().fromBufferAttribute(positions, indices.getX(i)));
    const localCenter = bounds.getCenter(new THREE.Vector3());
    expect(localCenter.distanceTo(new THREE.Vector3(...saved.point))).toBeLessThan(1e-6);
    body.updateMatrixWorld(true);
    const before = sticker.localToWorld(localCenter.clone());
    expect(before.distanceTo(shell.localToWorld(new THREE.Vector3(...saved.point)))).toBeLessThan(1e-6);
    suspension.position.y -= 0.12;
    suspension.rotation.x = 0.18;
    body.updateMatrixWorld(true);
    const after = sticker.localToWorld(localCenter.clone());
    expect(after.distanceTo(before)).toBeGreaterThan(0.1);
    expect(after.distanceTo(shell.localToWorld(new THREE.Vector3(...saved.point)))).toBeLessThan(1e-6);
    expect(saved.point).toEqual([0.1, -0.08, 0.006]);
  });
});
