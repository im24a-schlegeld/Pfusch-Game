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
import { SPORT_LENS_FACES } from '../app/game/sportDesign';

const bodywork = () => {
  const body = new Group();
  makeSportBodywork(body, new MeshStandardMaterial());
  body.updateMatrixWorld(true);
  return body.getObjectByName('sport-front-assembly') as Group;
};

describe('600 cc Sport fairing and optics', () => {
  it('leaves the central intake open with a recessed duct behind its mouth', () => {
    const body = bodywork();
    const ray = new Raycaster(
      new Vector3(0, 0.748, -1.1),
      new Vector3(0, 0, 1),
    );
    const hit = ray.intersectObjects(body.children, false)[0];
    expect(hit.object.name).toBe('sport-intake-throat');
    expect(hit.point.z).toBeGreaterThan(-0.79);
    expect(hit.point.z).toBeLessThan(-0.73);
  });
  it('keeps both glazed headlight faces and all bodywork outside the front tire envelope', () => {
    const body = bodywork();
    for (const [x, y, z] of SPORT_LENS_FACES) {
      const hit = new Raycaster(
        new Vector3(x, y, -1.1),
        new Vector3(0, 0, 1),
      ).intersectObjects(body.children, false)[0];
      expect(hit.object.name).toBe('sport-projector-lens');
      expect(hit.point.z).toBeCloseTo(z, 5);
    }
    let finite = true;
    let minimumTireClearance = Infinity;
    const vertex = new Vector3();
    body.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const p = object.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const v = vertex
          .fromBufferAttribute(p, i)
          .applyMatrix4(object.matrixWorld);
        finite &&= Number.isFinite(v.lengthSq());
        if (Math.abs(v.x) < 0.068)
          minimumTireClearance = Math.min(
            minimumTireClearance,
            Math.hypot(v.y - 0.2999, v.z + 0.72),
          );
      }
    });
    expect(finite).toBe(true);
    expect(minimumTireClearance).toBeGreaterThan(0.318);
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
    ).toBeGreaterThan(0.15);
    expect(
      screen.geometry.boundingBox!.max.z - screen.geometry.boundingBox!.min.z,
    ).toBeGreaterThan(0.16);
    // The lower screen continues rearward with the cowl, not vertically
    // against it. Inspect the actual central surface row before edge returns.
    const points = screen.geometry.getAttribute('position');
    const root = new Vector3().fromBufferAttribute(points, 14);
    const next = new Vector3().fromBufferAttribute(points, 29 + 14);
    expect((next.z - root.z) / (next.y - root.y)).toBeGreaterThan(1.2);
  });
});
