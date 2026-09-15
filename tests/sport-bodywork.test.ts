import { describe, expect, it } from 'vitest';
import {
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Raycaster,
  Vector3,
} from 'three';
import { makeSportBodywork } from '../app/game/sportBodywork';

const bodywork = () => {
  const body = new Group();
  makeSportBodywork(body, new MeshStandardMaterial());
  body.updateMatrixWorld(true);
  return body.getObjectByName('sport-front-assembly') as Group;
};

describe('new sculpted Sport front', () => {
  it('leaves the central intake open with a recessed duct behind its mouth', () => {
    const body = bodywork();
    const ray = new Raycaster(new Vector3(0, 0.8, -1.1), new Vector3(0, 0, 1));
    const hit = ray.intersectObjects(body.children, false)[0];
    expect(hit.object.name).toBe('sport-ram-air-duct');
    expect(hit.point.z).toBeGreaterThan(-0.8);
    expect(hit.point.z).toBeLessThan(-0.76);
  });
  it('uses recessed round projector lenses, clear of the front tire envelope', () => {
    const body = bodywork();
    for (const x of [-0.166, 0.166]) {
      const hit = new Raycaster(
        new Vector3(x, 0.797, -1.1),
        new Vector3(0, 0, 1),
      ).intersectObjects(body.children, false)[0];
      expect(hit.object.name).toBe('sport-projector-lens');
      expect(hit.point.z).toBeGreaterThan(-0.86);
    }
    body.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const p = object.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const v = new Vector3()
          .fromBufferAttribute(p, i)
          .applyMatrix4(object.matrixWorld);
        expect(Number.isFinite(v.length())).toBe(true);
        if (Math.abs(v.x) < 0.068)
          expect(Math.hypot(v.y - 0.2999, v.z + 0.72)).toBeGreaterThan(0.318);
      }
    });
  });
  it('has a translucent smoke screen with its own curved geometry', () => {
    const body = bodywork();
    const screen = body.getObjectByName('sport-smoked-windscreen') as Mesh;
    const material = screen.material as MeshPhysicalMaterial;
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeGreaterThan(0.5);
    expect(material.opacity).toBeLessThan(0.85);
    screen.geometry.computeBoundingBox();
    expect(
      screen.geometry.boundingBox!.max.y - screen.geometry.boundingBox!.min.y,
    ).toBeGreaterThan(0.17);
    expect(
      screen.geometry.boundingBox!.max.z - screen.geometry.boundingBox!.min.z,
    ).toBeGreaterThan(0.16);
    // The lower screen continues rearward with the cowl, not vertically
    // against it. Inspect the actual central surface row before edge returns.
    const points = screen.geometry.getAttribute('position');
    const root = new Vector3().fromBufferAttribute(points, 12);
    const next = new Vector3().fromBufferAttribute(points, 25 + 12);
    expect((next.z - root.z) / (next.y - root.y)).toBeGreaterThan(1.2);
  });
});
