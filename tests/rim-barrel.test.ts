import { describe, expect, it } from 'vitest';
import {
  FrontSide,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  Vector3,
} from 'three';
import { rimBarrelGeometry } from '../app/game/wheelDetails';

describe('continuous visible rim barrel', () => {
  it.each([
    ['Roller', 0.1524, 0.0432],
    ['Supermoto', 0.226695, 0.05103],
    ['Sport', 0.2159, 0.06237],
  ] as const)(
    '%s presents alloy across the whole inside width',
    (_bike, radius, halfWidth) => {
      const material = new MeshStandardMaterial({ side: FrontSide });
      const rim = new Mesh(rimBarrelGeometry(radius, halfWidth), material);
      rim.updateMatrixWorld(true);
      const ray = new Raycaster();
      for (const across of [-0.95, -0.6, 0, 0.6, 0.95])
        for (const angle of [0.2, 1.4, 2.8, 4.3]) {
          ray.set(
            new Vector3(across * halfWidth, 0, 0),
            new Vector3(0, Math.cos(angle), Math.sin(angle)),
          );
          const hit = ray.intersectObject(rim)[0];
          // A one-sided outward-facing barrel lets this ray reach black rubber.
          expect(hit).toBeDefined();
          expect(hit.distance).toBeGreaterThan(radius - 0.02);
          expect(hit.distance).toBeLessThan(radius - 0.008);
        }
      rim.geometry.dispose();
      material.dispose();
    },
  );
});
