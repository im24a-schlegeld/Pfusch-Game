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
      material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshBasicMaterial ? material.color.getHexString() : '') });
  });
  return result;
}

describe('immediate preview palette updates', () => {
  it('keeps Supermoto hoop brightness uniform while allowing immediate rim color changes', () => {
    const player = { ...newPlayer(), bike: '450', rims: '#d5252b' };
    const bike = makeBike(player, []);
    const hoops = [...new Set(surfaces(bike.body).flatMap(surface => surface.materials))]
      .filter((material): material is THREE.MeshBasicMaterial => material instanceof THREE.MeshBasicMaterial && material.name === 'fs450_rim_hoop');
    expect(hoops).toHaveLength(1);
    expect(hoops[0].color.getHexString()).toBe('d5252b');
    expect(hoops[0].map).toBeNull();
    createPreviewColorUpdater(bike.body, bike.rider, player)({ ...player, rims: '#e7e7df' });
    expect(hoops[0].color.getHexString()).toBe('e7e7df');
  });

  it('keeps Moped spokes silver when choosing a different rim finish', () => {
    const player = { ...newPlayer(), bike: 'moped', rims: '#d5252b' };
    const bike = makeBike(player, []);
    const materials = [...new Set(surfaces(bike.body).flatMap(surface => surface.materials))]
      .filter((material): material is THREE.MeshStandardMaterial => material instanceof THREE.MeshStandardMaterial);
    const spokes = materials.filter(material => material.name === 'moped_spokes');
    expect(spokes.length).toBeGreaterThan(0);
    const original = spokes.map(material => material.color.getHexString());
    expect(original.every(color => color !== 'd5252b')).toBe(true);
    createPreviewColorUpdater(bike.body, bike.rider, player)({ ...player, rims: '#181818' });
    expect(spokes.map(material => material.color.getHexString())).toEqual(original);
    expect(materials.find(material => material.name === 'moped_rim')?.color.getHexString()).toBe('181818');
  });

  it('does not rewrite unchanged palette colors on every rendered frame', () => {
    const player = newPlayer();
    const bike = makeBike(player, []);
    const update = createPreviewColorUpdater(bike.body, bike.rider, player);
    const materials = new Set(surfaces(bike.root).flatMap((surface) => surface.materials));
    const writes = [...materials].flatMap((material) => material instanceof THREE.MeshStandardMaterial
      ? [vi.spyOn(material.color, 'set')] : []);
    for (let frame = 0; frame < 600; frame++) update(player);
    expect(writes.reduce((count, spy) => count + spy.mock.calls.length, 0)).toBe(0);
    update({ ...player, paint: '#627dac' });
    const changedWrites = writes.reduce((count, spy) => count + spy.mock.calls.length, 0);
    expect(changedWrites).toBeGreaterThan(0);
    for (let frame = 0; frame < 600; frame++) update({ ...player, paint: '#627dac' });
    expect(writes.reduce((count, spy) => count + spy.mock.calls.length, 0)).toBe(changedWrites);
    writes.forEach((spy) => spy.mockRestore());
  });

  it.each(['125', 'moped', '450', '701', 'scooter'])('matches a fresh %s with the same material choices while preserving every mesh', (id) => {
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
