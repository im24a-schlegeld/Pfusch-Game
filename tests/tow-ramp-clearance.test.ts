import { expect, it, vi } from 'vitest';
import { Box3, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { BIKES } from '../app/domain/config';
import { newPlayer } from '../app/domain/progression';
import { Engine, LANE, STEP } from '../app/game/engine';
import { makeDetailedTraffic } from '../app/game/trafficModels';
import { makeBike } from '../app/game/vehicle';
import { RAMP_FRONT_CONTACT, TOW_RAMP } from '../app/game/trafficDomain';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

it.each(BIKES)(
  '$name keeps its actual tires above the rendered ramp during a side takeoff',
  (config) => {
    const bike = makeBike({ ...newPlayer(), bike: config.id }, []);
    bike.root.updateMatrixWorld(true);
    const tire = bike.wheels[0].getObjectByName('tire') as Mesh;
    const bounds = new Box3().setFromObject(tire);
    const axle = bike.wheels[0].getWorldPosition(new Vector3());
    expect(axle.z).toBeCloseTo(RAMP_FRONT_CONTACT[config.id].axle, 6);
    expect((bounds.max.y - bounds.min.y) / 2).toBeCloseTo(
      RAMP_FRONT_CONTACT[config.id].radius,
      6,
    );
    const tires: Vector3[] = [];
    for (const wheel of bike.wheels) {
      const mesh = wheel.getObjectByName('tire') as Mesh;
      const positions = mesh.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++)
        tires.push(
          new Vector3()
            .fromBufferAttribute(positions, i)
            .applyMatrix4(mesh.matrixWorld),
        );
    }
    const truck = makeDetailedTraffic('towtruck', 0);
    truck.updateMatrixWorld(true);
    const deck = truck.getObjectByName('traffic-bed') as Mesh;
    const deckAt = (z: number) =>
      new Raycaster(
        new Vector3(0, 4, z),
        new Vector3(0, -1, 0),
      ).intersectObject(deck)[0].point.y;
    // Derive the two supporting planes from the actual triangulated tray, not
    // the launch-height helper that this integration check exercises.
    const flat = deckAt(0),
      slope = deckAt(2.5) - deckAt(3.5);
    const intercept = deckAt(2.5) + 2.5 * slope;
    let checked = 0,
      minimum = Infinity;
    for (const velocity of [0, 6]) {
      const engine = new Engine(config, 539);
      engine.start();
      const tow = engine.spawn(
        'towtruck',
        1,
        velocity ? 5.4 : 6.2,
        0,
        velocity,
      )!;
      engine.move(1);
      for (let frame = 0; frame < 30 && engine.phase === 'playing'; frame++) {
        engine.advance(STEP);
        if (!engine.launchSerial) continue;
        for (const point of tires) {
          const x = engine.x - LANE + point.x,
            z = tow.z + point.z;
          if (
            Math.abs(x) > TOW_RAMP.halfWidth * 0.89 ||
            z < -1.1 ||
            z > TOW_RAMP.rearZ
          )
            continue;
          const surface = Math.min(flat, intercept - slope * z);
          minimum = Math.min(minimum, engine.height + point.y - surface);
          checked++;
        }
      }
      expect(engine.launchSerial).toBe(1);
    }
    expect(checked).toBeGreaterThan(100);
    expect(minimum).toBeGreaterThan(0.01);
  },
  60000,
);
