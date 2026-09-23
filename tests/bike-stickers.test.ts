import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { StickerPlacement } from '../app/domain/types';
import {
  applyBikeStickers,
  clearBikeStickers,
  stickerSurfaces,
} from '../app/game/bikeStickers';
import { newPlayer } from '../app/domain/progression';
import { makeBike } from '../app/game/vehicle';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new THREE.MeshStandardMaterial(),
  fabricMaterial: () => new THREE.MeshStandardMaterial(),
  sleeveMaterial: () => new THREE.MeshStandardMaterial(),
  accessoryMaterial: () => new THREE.MeshStandardMaterial(),
}));

const paint = '#d4ad26';
beforeAll(() => {
  vi.spyOn(THREE.TextureLoader.prototype, 'load').mockReturnValue(
    new THREE.Texture(),
  );
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
    id: 'chrome-1',
    productId: 'chrome-product',
    surface,
    point: [0, 0, 0.006],
    normal: [0, 0, 1],
    size: 0.24,
    rotation: 0,
  };
  return { body, rider, suspension, shell, placement };
}

function decal(shell: THREE.Mesh, id = 'chrome-1') {
  const result = shell.getObjectByName(`sticker-${id}`);
  expect(result).toBeInstanceOf(THREE.Mesh);
  return result as THREE.Mesh;
}

describe('bike sticker geometry', () => {
  it('restores the selected panel after unrelated model details shift child indices', () => {
    const { body, rider, suspension, shell, placement } = fixture();
    const otherSide = new THREE.Mesh(
      shell.geometry.clone().translate(1, 0, 0),
      shell.material,
    );
    otherSide.name = shell.name;
    suspension.add(otherSide);
    const detail = new THREE.Group();
    detail.name = 'new-mechanical-detail';
    body.children.unshift(detail);
    detail.parent = body;
    const before = structuredClone(placement);
    expect(stickerSurfaces(body, rider, paint).has(placement.surface)).toBe(
      false,
    );
    applyBikeStickers(body, rider, paint, [placement]);
    expect(decal(shell).geometry.getIndex()!.count).toBeGreaterThan(0);
    expect(otherSide.getObjectByName('sticker-chrome-1')).toBeUndefined();
    expect(placement).toEqual(before);
  });

  it.each([
    ['125', 'moped-main-frame'],
    ['450', 'radiator-shroud'],
    ['701', 'sport-paint-surfaces'],
    ['scooter', 'scooter-tail-side-panel'],
  ] as const)(
    'renders saved stickers from both outside views of the actual %s bodywork',
    (model, name) => {
      const player = { ...newPlayer(), bike: model, paint };
      const bike = makeBike(player, []);
      bike.root.updateMatrixWorld(true);
      const surfaces = stickerSurfaces(bike.body, bike.rider, paint);
      for (const side of [-1, 1]) {
        const candidates = [...surfaces].filter(
          ([, mesh]) => mesh.name === name,
        );
        candidates.sort(
          (a, b) =>
            side *
            (new THREE.Box3().setFromObject(b[1]).getCenter(new THREE.Vector3())
              .x -
              new THREE.Box3()
                .setFromObject(a[1])
                .getCenter(new THREE.Vector3()).x),
        );
        const [surface, shell] = candidates[0];
        shell.geometry.computeBoundingBox();
        const target = shell.geometry.boundingBox!.getCenter(
          new THREE.Vector3(),
        );
        // The bent moped frame does not pass through its bounding-box center.
        // Aim at a real frame triangle near its wide upper part instead.
        if (model === '125') {
          const positions = shell.geometry.getAttribute('position'),
            indices = shell.geometry.getIndex()!;
          let best = -Infinity;
          for (let i = 0; i < indices.count; i += 3) {
            const center = new THREE.Vector3();
            for (let j = 0; j < 3; j++)
              center.add(
                new THREE.Vector3().fromBufferAttribute(
                  positions,
                  indices.getX(i + j),
                ),
              );
            center.divideScalar(3);
            const score = side * center.x - Math.abs(center.y - 0.7);
            if (score > best) {
              best = score;
              target.copy(center);
            }
          }
        }
        shell.localToWorld(target);
        const ray = new THREE.Raycaster(
          target.clone().add(new THREE.Vector3(side * 3, 0, 0)),
          new THREE.Vector3(-side, 0, 0),
        );
        const hit = ray.intersectObject(shell, false)[0];
        expect(hit?.face).toBeTruthy();
        const saved: StickerPlacement = {
          id: `actual-${side}`,
          productId: 'chrome-product',
          surface,
          point: shell.worldToLocal(hit.point.clone()).toArray(),
          normal: hit.face!.normal.toArray(),
          size: 0.18,
          rotation: 0,
        };
        applyBikeStickers(bike.body, bike.rider, paint, [
          structuredClone(saved),
        ]);
        bike.root.updateMatrixWorld(true);
        const sticker = decal(shell, saved.id);
        expect(ray.intersectObject(sticker, false).length).toBeGreaterThan(0);
        // Keep the supplied colors visible on pale and dark paint: the artwork
        // already contains chrome highlights and must not be relit or tone mapped.
        expect(sticker.material).toBeInstanceOf(THREE.MeshBasicMaterial);
        expect((sticker.material as THREE.MeshBasicMaterial).toneMapped).toBe(
          false,
        );
        expect((sticker.material as THREE.MeshBasicMaterial).map).toBeTruthy();
        const uv = sticker.geometry.getAttribute('uv'),
          positions = sticker.geometry.getAttribute('position');
        const indices = sticker.geometry.getIndex()!;
        let horizontalDirection = 0;
        for (let i = 0; i < indices.count; i++) {
          const index = indices.getX(i);
          horizontalDirection +=
            (uv.getX(index) - 0.5) * (positions.getZ(index) - saved.point[2]);
        }
        // Viewed from outside, increasing U points toward -Z on the right and +Z
        // on the left; fixing visibility must not mirror the PFUSCH lettering.
        expect(horizontalDirection * side).toBeLessThan(0);
      }
    },
  );

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
    const placements = [
      placement,
      { ...placement, id: 'chrome-2', surface: childPath },
    ];
    const paths = [...before.keys()];
    applyBikeStickers(body, rider, paint, placements);
    expect([...stickerSurfaces(body, rider, paint).keys()]).toEqual(paths);
    let disposed = 0;
    decal(shell).geometry.addEventListener('dispose', () => {
      disposed++;
    });
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
    const saved: StickerPlacement = structuredClone({
      ...placement,
      point: [0.1, -0.08, 0.006],
      rotation: 0.4,
    });
    applyBikeStickers(body, rider, paint, [saved]);
    const sticker = decal(shell);
    expect(sticker.parent).toBe(shell);
    const positions = sticker.geometry.getAttribute('position');
    const indices = sticker.geometry.getIndex()!;
    expect(indices.count).toBeGreaterThan(0);
    const bounds = new THREE.Box3();
    for (let i = 0; i < indices.count; i++)
      bounds.expandByPoint(
        new THREE.Vector3().fromBufferAttribute(positions, indices.getX(i)),
      );
    const localCenter = bounds.getCenter(new THREE.Vector3());
    expect(
      localCenter.distanceTo(new THREE.Vector3(...saved.point)),
    ).toBeLessThan(1e-6);
    body.updateMatrixWorld(true);
    const before = sticker.localToWorld(localCenter.clone());
    expect(
      before.distanceTo(shell.localToWorld(new THREE.Vector3(...saved.point))),
    ).toBeLessThan(1e-6);
    suspension.position.y -= 0.12;
    suspension.rotation.x = 0.18;
    body.updateMatrixWorld(true);
    const after = sticker.localToWorld(localCenter.clone());
    expect(after.distanceTo(before)).toBeGreaterThan(0.1);
    expect(
      after.distanceTo(shell.localToWorld(new THREE.Vector3(...saved.point))),
    ).toBeLessThan(1e-6);
    expect(saved.point).toEqual([0.1, -0.08, 0.006]);
  });
});
