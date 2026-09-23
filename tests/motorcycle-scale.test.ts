import { describe, expect, it, vi } from 'vitest';
import { Box3, Mesh, MeshStandardMaterial, Triangle, Vector3 } from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeBike } from '../app/game/vehicle';
import { BIKE_MODEL_SCALES } from '../app/game/vehicleScale';
import { SPORT_GEOMETRY } from '../app/game/sportGeometry';
import { createSportDesign } from '../app/game/sportDesign';
import { SUPERMOTO_CHASSIS } from '../app/game/supermotoFit';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

describe('larger motorcycles with one unchanged adult', () => {
  it('wraps the Sport mudguard down behind the fork while clearing tire and radiator', () => {
    const bike = makeBike({ ...newPlayer(), bike: '701' }, []);
    bike.root.scale.setScalar(1);
    bike.body.scale.setScalar(1);
    const fender = bike.body.getObjectByName('sport-front-fender') as Mesh;
    // The radiator core is now part of the shared cavity draw call. Use its
    // authored vertices in that assembly's space, not the obsolete mesh name
    // or the combined bounds of unrelated intake/headlight cavities.
    const assembly = bike.body.getObjectByName('sport-front-assembly')!;
    const core = createSportDesign().parts.find((part) => part.name === 'sport-radiator-core')!;
    const radiatorTriangles: Triangle[] = [];
    for (let i = 0; i < core.geometry.indices.length; i += 3) {
      const vertex = (j: number) => new Vector3()
        .fromArray(core.geometry.positions, core.geometry.indices[i + j] * 3);
      radiatorTriangles.push(new Triangle(vertex(0), vertex(1), vertex(2)));
    }
    const positions = fender.geometry.getAttribute('position');
    const rearPoints: Vector3[] = [];
    for (let i = 0; i < positions.count; i++) {
      const point = new Vector3().fromBufferAttribute(positions, i);
      if (point.z > -.48) rearPoints.push(point);
      expect(Math.hypot(point.y - SPORT_GEOMETRY.frontRadius, point.z - SPORT_GEOMETRY.frontAxle))
        .toBeGreaterThanOrEqual(SPORT_GEOMETRY.frontRadius + .0149);
    }
    expect(rearPoints.length).toBeGreaterThan(20);
    expect(Math.min(...rearPoints.map(point => point.y))).toBeLessThan(.45);
    for (const travel of [-.008, 0, .024]) {
      bike.animateSuspension(0, travel);
      bike.root.updateMatrixWorld(true);
      const toRadiator = assembly.matrixWorld.clone().invert().multiply(fender.matrixWorld);
      let clearance = Infinity;
      const nearest = new Vector3();
      for (let i = 0; i < positions.count; i++) {
        const point = new Vector3().fromBufferAttribute(positions, i).applyMatrix4(toRadiator);
        // The curved radiator's box contains empty space behind the mudguard.
        // Measure against its actual triangles instead of that oversized box.
        for (const triangle of radiatorTriangles) {
          triangle.closestPointToPoint(point, nearest);
          clearance = Math.min(clearance, nearest.distanceTo(point));
        }
      }
      expect(clearance).toBeGreaterThan(.005);
    }
  });
  it('uses equal 17-inch Supermoto wheels with wider tires that both stay grounded', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    bike.root.scale.setScalar(1);
    for (const [i, wheel] of bike.wheels.entries()) {
      bike.animateSuspension(0, 0);
      const radius = SUPERMOTO_CHASSIS.wheelRadius;
      const tire = wheel.getObjectByName('tire') as Mesh;
      const rim = wheel.getObjectByName('formed-rim-barrel') as Mesh;
      tire.geometry.computeBoundingBox();
      rim.geometry.computeBoundingBox();
      // Geometry bounds catch both an unchanged tire and a tire enlarged
      // around the old small rim, independent of the scene display scale.
      expect(tire.geometry.boundingBox!.max.y).toBeCloseTo(radius, 5);
      expect(tire.geometry.boundingBox!.min.y).toBeCloseTo(-radius, 5);
      expect(rim.geometry.boundingBox!.max.y).toBeCloseTo(
        SUPERMOTO_CHASSIS.rimRadius + 0.003,
        5,
      );
      expect(wheel.position.y).toBeCloseTo(radius, 12);
      const width = tire.geometry.boundingBox!.max.x - tire.geometry.boundingBox!.min.x;
      const nominalWidth = i === 0 ? SUPERMOTO_CHASSIS.frontTireWidth : SUPERMOTO_CHASSIS.rearTireWidth;
      // The existing moulded sidewall detail protrudes less than a millimetre.
      expect(Math.abs(width - nominalWidth)).toBeLessThan(0.0015);
      for (const travel of [-0.008, 0, 0.024]) {
        bike.animateSuspension(0, travel);
        bike.root.updateMatrixWorld(true);
        const tireBottom = new Box3().setFromObject(tire, true).min.y;
        expect(tireBottom).toBeGreaterThan(-0.0001);
        expect(tireBottom).toBeLessThan(0.0005);
      }
    }
  });
  it.each(['125', 'scooter', '450', '701'] as const)(
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
            12,
          );
          const helmet = bike.rider.getObjectByName('full-face-helmet')!;
          expect(helmet.getWorldScale(new Vector3()).x).toBeCloseTo(1.065, 12);
        }
    },
  );
});
