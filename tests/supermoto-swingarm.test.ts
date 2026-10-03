import { describe, expect, it, vi } from 'vitest';
import {
  Box3,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import { activeSuspensionPose } from '../app/game/activeSuspension';
import { CHAIN_DRIVE } from '../app/game/driveGeometry';
import { SUPERMOTO_CHASSIS } from '../app/game/supermotoFit';
import { SUPERMOTO_WHEELS } from '../app/game/supermotoWheelDimensions';
import { SUPERMOTO_SHOCK_LOWER_MOUNT } from '../app/game/supermotoShockMount';
import { makeBike } from '../app/game/vehicle';
import { newPlayer } from '../app/domain/progression';
import { envelope, faces, gap, triangleGap } from './helpers/solidClearance';
import {
  SUPERMOTO_SWINGARM,
  supermotoSwingarmGeometry,
} from '../app/game/supermotoSwingarm';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(), fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(), accessoryMaterial: () => new MeshStandardMaterial(),
}));

const dimensions = SUPERMOTO_SWINGARM;
function spar(side: number) {
  const mesh = new Mesh(
    supermotoSwingarmGeometry(side),
    new MeshStandardMaterial(),
  );
  mesh.updateMatrixWorld(true);
  return mesh;
}
function through(mesh: Mesh, y: number, z: number) {
  return new Raycaster(
    new Vector3(1, y, z),
    new Vector3(-1, 0, 0),
  ).intersectObject(mesh, false);
}

/** Actual projected outer silhouette, independent of authored section data.
 * Internal bores contribute no area to this convex side outline. */
function sideSilhouetteArea(points: Vector2[]) {
  const unique = [
    ...new Map(
      points.map((point) => [`${point.x},${point.y}`, point]),
    ).values(),
  ].sort((a, b) => a.x - b.x || a.y - b.y);
  const turn = (a: Vector2, b: Vector2, c: Vector2) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const halfHull = (values: Vector2[]) => {
    const hull: Vector2[] = [];
    for (const point of values) {
      while (
        hull.length > 1 &&
        turn(hull[hull.length - 2], hull[hull.length - 1], point) <= 0
      )
        hull.pop();
      hull.push(point);
    }
    return hull.slice(0, -1);
  };
  const hull = [...halfHull(unique), ...halfHull([...unique].reverse())];
  return (
    Math.abs(
      hull.reduce((area, point, index) => {
        const next = hull[(index + 1) % hull.length];
        return area + point.x * next.y - point.y * next.x;
      }, 0),
    ) / 2
  );
}

describe('faceted Supermoto swingarm', () => {
  it('has broad planar side faces and closed, outward-wound chamfers instead of a rounded loft', () => {
    const geometry = supermotoSwingarmGeometry(1);
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    const indices = geometry.getIndex()!;
    const normal = new Vector3();
    let planarSideProjection = 0,
      signedVolume = 0;
    const edges = new Map<string, { count: number; orientation: number }>();
    const silhouette: Vector2[] = [];
    const key = (point: Vector3) =>
      point
        .toArray()
        .map((value) => Math.round(value * 1e6))
        .join(',');
    for (let index = 0; index < indices.count; index += 3) {
      const a = new Vector3().fromBufferAttribute(
        positions,
        indices.getX(index),
      );
      const b = new Vector3().fromBufferAttribute(
        positions,
        indices.getX(index + 1),
      );
      const c = new Vector3().fromBufferAttribute(
        positions,
        indices.getX(index + 2),
      );
      normal.subVectors(b, a).cross(new Vector3().subVectors(c, a));
      const faceArea = normal.length() / 2;
      expect(faceArea).toBeGreaterThan(1e-10);
      normal.normalize();
      if (Math.abs(normal.x) > 0.995)
        planarSideProjection += faceArea * Math.abs(normal.x);
      for (const offset of [0, 1, 2]) {
        const vertexNormal = new Vector3().fromBufferAttribute(
          normals,
          indices.getX(index + offset),
        );
        expect(vertexNormal.dot(normal)).toBeGreaterThan(0.99999);
      }
      signedVolume += a.dot(new Vector3().crossVectors(b, c)) / 6;
      silhouette.push(
        new Vector2(a.z, a.y),
        new Vector2(b.z, b.y),
        new Vector2(c.z, c.y),
      );
      for (const [p, q] of [
        [a, b],
        [b, c],
        [c, a],
      ]) {
        const pKey = key(p),
          qKey = key(q);
        const edge = [pKey, qKey].sort().join('|');
        const previous = edges.get(edge) ?? { count: 0, orientation: 0 };
        edges.set(edge, {
          count: previous.count + 1,
          orientation: previous.orientation + (pKey < qKey ? 1 : -1),
        });
      }
    }
    // Compare flat plate coverage with its visible SIDE silhouette, not all
    // exterior + internal machined surfaces. Bore walls add real surface area
    // but cannot make an otherwise planar side panel look like a round tube.
    const silhouetteArea = sideSilhouetteArea(silhouette);
    expect(planarSideProjection / (2 * silhouetteArea)).toBeGreaterThan(0.75);
    expect(signedVolume).toBeGreaterThan(0.001);
    expect(
      [...edges.values()].every(
        (edge) => edge.count === 2 && edge.orientation === 0,
      ),
    ).toBe(true);
    geometry.dispose();
  });

  it('keeps the fixed pivot bore and rear axle slot genuinely open with material around both mounts', () => {
    for (const side of [-1, 1]) {
      const mesh = spar(side);
      expect(through(mesh, dimensions.pivotY, dimensions.pivotZ)).toHaveLength(
        0,
      );
      expect(
        through(mesh, dimensions.pivotY + 0.037, dimensions.pivotZ).length,
      ).toBeGreaterThan(0);
      expect(through(mesh, dimensions.axleY, dimensions.axleZ)).toHaveLength(0);
      expect(
        through(mesh, dimensions.axleY, dimensions.axleZ + 0.017),
      ).toHaveLength(0);
      expect(
        through(mesh, dimensions.axleY + 0.02, dimensions.axleZ).length,
      ).toBeGreaterThan(0);
      expect(
        through(mesh, dimensions.axleY, dimensions.axleZ + 0.028).length,
      ).toBeGreaterThan(0);
      // The crossmember clears the tire and still enters a solid side panel.
      expect(through(mesh, SUPERMOTO_SHOCK_LOWER_MOUNT.bridge[1], SUPERMOTO_SHOCK_LOWER_MOUNT.bridge[2]).length).toBeGreaterThan(0);
      mesh.geometry.dispose();
    }
  });

  it('forms a deep pivot shoulder, tapered box and actual shallow side channel without enlarging the lateral envelope', () => {
    for (const side of [-1, 1]) {
      const mesh = spar(side);
      const centerX = side * CHAIN_DRIVE.rightSwingarmX;
      const depths = [0.23, 0.40, 0.63].map(z => {
        const top = new Raycaster(new Vector3(centerX, 1, z), new Vector3(0, -1, 0)).intersectObject(mesh, false)[0];
        const bottom = new Raycaster(new Vector3(centerX, 0, z), new Vector3(0, 1, 0)).intersectObject(mesh, false)[0];
        expect(top).toBeDefined(); expect(bottom).toBeDefined();
        return top.point.y - bottom.point.y;
      });
      expect(depths[0]).toBeGreaterThan(0.11);
      expect(depths[1]).toBeGreaterThan(0.09);
      expect(depths[2]).toBeLessThan(0.065);
      const z = 0.38;
      const y = dimensions.pivotY + (dimensions.axleY - dimensions.pivotY)
        * (z - dimensions.pivotZ) / (dimensions.axleZ - dimensions.pivotZ);
      const faceX = (height: number) => new Raycaster(new Vector3(side, height, z),
        new Vector3(-side, 0, 0)).intersectObject(mesh, false)[0].point.x * side;
      expect(faceX(y + 0.035) - faceX(y)).toBeCloseTo(0.003, 6);
      mesh.geometry.dispose();
    }
  });

  it('keeps the complete forged solids clear of tyre, every chain instance, shock and direct mount through travel', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    const arms = bike.body.getObjectsByProperty('name', 'box-section-swingarm') as Mesh[];
    const tire = bike.wheels[1].getObjectByName('tire') as Mesh;
    const mechanism = new Set<Mesh>();
    const movingRoots = ['supermoto-shock-damper', 'supermoto-shock-reservoir',
      'supermoto-shock-spring-seat', 'supermoto-shock-eyelet', 'rear-shock-spring',
      'supermoto-shock-lower-pin', 'shock-lower-link']
      .flatMap(name => bike.body.getObjectsByProperty('name', name));
    for (const root of movingRoots) root.traverse(part => {
      if (part instanceof Mesh) mechanism.add(part);
    });
    // Upper barrel, both reservoir caps and the reservoir neck move as real
    // children. Include their complete surfaces, not only parent cylinders.
    expect([...mechanism].filter(part => part.name === 'supermoto-shock-upper-body')).toHaveLength(1);
    expect([...mechanism].filter(part => part.name === 'supermoto-shock-reservoir-cap')).toHaveLength(2);
    expect([...mechanism].filter(part => part.name === 'supermoto-shock-reservoir-neck')).toHaveLength(1);
    expect([...mechanism].filter(part => part.name === 'supermoto-shock-lower-pin')).toHaveLength(1);
    expect([...mechanism].filter(part => part.name === 'shock-lower-link')).toHaveLength(2);
    const chains = ['left-drive-chain', 'chain-rollers']
      .map(name => bike.body.getObjectByName(name) as InstancedMesh);
    expect(arms).toHaveLength(2); expect(mechanism.size).toBeGreaterThan(12);
    const instance = new Matrix4(), transform = new Matrix4(), vertex = new Vector3();
    for (const pitch of [0, 0.85]) for (const travel of [-0.20, 0, 0.20]) {
      bike.animateSuspension(pitch, travel, pitch > 0 ? 1 : 0);
      bike.root.updateMatrixWorld(true);
      const inverse = bike.body.matrixWorld.clone().invert();
      const chainBounds = chains.map(chain => {
        expect(chain).toBeInstanceOf(InstancedMesh);
        const bounds = new Box3(), positions = chain.geometry.getAttribute('position');
        for (let i = 0; i < chain.count; i++) {
          chain.getMatrixAt(i, instance);
          transform.copy(inverse).multiply(chain.matrixWorld).multiply(instance);
          for (let j = 0; j < positions.count; j++)
            bounds.expandByPoint(vertex.fromBufferAttribute(positions, j).applyMatrix4(transform));
        }
        return bounds;
      });
      for (const arm of arms) {
        const bounds = envelope(arm, inverse), armFaces = faces(arm, inverse);
        expect(gap(bounds, envelope(tire, inverse)), `rear tyre, pitch ${pitch}, travel ${travel}`).toBeGreaterThan(0.05);
        for (const chain of chainBounds) expect(gap(bounds, chain), 'all chain plates and rollers').toBeGreaterThan(0.006);
        for (const part of mechanism) {
          if (gap(bounds, envelope(part, inverse)) > 0.003) continue;
          let minimum = Infinity;
          const partFaces = faces(part, inverse);
          for (const a of armFaces) for (const b of partFaces) {
            if (gap(a.bounds, b.bounds) > Math.min(minimum, 0.003)) continue;
            minimum = Math.min(minimum, triangleGap(a.triangle, b.triangle));
          }
          expect(minimum, `${part.name}, pitch ${pitch}, travel ${travel}`).toBeGreaterThan(0.003);
        }
      }
    }
  });

  it('leaves the original chain passage and ample tire clearance with symmetric, tapered spars', () => {
    const left = supermotoSwingarmGeometry(-1);
    const right = supermotoSwingarmGeometry(1);
    const leftBounds = left.boundingBox!;
    const rightBounds = right.boundingBox!;
    expect(leftBounds.min.x).toBeCloseTo(-rightBounds.max.x, 7);
    expect(leftBounds.max.x).toBeCloseTo(-rightBounds.min.x, 7);
    expect(
      CHAIN_DRIVE.planeX - CHAIN_DRIVE.chainHalfWidth - leftBounds.max.x,
    ).toBeGreaterThan(0.006);
    expect(
      rightBounds.min.x - SUPERMOTO_WHEELS.rear.tireWidth / 2,
    ).toBeGreaterThan(0.05);
    expect(rightBounds.max.x).toBeLessThan(0.191);
    const mesh = new Mesh(right, new MeshStandardMaterial());
    mesh.updateMatrixWorld(true);
    const widths = [0.2, 0.5, 0.66].map((z) => {
      const t =
        (z - dimensions.pivotZ) / (dimensions.axleZ - dimensions.pivotZ);
      const y = dimensions.pivotY + (dimensions.axleY - dimensions.pivotY) * t;
      const outer = through(mesh, y, z)[0].point.x;
      const inner = new Raycaster(
        new Vector3(-1, y, z),
        new Vector3(1, 0, 0),
      ).intersectObject(mesh, false)[0].point.x;
      return outer - inner;
    });
    expect(widths[0]).toBeGreaterThan(widths[1]);
    expect(widths[1]).toBeGreaterThan(widths[2]);
    expect(widths[0]).toBeLessThan(0.051);
    expect(widths[2]).toBeGreaterThan(0.037);
    left.dispose();
    right.dispose();
  });

  it('keeps the bore and axle slot coaxial with the fixed pivot and rear wheel throughout suspension travel', () => {
    const mesh = spar(1);
    const pivot = new Vector3(0, dimensions.pivotY, dimensions.pivotZ);
    const axle = new Vector3(0, dimensions.axleY, dimensions.axleZ);
    mesh.matrixAutoUpdate = false;
    for (const travel of [-0.025, 0, 0.06, 0.12]) {
      const pose = activeSuspensionPose(
        '450',
        0,
        travel,
        SUPERMOTO_CHASSIS.rearAxle,
        SUPERMOTO_CHASSIS.frontAxle,
        SUPERMOTO_CHASSIS.rearRadius,
      );
      const motion = new Matrix4()
        .makeRotationX(pose.rearAngle)
        .setPosition(pose.rearPosition);
      expect(pivot.clone().applyMatrix4(motion).distanceTo(pivot)).toBeLessThan(
        1e-10,
      );
      mesh.matrix.copy(motion);
      mesh.updateMatrixWorld(true);
      const movedAxle = axle.clone().applyMatrix4(motion);
      expect(through(mesh, pivot.y, pivot.z)).toHaveLength(0);
      expect(through(mesh, movedAxle.y, movedAxle.z)).toHaveLength(0);
      expect(movedAxle.distanceTo(pivot)).toBeCloseTo(
        axle.distanceTo(pivot),
        10,
      );
    }
    mesh.geometry.dispose();
  });
});
