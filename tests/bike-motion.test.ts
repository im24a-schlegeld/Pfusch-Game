import { describe, expect, it } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { suspensionPose } from '../app/game/bikeMotion';
import { SPORT_GEOMETRY } from '../app/game/sportGeometry';
import { SUPERMOTO_CHASSIS } from '../app/game/supermotoFit';

const geometries = [
  {
    name: '125',
    rear: 0.55,
    front: -0.7,
    radius: 0.305,
    rearRadius: 0.305,
    topY: 0.94,
    topZ: -0.47,
    forkX: 0.08,
  },
  {
    name: '450',
    rear: SUPERMOTO_CHASSIS.rearAxle,
    front: SUPERMOTO_CHASSIS.frontAxle,
    radius: SUPERMOTO_CHASSIS.wheelRadius,
    rearRadius: SUPERMOTO_CHASSIS.wheelRadius,
    topY: SUPERMOTO_CHASSIS.forkTopY,
    topZ: -0.4,
    forkX: 0.08,
  },
  {
    name: '701',
    rear: SPORT_GEOMETRY.rearAxle,
    front: SPORT_GEOMETRY.frontAxle,
    radius: SPORT_GEOMETRY.frontRadius,
    rearRadius: SPORT_GEOMETRY.rearRadius,
    topY: SPORT_GEOMETRY.forkTopY,
    topZ: SPORT_GEOMETRY.forkTopZ,
    forkX: 0.105,
  },
];
const transform = (angle: number, position: Vector3) =>
  new Matrix4().makeRotationX(angle).setPosition(position);
const close = (actual: Vector3, expected: Vector3) =>
  expect(actual.distanceTo(expected)).toBeLessThan(1e-12);

describe('visual front suspension', () => {
  for (const geometry of geometries) {
    const { name, rear, front, radius, rearRadius } = geometry;
    it(`${name}: preserves both wheel worlds and front caliper/fender alignment at every pitch and compression`, () => {
      for (const pitch of [0, 0.7, 1.2]) {
        const expected = transform(
          pitch,
          new Vector3(
            0,
            rearRadius * (1 - Math.cos(pitch)) + rear * Math.sin(pitch),
            0,
          ),
        );
        for (const travel of [-0.05, -0.008, 0, 0.008, 0.024, 0.05]) {
          const pose = suspensionPose(pitch, travel, rear, front, rearRadius);
          const body = transform(pose.pitch, pose.position);
          const axle = transform(pose.axleAngle, pose.axlePosition);
          const frontWorld = body.clone().multiply(axle);
          const rearCenter = new Vector3(0, rearRadius, rear).applyMatrix4(
            body,
          );
          const frontCenter = new Vector3(0, radius, front).applyMatrix4(
            frontWorld,
          );
          close(
            rearCenter,
            new Vector3(0, rearRadius, rear).applyMatrix4(expected),
          );
          close(
            frontCenter,
            new Vector3(0, radius, front).applyMatrix4(expected),
          );
          expect(rearCenter.y - rearRadius).toBeCloseTo(0, 12);
          expect(frontCenter.y - radius).toBeGreaterThanOrEqual(-1e-12);
          // Test the entire front-assembly rigid transform, including asymmetric
          // caliper and low-fender points, not only the axle centre.
          for (const point of [
            new Vector3(-0.085, radius + 0.056, front + 0.125),
            new Vector3(0.085, radius + 0.056, front + 0.125),
            new Vector3(0, radius * 2 + 0.035, front),
            new Vector3(0.07, radius * 1.8, front - 0.18),
          ])
            close(
              point.clone().applyMatrix4(frontWorld),
              point.clone().applyMatrix4(expected),
            );
          expect(
            [...body.elements, ...frontWorld.elements].every(Number.isFinite),
          ).toBe(true);
        }
      }
    });
    it(`${name}: telescopic fork joins the moving chassis top to the unchanged wheel axle`, () => {
      for (const pitch of [0, 0.7, 1.2]) {
        for (const travel of [-0.008, 0, 0.024]) {
          const pose = suspensionPose(pitch, travel, rear, front, rearRadius);
          const body = transform(pose.pitch, pose.position);
          const axle = transform(pose.axleAngle, pose.axlePosition);
          for (const side of [-1, 1]) {
            const upper = new Vector3(
              side * geometry.forkX,
              geometry.topY,
              geometry.topZ,
            );
            const originalLower = new Vector3(
              side * geometry.forkX,
              radius,
              front,
            );
            const lower = originalLower.clone().applyMatrix4(axle);
            const direction = upper.clone().sub(lower);
            const length = direction.length();
            const originalLength = upper.distanceTo(originalLower);
            const rod = new Matrix4().compose(
              lower.clone().add(upper).multiplyScalar(0.5),
              new Quaternion().setFromUnitVectors(
                new Vector3(0, 1, 0),
                direction.normalize(),
              ),
              new Vector3(1, length / originalLength, 1),
            );
            const rodWorld = body.clone().multiply(rod);
            close(
              new Vector3(0, -originalLength / 2, 0).applyMatrix4(rodWorld),
              lower.clone().applyMatrix4(body),
            );
            close(
              new Vector3(0, originalLength / 2, 0).applyMatrix4(rodWorld),
              upper.clone().applyMatrix4(body),
            );
            close(
              lower.clone().applyMatrix4(body),
              originalLower.clone().applyMatrix4(body.clone().multiply(axle)),
            );
            if (travel > 0) expect(length).toBeLessThan(originalLength);
            if (travel < 0) expect(length).toBeGreaterThan(originalLength);
          }
        }
      }
    });
  }
  it('bounds visual travel without changing the requested physics pitch', () => {
    const { rear, front, rearRadius } = geometries[2];
    for (const pitch of [0, 0.7, 1.2]) {
      expect(suspensionPose(pitch, 1, rear, front, rearRadius)).toEqual(
        suspensionPose(pitch, 0.024, rear, front, rearRadius),
      );
      expect(suspensionPose(pitch, -1, rear, front, rearRadius)).toEqual(
        suspensionPose(pitch, -0.008, rear, front, rearRadius),
      );
      const pose = suspensionPose(pitch, 0.024, rear, front, rearRadius);
      expect(pose.pitch + pose.axleAngle).toBeCloseTo(pitch, 12);
    }
  });
});
