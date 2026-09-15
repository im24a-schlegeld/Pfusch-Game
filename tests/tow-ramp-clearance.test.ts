import { expect, it, vi } from 'vitest';
import { Box3, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { BIKES } from '../app/domain/config';
import { newPlayer } from '../app/domain/progression';
import { makeDetailedTraffic } from '../app/game/trafficModels';
import { makeBike } from '../app/game/vehicle';
import {
  RAMP_FRONT_CONTACT,
  TOW_RAMP,
  towDeckPosition,
  towRampPose,
} from '../app/game/trafficDomain';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

it.each(BIKES)(
  '$name rides its actual tires up the rendered ramp and holds clear of the cab',
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
    const tires = bike.wheels.map(
      (wheel) => wheel.getObjectByName('tire') as Mesh,
    );
    const truck = makeDetailedTraffic('towtruck', 0);
    truck.updateMatrixWorld(true);
    const deck = truck.getObjectByName('traffic-bed') as Mesh;
    const deckAt = (z: number) =>
      new Raycaster(
        new Vector3(0, 4, z),
        new Vector3(0, -1, 0),
      ).intersectObject(deck)[0].point.y;
    // Measure the actual triangulated tray independently of the domain helper.
    const flat = deckAt(0),
      slope = deckAt(2.5) - deckAt(3.5);
    const intercept = deckAt(2.5) + 2.5 * slope;
    const front = RAMP_FRONT_CONTACT[config.id];
    const holdZ = towDeckPosition(config.id);
    const start = TOW_RAMP.rearZ - front.axle + front.radius + 0.2;
    const point = new Vector3();
    let checked = 0,
      minimum = Infinity,
      maximumPitch = 0;
    let previous = towRampPose(config.id, start);
    for (let step = 0; step <= 440; step++) {
      const localZ = start + ((holdZ - start) * step) / 440;
      const pose = towRampPose(config.id, localZ);
      bike.animateSuspension(pose.pitch, 0);
      bike.root.position.set(0, pose.height, localZ);
      bike.root.updateMatrixWorld(true);
      expect(Math.abs(pose.pitch - previous.pitch)).toBeLessThan(0.06);
      expect(Math.abs(pose.height - previous.height)).toBeLessThan(0.055);
      previous = pose;
      maximumPitch = Math.max(maximumPitch, pose.pitch);
      for (const tire of tires) {
        const positions = tire.geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
          point
            .fromBufferAttribute(positions, i)
            .applyMatrix4(tire.matrixWorld);
          const surface =
            point.z >= -1.1 && point.z <= TOW_RAMP.rearZ
              ? Math.min(flat, intercept - slope * point.z)
              : 0;
          minimum = Math.min(minimum, point.y - surface);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(minimum).toBeGreaterThan(0.01);
    expect(maximumPitch).toBeGreaterThan(0.1);
    expect(previous.pitch).toBeCloseTo(0, 7);
    expect(previous.height).toBeCloseTo(flat + 0.018, 6);
    expect(new Box3().setFromObject(tires[0]).min.z).toBeGreaterThan(
      TOW_RAMP.cabRearZ + 0.1,
    );
    expect(bike.wheels[1].getWorldPosition(point).z).toBeLessThan(
      TOW_RAMP.frontZ,
    );
  },
  60000,
);
