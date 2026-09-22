import { describe, expect, it } from 'vitest';
import { Box3, Group, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { makeTrafficVariants } from '../app/game/models';
import { animateTraffic, makeDetailedTraffic } from '../app/game/trafficModels';
import {
  TRAFFIC_KINDS,
  TRAFFIC_SHAPES,
  TOW_RAMP,
  towRampHeight,
} from '../app/game/trafficDomain';

describe('pooled traffic geometry', () => {
  it('shares geometry across colors while preserving the existing paints and wheel poses', () => {
    for (const kind of TRAFFIC_KINDS) {
      const variants = makeTrafficVariants(kind);
      const meshes = (group: Group) => {
        const result: Mesh[] = [];
        group.traverse((object) => { if (object instanceof Mesh) result.push(object); });
        return result;
      };
      const base = meshes(variants[0]);
      variants.forEach((variant, color) => {
        const expected = meshes(makeDetailedTraffic(kind, color));
        meshes(variant).forEach((mesh, i) => {
          expect(mesh.geometry).toBe(base[i].geometry);
          expect(mesh.position.toArray()).toEqual(expected[i].position.toArray());
          expect(mesh.quaternion.toArray()).toEqual(expected[i].quaternion.toArray());
          expect((mesh.material as MeshStandardMaterial).color.getHex()).toBe(
            (expected[i].material as MeshStandardMaterial).color.getHex(),
          );
        });
      });
      const entry = new Group(); entry.add(variants[1].clone(true));
      animateTraffic(entry, 6, .1);
      expect(variants.every(v => v.children.filter(o => o.name === 'traffic-wheel')
        .every(wheel => wheel.rotation.x === 0))).toBe(true);
    }
    expect(new Set(makeTrafficVariants('wet')).size).toBe(1);
  });
  it.each(TRAFFIC_KINDS)(
    'fits the shared visible/contact envelope for %s',
    (kind) => {
      const model = makeDetailedTraffic(kind, 0);
      const shadow = model.getObjectByName('traffic-contact-shadow')!;
      shadow.removeFromParent();
      model.updateMatrixWorld(true);
      const bounds = new Box3().setFromObject(model);
      const size = bounds.getSize(new Vector3());
      const shape = TRAFFIC_SHAPES[kind];
      expect(bounds.min.y).toBeCloseTo(0, 3);
      expect(size.x).toBeGreaterThan(shape.width * 0.92);
      expect(size.x).toBeLessThanOrEqual(shape.width + 0.08);
      expect(size.y).toBeGreaterThan(shape.height * 0.95);
      expect(size.y).toBeLessThanOrEqual(shape.height + 0.02);
      expect(size.z).toBeGreaterThan(shape.length * 0.98);
      expect(size.z).toBeLessThanOrEqual(shape.length + 0.08);
      const meshes: Mesh[] = [];
      model.traverse((object) => {
        if (object instanceof Mesh) meshes.push(object);
      });
      expect(meshes.length).toBeLessThanOrEqual(23);
      for (const mesh of meshes) {
        const positions = mesh.geometry.getAttribute('position');
        const normals = mesh.geometry.getAttribute('normal');
        expect([...positions.array].every(Number.isFinite)).toBe(true);
        let shortestNormal = Infinity;
        for (let i = 0; i < normals.count; i++) {
          const length = Math.hypot(
            normals.getX(i),
            normals.getY(i),
            normals.getZ(i),
          );
          shortestNormal = Math.min(shortestNormal, length);
        }
        expect(shortestNormal).toBeGreaterThan(0.95);
      }
    },
  );

  it('matches the launch ramp surface and leaves both side edges unobstructed', () => {
    const model = makeDetailedTraffic('towtruck', 0);
    model.updateMatrixWorld(true);
    for (const z of [TOW_RAMP.frontZ + 0.1, 2, 3, TOW_RAMP.rearZ - 0.03]) {
      const expected = towRampHeight(z);
      for (const x of [-0.6, 0, 0.6]) {
        const hits = new Raycaster(
          new Vector3(x, 4, z),
          new Vector3(0, -1, 0),
        ).intersectObject(model, true);
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0].point.y).toBeCloseTo(expected, 4);
      }
      for (const side of [-1, 1]) {
        const hits = new Raycaster(
          new Vector3(side * 2, expected + 0.16, z),
          new Vector3(-side, 0, 0),
          0,
          1.2,
        ).intersectObject(model, true);
        expect(hits).toHaveLength(0);
      }
    }
  });

  it('changes only pooled wheel rotations and shares cloned geometry', () => {
    const template = makeDetailedTraffic('car', 2);
    const entry = new Group();
    const clone = template.clone(true);
    entry.add(clone);
    const wheels = clone.children.filter(
      (child) => child.name === 'traffic-wheel',
    );
    expect(wheels).toHaveLength(4);
    const geometry = (wheels[0].children[0] as Mesh).geometry;
    expect(geometry).toBe(
      (
        template.children.find((child) => child.name === 'traffic-wheel')!
          .children[0] as Mesh
      ).geometry,
    );
    animateTraffic(entry, 6, 0.1);
    for (const wheel of wheels)
      expect(wheel.rotation.x).toBeCloseTo(-0.6 / 0.46);
    animateTraffic(entry, 6, 0);
    animateTraffic(entry, 0, 0.1);
    for (const wheel of wheels)
      expect(wheel.rotation.x).toBeCloseTo(-0.6 / 0.46);
    expect(clone.position.toArray()).toEqual([0, 0, 0]);
    for (const angle of (
      clone.getObjectByName('traffic-body') as Group
    ).rotation
      .toArray()
      .slice(0, 3))
      expect(angle).toBeCloseTo(0);
  });

  it('keeps the rear tires and guards below the flat tray, ahead of the descending ramp', () => {
    const model = makeDetailedTraffic('towtruck', 0);
    model.updateMatrixWorld(true);
    const deck = model.getObjectByName('traffic-bed') as Mesh;
    const trim = model.getObjectByName('traffic-trim') as Mesh;
    const rearWheels = model.children.filter(
      (child) => child.name === 'traffic-wheel' && child.position.z > 0,
    );
    expect(rearWheels).toHaveLength(2);
    for (const wheel of rearWheels) {
      const bounds = new Box3().setFromObject(wheel);
      const bottom = new Raycaster(
        new Vector3(wheel.position.x, 0.1, wheel.position.z),
        new Vector3(0, 1, 0),
      ).intersectObject(deck)[0].point.y;
      expect(bottom - bounds.max.y).toBeGreaterThan(0.08);
      expect(TOW_RAMP.frontZ - bounds.max.z).toBeGreaterThan(0.25);
      const guardBounds = bounds.clone().expandByScalar(0.08);
      const positions = trim.geometry.getAttribute('position');
      let guardTop = -Infinity,
        guardRear = -Infinity;
      for (let i = 0; i < positions.count; i++) {
        const vertex = new Vector3()
          .fromBufferAttribute(positions, i)
          .applyMatrix4(trim.matrixWorld);
        if (!guardBounds.containsPoint(vertex) || vertex.y <= bounds.max.y)
          continue;
        guardTop = Math.max(guardTop, vertex.y);
        guardRear = Math.max(guardRear, vertex.z);
      }
      expect(Number.isFinite(guardTop)).toBe(true);
      expect(bottom - guardTop).toBeGreaterThan(0.02);
      expect(TOW_RAMP.frontZ - guardRear).toBeGreaterThan(0.2);
    }
  });
});
