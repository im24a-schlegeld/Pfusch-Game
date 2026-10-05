import { describe, expect, it, vi } from 'vitest';
import { Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { BIKES } from '../app/domain/config';
import { newPlayer } from '../app/domain/progression';
import { Engine, STEP } from '../app/game/engine';
import { TRAFFIC_SHAPES, trafficFrontReach } from '../app/game/trafficDomain';
import { makeBike } from '../app/game/vehicle';
import { installImportedBikeFixtures } from './importedBikeFixture';

installImportedBikeFixtures();

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

describe('traffic contact at the actual front tire', () => {
  it.each(BIKES)(
    '$name contact follows the rendered front tire through a wheelie',
    (config) => {
      const bike = makeBike({ ...newPlayer(), bike: config.id }, []);
      const tire = bike.wheels[0].getObjectByName('tire') as Mesh;
      const vertices = tire.geometry.getAttribute('position');
      const point = new Vector3();
      for (const pitch of [0, 0.4, 0.9]) {
        bike.animateSuspension(pitch, 0);
        bike.root.updateMatrixWorld(true);
        let leadingZ = Infinity;
        for (let index = 0; index < vertices.count; index++) {
          point
            .fromBufferAttribute(vertices, index)
            .applyMatrix4(tire.matrixWorld);
          leadingZ = Math.min(leadingZ, point.z);
        }
        // The deterministic circle encloses its finite polygonal tire mesh.
        const clearance = leadingZ + trafficFrontReach(config.id, pitch);
        expect(clearance).toBeGreaterThanOrEqual(-0.000001);
        expect(clearance).toBeLessThan(0.004);
      }
    },
  );

  it.each(BIKES)(
    '$name stops a newly crossed bumper at first contact without tick penetration',
    (config) => {
      for (const elapsed of [0, 10000]) {
        for (const kind of ['car', 'van', 'construction'] as const) {
          const engine = new Engine(config, 539);
          engine.start();
          engine.elapsed = elapsed;
          const contact =
            TRAFFIC_SHAPES[kind].rearZ + trafficFrontReach(config.id);
          const obstacle = engine.spawn(kind, 0, contact + 0.1, 0, 6)!;
          engine.advance(STEP);
          expect(engine.phase).toBe('crashed');
          expect(engine.crashObstacle).toBe(obstacle);
          expect(obstacle.z).toBeCloseTo(contact, 8);
          expect(engine.x).toBe(0);
          expect(obstacle.z).toBeLessThan(contact + 0.1);
        }
      }
    },
  );

  it('preserves existing side contacts and full airborne traffic clearance', () => {
    const side = new Engine(BIKES[2], 539);
    side.start();
    const overlapping = side.spawn('car', 0, 0)!;
    side.advance(STEP);
    expect(side.phase).toBe('crashed');
    expect(overlapping.z).toBeLessThan(0);

    const airborne = new Engine(BIKES[2], 539);
    airborne.start();
    airborne.height = 3;
    const contact = TRAFFIC_SHAPES.car.rearZ + trafficFrontReach('450');
    const below = airborne.spawn('car', 0, contact + 0.1)!;
    airborne.advance(STEP);
    expect(airborne.phase).toBe('playing');
    expect(below.z).toBeLessThan(contact);
    expect(airborne.height).toBeGreaterThan(TRAFFIC_SHAPES.car.height);
  });
});
