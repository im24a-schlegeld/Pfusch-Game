import { describe, expect, it, vi } from 'vitest';
import {
  Box3,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import {
  SUPERMOTO_WHEELS,
  addSupermotoRim,
  supermotoRimGeometry,
  supermotoSpokeEndpoints,
  supermotoTireGeometry,
} from '../app/game/supermotoWheels';
import { makeBike } from '../app/game/vehicle';
import { newPlayer } from '../app/domain/progression';
import { envelope, faces, gap, triangleGap } from './helpers/solidClearance';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(), fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(), accessoryMaterial: () => new MeshStandardMaterial(),
}));

describe('Supermoto road wheel construction', () => {
  it('brings both rotors and attached calipers close to the hubs while clearing every actual spoke through travel', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    const calipers = bike.body.getObjectsByProperty('name', 'brake-caliper') as Mesh[];
    const carriers = bike.body.getObjectsByProperty('name', 'brake-caliper-carrier') as Mesh[];
    expect(calipers).toHaveLength(2); expect(carriers).toHaveLength(2);
    for (const travel of [-0.20, 0, 0.20]) {
      bike.animateSuspension(0, travel); bike.root.updateMatrixWorld(true);
      bike.wheels.forEach((wheel, i) => {
        const x = i ? 0.082 : -0.070;
        const inverse = wheel.matrixWorld.clone().invert();
        const disc = wheel.getObjectByName(i ? 'rear-brake-disc' : 'front-brake-disc') as Mesh;
        expect(disc.position.x).toBeCloseTo(x, 8);
        expect(envelope(calipers[i], inverse).getCenter(new Vector3()).x).toBeCloseTo(x, 7);
        const hubMount = wheel.getObjectByName('supermoto-brake-hub-mount') as Mesh;
        const mount = envelope(hubMount, inverse);
        expect(i ? mount.max.x : mount.min.x).toBeCloseTo(x, 7);
        const spokes = wheel.getObjectByName('cross-laced-spokes') as InstancedMesh;
        const instance = new Matrix4();
        for (let index = 0; index < spokes.count; index++) {
          spokes.getMatrixAt(index, instance);
          const spoke = new Mesh(spokes.geometry, spokes.material);
          spoke.matrixWorld.copy(spokes.matrixWorld).multiply(instance);
          const spokeBounds = envelope(spoke, inverse);
          for (const part of [disc, calipers[i], carriers[i]]) {
            if (gap(envelope(part, inverse), spokeBounds) > 0.003) continue;
            for (const a of faces(part, inverse)) for (const b of faces(spoke, inverse)) {
              if (gap(a.bounds, b.bounds) > 0.003) continue;
              expect(triangleGap(a.triangle, b.triangle), `${part.name}/spoke ${index}, wheel ${i}, travel ${travel}`).toBeGreaterThan(0.003);
            }
          }
        }
      });
    }
    const sport = makeBike({ ...newPlayer(), bike: '701' }, []);
    expect(sport.wheels[0].getObjectsByProperty('name', 'front-brake-disc').map(part => part.position.x)).toEqual([-0.085, 0.085]);
    expect(sport.wheels[1].getObjectByName('rear-brake-disc')!.position.x).toBe(0.105);
  });
  it('enlarges both wheel diameters by five percent while retaining independent widths', () => {
    const { front, rear } = SUPERMOTO_WHEELS;
    expect((front.beadRadius * 2) / 0.0254).toBeCloseTo(16.5 * 1.05, 9);
    expect((rear.beadRadius * 2) / 0.0254).toBeCloseTo(17 * 1.05, 9);
    expect(front.outerRadius / 0.29355).toBeCloseTo(1.05, 9);
    expect(rear.outerRadius / 0.3059).toBeCloseTo(1.05, 9);
    expect(front.outerRadius - front.beadRadius).toBeCloseTo(
      front.tireWidth * 0.7 * 1.05,
      9,
    );
    expect(rear.outerRadius - rear.beadRadius).toBeCloseTo(
      rear.tireWidth * 0.6 * 1.05,
      9,
    );
    expect(front.rimEdgeRadius).toBeGreaterThan(front.beadRadius);
    expect(front.rimWidth).toBeLessThan(rear.rimWidth);
  });

  it('keeps exact circular rolling radii and independent widths without spline overshoot', () => {
    for (const rear of [false, true]) {
      const size = rear ? SUPERMOTO_WHEELS.rear : SUPERMOTO_WHEELS.front;
      const geometry = supermotoTireGeometry(rear);
      const bounds = geometry.boundingBox!;
      expect(bounds.max.x - bounds.min.x).toBeCloseTo(size.tireWidth, 7);
      expect(bounds.min.y + size.outerRadius).toBeCloseTo(0, 7);
      expect(bounds.max.y).toBeCloseTo(size.outerRadius, 7);
      expect(bounds.max.z - bounds.min.z).toBeCloseTo(size.outerRadius * 2, 7);
      const points = geometry.getAttribute('position');
      const normals = geometry.getAttribute('normal');
      let hasShoulder = false;
      for (let index = 0; index < points.count; index++) {
        const radius = Math.hypot(points.getY(index), points.getZ(index));
        expect(radius).toBeLessThanOrEqual(size.outerRadius + 1e-7);
        expect(radius).toBeGreaterThanOrEqual(size.beadRadius - 0.001501);
        expect(
          new Vector3().fromBufferAttribute(normals, index).length(),
        ).toBeCloseTo(1, 5);
        if (
          Math.abs(points.getX(index)) > size.tireWidth * 0.4 &&
          radius > size.outerRadius - 0.02
        )
          hasShoulder = true;
      }
      expect(hasShoulder).toBe(true);
      expect(geometry.boundingSphere!.radius).toBeLessThan(
        size.outerRadius + 0.001,
      );
      geometry.dispose();
    }
  });

  it('builds a thin visible rim lip inside the sidewall without occupying the wheel opening', () => {
    for (const rear of [false, true]) {
      const size = rear ? SUPERMOTO_WHEELS.rear : SUPERMOTO_WHEELS.front;
      const geometry = supermotoRimGeometry(rear);
      const points = geometry.getAttribute('position');
      expect(
        geometry.boundingBox!.max.x - geometry.boundingBox!.min.x,
      ).toBeLessThan(size.tireWidth);
      expect(geometry.boundingBox!.max.y).toBeCloseTo(size.rimEdgeRadius, 7);
      for (let index = 0; index < points.count; index++)
        expect(
          Math.hypot(points.getY(index), points.getZ(index)),
        ).toBeGreaterThan(size.beadRadius - 0.0159);
      geometry.dispose();
    }
  });

  it('joins all crossed spokes to the metal rim bed and hub flanges on a common X axle', () => {
    for (const rear of [false, true]) {
      const size = rear ? SUPERMOTO_WHEELS.rear : SUPERMOTO_WHEELS.front;
      const wheel = new Group();
      addSupermotoRim(
        wheel,
        rear,
        new MeshStandardMaterial(),
        new MeshStandardMaterial(),
      );
      wheel.updateMatrixWorld(true);
      const barrel = wheel.getObjectByName('formed-rim-barrel') as Mesh;
      const hub = wheel.getObjectByName('supermoto-wheel-hub') as Mesh;
      const rotorMount = wheel.getObjectByName(
        'supermoto-brake-hub-mount',
      ) as Mesh;
      const spokes = wheel.getObjectByName(
        'cross-laced-spokes',
      ) as InstancedMesh;
      expect(spokes.count).toBe(36);
      expect(
        new Box3().setFromObject(barrel).getCenter(new Vector3()).length(),
      ).toBeLessThan(1e-7);
      expect(
        new Box3().setFromObject(hub).getCenter(new Vector3()).length(),
      ).toBeLessThan(1e-7);
      expect(
        new Box3().setFromObject(hub).getSize(new Vector3()).x,
      ).toBeCloseTo(size.hubHalfWidth * 2, 7);
      const mountBounds = new Box3().setFromObject(rotorMount);
      expect(
        size.brakeMountX < 0 ? mountBounds.min.x : mountBounds.max.x,
      ).toBeCloseTo(size.brakeMountX, 7);
      const matrix = new Matrix4();
      for (let index = 0; index < spokes.count; index++) {
        const { hub: start, bed } = supermotoSpokeEndpoints(rear, index);
        spokes.getMatrixAt(index, matrix);
        expect(
          new Vector3(0, -0.5, 0).applyMatrix4(matrix).distanceTo(start),
        ).toBeLessThan(1e-7);
        expect(
          new Vector3(0, 0.5, 0).applyMatrix4(matrix).distanceTo(bed),
        ).toBeLessThan(1e-7);
        expect(Math.hypot(start.y, start.z)).toBeLessThan(size.spokeHubRadius);
        expect(Math.hypot(bed.y, bed.z)).toBeGreaterThan(
          size.beadRadius - 0.015,
        );
        expect(Math.hypot(bed.y, bed.z)).toBeLessThan(size.beadRadius - 0.01);
        expect(Math.abs(bed.x)).toBeLessThan(size.rimWidth * 0.225);
      }
      wheel.traverse((object) => {
        if (object instanceof Mesh) object.geometry.dispose();
      });
    }
  });
});
