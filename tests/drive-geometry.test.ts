import { expect, it } from 'vitest';
import { Vector2, Vector3 } from 'three';
import { chainRoute } from '../app/game/driveGeometry';

it('keeps both chain runs tangent, closes the loop and never cuts through either sprocket', () => {
  const front = new Vector2(0.08, 0.49),
    rear = new Vector2(0.76, 0.3119);
  const route = chainRoute(front, rear, 0.04, 0.12);
  expect(route.getPoint(0).distanceTo(route.getPoint(1))).toBeLessThan(1e-6);
  const upper = route.curves[0];
  const contact = upper.getPoint(0);
  const normal = contact.clone().sub(new Vector3(0, front.y, front.x));
  expect(Math.abs(normal.dot(upper.getTangent(0)))).toBeLessThan(1e-8);
  for (let i = 0; i < 1000; i++) {
    const p = route.getPointAt(i / 1000);
    expect(Math.hypot(p.z - front.x, p.y - front.y)).toBeGreaterThan(0.0398);
    expect(Math.hypot(p.z - rear.x, p.y - rear.y)).toBeGreaterThan(0.1198);
    expect(p.x).toBe(0);
  }
});
