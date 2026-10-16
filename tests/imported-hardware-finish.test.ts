import { expect, it, vi } from 'vitest';
import { Color, Mesh, MeshStandardMaterial } from 'three';
import { makeBike } from '../app/game/vehicle';
import { newPlayer } from '../app/domain/progression';
import { createPreviewColorUpdater } from '../app/game/previewAppearance';
import { getImportedBikeAsset, type ImportedBikeId } from '../app/game/importedBikeAsset';
import { installImportedBikeFixtures } from './importedBikeFixture';
import { hardwareComponents } from '../app/game/importedHardwareFinish';

installImportedBikeFixtures();
vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

it('keeps both authored Supermoto levers matte black through paint/rim previews', () => {
  const player = { ...newPlayer(), bike: '450', paint: '#ffffff', rims: '#ffffff' };
  const bike = makeBike(player, []), source = getImportedBikeAsset('450');
  const update = createPreviewColorUpdater(bike.body, bike.rider, player);
  const levers: { material: MeshStandardMaterial; colors: number[]; mesh: Mesh }[] = [];
  for (const name of ['fs450_cockpit_metal:steering', 'fs450_cockpit_dark:steering']) {
    const part = source.manifest.parts.find(part => part.name === name)!;
    const mesh = bike.body.getObjectByName(name) as Mesh;
    const colors = mesh.geometry.getAttribute('color');
    expect(mesh.userData.hardwareLeverMask).toBe(true);
    expect(mesh.geometry.groups).toHaveLength(0);
    const components = hardwareComponents(part, source.binary).filter(c =>
      c.max[0] - c.min[0] > 0.1 && c.max[1] - c.min[1] < 0.035 &&
      c.min[1] > 1.13 && c.max[1] < 1.16 && c.max[2] < -0.28);
    expect(components).toHaveLength(1);
    for (const triangle of components[0].triangles) {
      const group = mesh.geometry.groups.find(group => triangle * 3 >= group.start && triangle * 3 < group.start + group.count);
      const material = (Array.isArray(mesh.material) ? mesh.material[group?.materialIndex ?? 0] : mesh.material) as MeshStandardMaterial;
      const black = new Color('#101214');
      for (let corner = 0; corner < 3; corner++) {
        const vertex = mesh.geometry.index!.getX(triangle * 3 + corner);
        expect(colors.getX(vertex)).toBeCloseTo(black.r, 7);
        expect(colors.getY(vertex)).toBeCloseTo(black.g, 7);
        expect(colors.getZ(vertex)).toBeCloseTo(black.b, 7);
      }
      expect(material.userData.fixedHardwareFinish).toBe(true);
      levers.push({ material, colors: Array.from(colors.array), mesh });
    }
  }
  for (const paint of ['#ffffff', 'carbon-dark', '#bf2633']) {
    update({ ...player, paint });
    for (const { material, colors, mesh } of levers) {
      expect(material.color.getHexString()).toBe('ffffff');
      expect(Array.from(mesh.geometry.getAttribute('color').array)).toEqual(colors);
      expect(material.map).toBeNull();
    }
  }
});

it.each(['125', 'moped', '450', '701', 'scooter'] as ImportedBikeId[])(
  '%s separates black hardware, painted springs and metallic sliding tubes through preview changes',
  (id) => {
    const player = { ...newPlayer(), bike: id, paint: '#ffffff', rims: '#ffffff' };
    const bike = makeBike(player, []);
    const update = createPreviewColorUpdater(bike.body, bike.rider, player);
    const black = new Set<MeshStandardMaterial>(), springs = new Set<MeshStandardMaterial>();
    let coilTriangles = 0, extraDraws = 0;
    const source = getImportedBikeAsset(id);
    bike.body.traverse((object) => {
      if (!(object instanceof Mesh) || !object.userData.hardwareFinishGroups) return;
      const materials = object.material as MeshStandardMaterial[];
      const part = source.manifest.parts.find(p => p.name === object.userData.importedPart)!;
      expect(Array.from(object.geometry.index!.array)).toEqual(Array.from(
        new Uint16Array(source.binary, part.index.offset, part.index.count),
      ));
      let cursor = 0;
      for (const group of object.geometry.groups) {
        expect(group.start).toBe(cursor); cursor += group.count;
        const material = materials[group.materialIndex!];
        if (material.userData.fixedHardwareFinish) black.add(material);
        if (material.userData.appearanceColorSlot === 'paint' && /shock/.test(part.name)) {
          springs.add(material); coilTriangles += group.count / 3;
          expect(object.userData.bikePaintSurface).toBe(false);
        }
      }
      expect(cursor).toBe(object.geometry.index!.count);
      extraDraws += object.geometry.groups.length - 1;
    });
    expect(black.size).toBeGreaterThan(0);
    expect(coilTriangles).toBe(({ '125': 0, moped: 0, '450': 486, '701': 354, scooter: 1244 })[id]);
    // Disconnected winding segments must batch together in their existing order.
    expect(extraDraws).toBeLessThan(24);
    for (const paint of ['#101214', '#bf2633', 'carbon-dark', '#406fb0']) {
      update({ ...player, paint });
      for (const material of black) {
        expect(material.color.getHexString()).toBe('101214');
        expect(material.map).toBeNull();
        expect(material.userData.appearanceColorSlot).toBeUndefined();
      }
      for (const material of springs) {
        expect(material.color.getHexString()).toBe(paint === 'carbon-dark' ? 'ffffff' : paint.slice(1));
        expect(Boolean(material.map)).toBe(paint === 'carbon-dark');
      }
    }
  },
);

it('blackens the Sport axle castings while retaining the joined bronze calipers', () => {
  const player = { ...newPlayer(), bike: '701' };
  const bike = makeBike(player, []);
  const foot = bike.body.getObjectByName('r6_brake_caliper:fork') as Mesh;
  const material = foot.material as MeshStandardMaterial;
  const colors = foot.geometry.getAttribute('color');
  const source = getImportedBikeAsset('701');
  const part = source.manifest.parts.find(p => p.name === foot.name)!;
  const positions = new Float32Array(source.binary, part.position.offset, part.position.count * 3);
  const black = new Color('#101214'), bronze = new Color('#777263');
  let castings = 0, calipers = 0;
  for (let i = 0; i < colors.count; i++) {
    const z = positions[i * 3 + 2];
    if (z > -0.60) { expect(colors.getX(i)).toBeCloseTo(bronze.r); calipers++; }
    if (z < -0.64) { expect(colors.getX(i)).toBeCloseTo(black.r); castings++; }
  }
  expect(castings).toBeGreaterThan(100);
  expect(calipers).toBeGreaterThan(100);
  expect(material.vertexColors).toBe(true);
  expect(foot.geometry.groups).toHaveLength(0);
  const before = Array.from(colors.array);
  createPreviewColorUpdater(bike.body, bike.rider, player)({ ...player, paint: 'carbon-dark' });
  expect(material.map).toBeNull();
  expect(material.color.getHexString()).toBe('ffffff');
  expect(Array.from(colors.array)).toEqual(before);
});
