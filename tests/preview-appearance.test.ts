import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeBike } from '../app/game/vehicle';
import { createPreviewColorUpdater, previewGeometryKey } from '../app/game/previewAppearance';
import { installImportedBikeFixtures } from './importedBikeFixture';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new THREE.MeshStandardMaterial(),
  fabricMaterial: () => new THREE.MeshStandardMaterial(),
  sleeveMaterial: () => new THREE.MeshStandardMaterial(),
  accessoryMaterial: () => new THREE.MeshStandardMaterial(),
}));
installImportedBikeFixtures();

function surfaces(root: THREE.Object3D) {
  const result: { geometry: THREE.BufferGeometry; materials: THREE.Material[]; colors: string[] }[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    result.push({ geometry: object.geometry, materials, colors: materials.map((material) =>
      material instanceof THREE.MeshStandardMaterial ? material.color.getHexString() : '') });
  });
  return result;
}

describe('immediate preview palette updates', () => {
  it.each(['125', '450', '701', 'scooter'])('matches a fresh %s with the same material choices while preserving every mesh', (id) => {
    const player = { ...newPlayer(), bike: id, paint: '#181818', rims: '#181818' };
    const bike = makeBike(player, []);
    const before = surfaces(bike.root);
    const update = createPreviewColorUpdater(bike.body, bike.rider, player);
    // Matching initial colors must not combine independently editable surfaces.
    const latest = { ...player, paint: '#627dac', rims: '#967847', helmetColor: '#b83232', helmetVisor: '#8ab9cf' };
    update({ ...latest, paint: '#dc632e' });
    update(latest);
    const after = surfaces(bike.root);
    const expected = surfaces(makeBike(latest, []).root);
    expect(after.map((surface) => surface.colors)).toEqual(expected.map((surface) => surface.colors));
    expect(after.map((surface) => surface.geometry)).toEqual(before.map((surface) => surface.geometry));
    for (const [index, surface] of after.entries())
      surface.materials.forEach((material, materialIndex) => expect(material).toBe(before[index].materials[materialIndex]));
  });

  it('preserves motocross shell shading, separate lens, and mesh geometry', () => {
    const player = { ...newPlayer(), helmet: 'motocross' as const };
    const bike = makeBike(player, []);
    const update = createPreviewColorUpdater(bike.body, bike.rider, player);
    const latest = { ...player, helmetColor: '#627dac', helmetVisor: '#8ab9cf' };
    update(latest);
    expect(surfaces(bike.root).map((surface) => surface.colors))
      .toEqual(surfaces(makeBike(latest, []).root).map((surface) => surface.colors));
  });

  it('does not invalidate geometry for palette or balance changes', () => {
    const player = newPlayer();
    expect(previewGeometryKey({ ...player, paint: '#627dac', rims: '#967847', helmetColor: '#b83232', helmetVisor: '#8ab9cf', coins: 20 }))
      .toBe(previewGeometryKey(player));
    expect(previewGeometryKey({ ...player, helmet: 'motocross' })).not.toBe(previewGeometryKey(player));
  });
});
