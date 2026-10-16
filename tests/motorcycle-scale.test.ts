import { installImportedBikeFixtures } from './importedBikeFixture';
installImportedBikeFixtures();
import { describe, expect, it, vi } from 'vitest';
import { Box3, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeBike } from '../app/game/vehicle';
import { BIKE_MODEL_SCALES } from '../app/game/vehicleScale';
import { IMPORTED_BIKE_WHEELBASE } from '../app/game/importedBikeDimensions';
import { getImportedBikeAsset } from '../app/game/importedBikeAsset';
import { hardwareComponents } from '../app/game/importedHardwareFinish';
vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(), fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(), accessoryMaterial: () => new MeshStandardMaterial(),
}));
describe('imported motorcycle dimensions with one unchanged adult', () => {
  it('removes only the two long Ciao control cables while retaining every other steering shell', () => {
    const source = getImportedBikeAsset('125');
    const part = source.manifest.parts.find(part => part.name === 'ciao_dark:steering')!;
    const components = hardwareComponents(part, source.binary);
    const cables = components.filter(c => c.max[1] - c.min[1] > 0.6);
    expect(cables).toHaveLength(2);
    const removed = new Set(cables.flatMap(c => c.triangles));
    expect(removed.size).toBe(1004);
    const sourceIndices = new Uint16Array(source.binary, part.index.offset, part.index.count);
    const bike = makeBike({ ...newPlayer(), bike: '125' }, []);
    const mesh = bike.body.getObjectByName(part.name) as Mesh;
    expect(mesh.geometry.index!.count).toBe(part.index.count - 1004 * 3);
    expect(Array.from(mesh.geometry.index!.array)).toEqual(Array.from(sourceIndices)
      .filter((_, index) => !removed.has(Math.floor(index / 3))));
    expect(mesh.geometry.getAttribute('position').count).toBe(part.position.count);
    expect(bike.body.getObjectByName('front-brake-cable')).toBeUndefined();
  });
  it('reduces only the classic moped by four percent and removes the entire front/rear indicator assemblies', () => {
    const bike = makeBike({ ...newPlayer(), bike: 'moped' }, []);
    expect(BIKE_MODEL_SCALES.moped).toBeCloseTo(1.25 * 0.96, 12);
    expect(bike.body.getObjectByName('moped_indicator:steering')).toBeUndefined();
    expect(bike.body.getObjectByName('moped_indicator:body')).toBeUndefined();
    const source = getImportedBikeAsset('moped');
    for (const [name, removed] of [
      ['moped_chrome:steering', 12], ['moped_chrome:body', 12],
      ['moped_dark:steering', 68], ['moped_dark:body', 68],
    ] as const) {
      const part = source.manifest.parts.find(part => part.name === name)!;
      const mesh = bike.body.getObjectByName(name) as Mesh;
      expect(mesh.geometry.index!.count).toBe(part.index.count - removed * 3);
    }
  });
  it.each(['125', 'moped', '450', '701', 'scooter'] as const)('%s keeps the source proportions, circular tyres and canonical wheelbase', id => {
    const source = getImportedBikeAsset(id).manifest.anchors;
    const size = IMPORTED_BIKE_WHEELBASE[id] / (source.rearAxle[2] - source.frontAxle[2]);
    const bike = makeBike({ ...newPlayer(), bike: id }, []);
    bike.root.scale.setScalar(1); bike.root.updateMatrixWorld(true);
    const axles = bike.wheels.map(wheel => wheel.getWorldPosition(new Vector3()).divideScalar(bike.body.scale.x));
    expect(axles[1].z - axles[0].z).toBeCloseTo(IMPORTED_BIKE_WHEELBASE[id], 7);
    for (const [i, wheel] of bike.wheels.entries()) {
      const tire = wheel.getObjectByName('tire') as Mesh;
      tire.geometry.computeBoundingBox();
      const bounds = tire.geometry.boundingBox!, radius = (i === 0 ? source.frontRadius : source.rearRadius) * size;
      const dimensions = bounds.getSize(new Vector3());
      expect(dimensions.y).toBeCloseTo(radius * 2, 2);
      expect(dimensions.z).toBeCloseTo(radius * 2, 2);
      expect(dimensions.x).toBeLessThan(radius);
      expect(wheel.scale.toArray()).toEqual([1, 1, 1]);
      const worldRadius = radius * BIKE_MODEL_SCALES[id];
      expect(wheel.userData.rollingRadius / 1.45).toBeCloseTo(worldRadius, 7);
      for (const travel of [-.02, 0, .085]) {
        bike.animateSuspension(0, travel); bike.root.updateMatrixWorld(true);
        expect(Math.abs(new Box3().setFromObject(tire, true).min.y)).toBeLessThan(.008);
      }
    }
  });
  it.each(['125', 'scooter', 'moped', '450', '701'] as const)(
    '%s retains world anatomy and grounded rear contact through suspension/wheelie',
    (id) => {
      const bike = makeBike({ ...newPlayer(), bike: id }, []);
      bike.root.scale.setScalar(1);
      for (const pitch of [0, 0.7, 1.2])
        for (const travel of [-0.008, 0, 0.024]) {
          bike.animateSuspension(pitch, travel);
          bike.root.updateMatrixWorld(true);
          expect(
            bike.rider
              .getWorldScale(new Vector3())
              .distanceTo(new Vector3(1, 1, 1)),
          ).toBeLessThan(1e-12);
          expect(bike.wheels[1].getWorldScale(new Vector3()).x).toBeCloseTo(
            BIKE_MODEL_SCALES[id],
            12,
          );
          expect(bike.wheels[1].getWorldPosition(new Vector3()).y).toBeCloseTo(
            bike.wheelRadius,
            7,
          );
          const helmet = bike.rider.getObjectByName('full-face-helmet')!;
          expect(helmet.getWorldScale(new Vector3()).x).toBeCloseTo(1.12, 12);
        }
    },
  );
});
