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
  const surfaces = new Map<string, THREE.Mesh>([['body/right:0', right], ['body/left:1', left]]);
  const placement: StickerPlacement = {
    id: 'same-sticker', productId: 'chrome', surface: 'body/right:0',
    point: [0.01, 0.13, 0.24], normal: [1, 0, 0], size: 0.09, rotation: 0.42,
  };
  return { root, right, left, surfaces, placement };
}

describe('sticker position actions', () => {
  it('centers on the motorcycle sagittal plane while retaining the selected sloped panel and nearest height', () => {
    const { root, placement } = panels();
    root.scale.set(1.4, 0.8, 1.2);
    const shell = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
    shell.position.set(0.2, 0.7, 1.3);
    shell.rotation.y = 0.4;
    shell.scale.set(1.2, 0.8, 1);
    // Other parts and asymmetrical motorcycle bounds cannot change the axis
    // or steal a sticker from the selected rear panel.
    const distractor = new THREE.Mesh(shell.geometry, shell.material);
    distractor.position.set(0, 0.7, 0);
    root.add(shell, distractor, new THREE.Mesh(new THREE.BoxGeometry(8, 4, 12), shell.material));
    const surfaces = new Map([['body/rear-shell', shell], ['body/other-shell', distractor]]);
    placement.surface = 'body/rear-shell';
    placement.point = [0.3, 0.12, 0];
    placement.normal = [0, 0, 1];
    const before = structuredClone(placement);
    const centered = adjustStickerPlacement(root, surfaces, placement, 'center')!;
    expect(centered).toMatchObject({ id: placement.id, productId: placement.productId, surface: placement.surface, size: 0.09, rotation: 0.42 });
    const actual = root.worldToLocal(shell.localToWorld(new THREE.Vector3(...centered.point)));
    expect(actual.x).toBeCloseTo(0, 8);
    expect(actual.y).toBeCloseTo(0.7 + 0.12 * 0.8, 8);
    expect(actual.z).toBeCloseTo(1.3 + 0.2 * Math.tan(0.4), 8);
    expect(centered.point[2]).toBeCloseTo(0, 8);
    expect(centered.normal).toEqual([0, 0, 1]);
    expect(placement).toEqual(before);
  });

  it('leaves a side panel unchanged when it has no sagittal intersection, even if another surface crosses it', () => {
    const { root, surfaces, placement } = panels();
    const other = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    root.add(other); surfaces.set('body/center-panel', other);
    const before = structuredClone(placement);
    expect(adjustStickerPlacement(root, surfaces, placement, 'center')).toBeUndefined();
    expect(placement).toEqual(before);
  });

  it.each([
    { name: 'coplanar triangle', vertices: [0, -1, -1, 0, 1, -1, 0, 0, 1], point: [0, 0.2, 0.3], normal: [1, 0, 0], expected: [0, 0.2, 0.3] },
    { name: 'single touching vertex', vertices: [0, 0, 0, 1, -1, 0, 1, 1, 0], point: [0.5, 0, 0], normal: [0, 0, 1], expected: [0, 0, 0] },
    { name: 'edge in the plane', vertices: [0, -1, 0, 1, 0, 0, 0, 1, 0], point: [0.3, 0.15, 0], normal: [0, 0, 1], expected: [0, 0.15, 0] },
  ])('handles a $name without floating off the selected triangle', ({ vertices, point, normal, expected }) => {
    const root = new THREE.Group(); root.position.set(2, 3, -1); root.rotation.y = 0.7;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const shell = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()); root.add(shell);
    const start: StickerPlacement = { id: 'boundary', productId: 'chrome', surface: 'body/shell', point: point as [number, number, number], normal: normal as [number, number, number], size: 0.09, rotation: 0.42 };
    const surfaces = new Map([[start.surface, shell]]);
    const centered = adjustStickerPlacement(root, surfaces, start, 'center')!;
    expect(centered).toMatchObject({ ...start, point: expected.map(value => expect.closeTo(value, 8)), normal: normal.map(value => expect.closeTo(value, 8)) });
    expect(adjustStickerPlacement(root, surfaces, centered, 'center')).toMatchObject({ ...centered, point: centered.point.map(value => expect.closeTo(value, 8)), normal: centered.normal.map(value => expect.closeTo(value, 8)) });
  });

  it.each([-1, 1])('keeps the selected skin with authored winding %s', winding => {
    const root = new THREE.Group();
    const geometry = new THREE.BoxGeometry(1, 0.8, 0.012);
    const index = geometry.getIndex()!;
    if (winding < 0) for (let i = 0; i < index.count; i += 3) {
      const b = index.getX(i + 1); index.setX(i + 1, index.getX(i + 2)); index.setX(i + 2, b);
    }
    const shell = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); root.add(shell);
    const start: StickerPlacement = { id: 'same-skin', productId: 'chrome', surface: 'body/shell', point: [0.3, 0.12, 0.006], normal: [0, 0, winding], size: 0.09, rotation: 0.42 };
    const centered = adjustStickerPlacement(root, new Map([[start.surface, shell]]), start, 'center')!;
    expect(centered).toMatchObject({ ...start, point: [expect.closeTo(0, 8), expect.closeTo(0.12, 8), expect.closeTo(0.006, 8)], normal: start.normal.map(value => expect.closeTo(value, 8)) });
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
