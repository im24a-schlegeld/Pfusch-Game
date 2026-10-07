import { describe, expect, it, vi } from 'vitest';
import { Box3, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { createFullfaceHelmet } from '../app/game/fullfaceHelmet';
import { FULLFACE_HELMET_ASSET } from '../app/game/fullfaceHelmetAsset';
import { createPreviewColorUpdater } from '../app/game/previewAppearance';
import { makeBike } from '../app/game/vehicle';
import { newPlayer } from '../app/domain/progression';
import { installImportedBikeFixtures } from './importedBikeFixture';

installImportedBikeFixtures();
vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(), fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(), accessoryMaterial: () => new MeshStandardMaterial(),
}));

describe('simplified supplied racing helmet', () => {
  it('keeps a compact, finite outer shell/visor/trim mesh without graphic textures or hidden parts', () => {
    const helmet = createFullfaceHelmet('#f0f0f0', '#30414b');
    const geometry = helmet.geometry, normal = geometry.getAttribute('normal');
    expect(geometry.index!.count / 3).toBeLessThan(7000);
    expect(atob(FULLFACE_HELMET_ASSET.data).length).toBeLessThan(80000);
    expect(geometry.groups.map(group => group.materialIndex)).toEqual([0, 1, 2]);
    expect(geometry.groups.reduce((sum, group) => sum + group.count, 0)).toBe(geometry.index!.count);
    expect(helmet.children).toHaveLength(0);
    for (const material of helmet.material) {
      expect(material.map).toBeNull(); expect(material.normalMap).toBeNull();
    }
    for (let i = 0; i < normal.count; i++)
      expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 3);
    const size = geometry.boundingBox!.getSize(new Vector3());
    expect(size.x).toBeGreaterThan(.245); expect(size.x).toBeLessThan(.26);
    expect(size.y).toBeGreaterThan(.295); expect(size.y).toBeLessThan(.315);
    expect(size.z).toBeGreaterThan(.28); expect(size.z).toBeLessThan(.31);
  });

  it('keeps the actual front visor in slot 1 and the side painted shell in slot 0', () => {
    const helmet = createFullfaceHelmet('#ffffff', '#263840');
    helmet.updateMatrixWorld(true);
    const visor = new Raycaster(new Vector3(0, 0, -1), new Vector3(0, 0, 1)).intersectObject(helmet, false)[0];
    const shell = new Raycaster(new Vector3(1, .07, .055), new Vector3(-1, 0, 0)).intersectObject(helmet, false)[0];
    expect(visor.face!.materialIndex).toBe(1);
    expect(shell.face!.materialIndex).toBe(0);
  });

  it('preserves live shell/visor recoloring without rebuilding geometry or changing dark trim', () => {
    const player = newPlayer(); player.bike = '450';
    const bike = makeBike(player, []);
    const helmet = bike.rider.getObjectByName('full-face-helmet') as Mesh;
    const materials = helmet.material as MeshStandardMaterial[], geometry = helmet.geometry;
    const trim = materials[2].color.getHex();
    const update = createPreviewColorUpdater(bike.body, bike.rider, player);
    update({ ...player, helmetColor: '#181818', helmetVisor: '#8e2737' });
    expect(materials[0].color.getHexString()).toBe('181818');
    expect(materials[1].color.getHexString()).toBe('8e2737');
    expect(materials[2].color.getHex()).toBe(trim);
    expect(helmet.geometry).toBe(geometry);
  });

  it('uses identical adult head dimensions on all five motorcycles', () => {
    const sizes: number[][] = [];
    for (const id of ['125', 'moped', 'scooter', '450', '701'] as const) {
      const player = newPlayer(); player.bike = id;
      const bike = makeBike(player, []), helmet = bike.rider.getObjectByName('full-face-helmet') as Mesh;
      bike.root.updateMatrixWorld(true);
      const size = helmet.geometry.boundingBox!.getSize(new Vector3()).multiply(helmet.getWorldScale(new Vector3()));
      sizes.push(size.toArray());
      expect(new Box3().setFromObject(helmet).isEmpty()).toBe(false);
    }
    for (const size of sizes)
      for (let axis = 0; axis < 3; axis++) expect(size[axis]).toBeCloseTo(sizes[0][axis], 8);
  });
});
