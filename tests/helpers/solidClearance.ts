import { Box3, Matrix4, Mesh, Ray, Triangle, Vector3 } from 'three';

/** Actual transformed vertices, including can end caps and outlet fittings.
 * Both operands use one declared, unscaled coordinate system. A positive box
 * separation proves that every point of both complete solids is separated. */
export function envelope(part: Mesh, inverse: Matrix4) {
  const transform = inverse.clone().multiply(part.matrixWorld);
  const bounds = new Box3(), point = new Vector3();
  const positions = part.geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++)
    bounds.expandByPoint(point.fromBufferAttribute(positions, i).applyMatrix4(transform));
  return bounds;
}

export function gap(a: Box3, b: Box3) {
  return Math.hypot(
    Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x),
    Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y),
    Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z),
  );
}

export function faces(part: Mesh, inverse: Matrix4) {
  const transform = inverse.clone().multiply(part.matrixWorld);
  const positions = part.geometry.getAttribute('position'), index = part.geometry.getIndex();
  const result: { triangle: Triangle; bounds: Box3 }[] = [];
  for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
    const p = [0, 1, 2].map(k => new Vector3().fromBufferAttribute(positions, index ? index.getX(i + k) : i + k).applyMatrix4(transform));
    result.push({ triangle: new Triangle(p[0], p[1], p[2]), bounds: new Box3().setFromPoints(p) });
  }
  return result;
}

function segmentGap(a: Vector3, b: Vector3, c: Vector3, d: Vector3) {
  const u = b.clone().sub(a), v = d.clone().sub(c), w = a.clone().sub(c);
  const aa = u.lengthSq(), bb = u.dot(v), cc = v.lengthSq(), dd = u.dot(w), ee = v.dot(w);
  if (aa < 1e-20 || cc < 1e-20) return Infinity;
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const determinant = aa * cc - bb * bb;
  let s = determinant > 1e-20 ? clamp((bb * ee - cc * dd) / determinant) : 0;
  let t = (bb * s + ee) / cc;
  if (t < 0) { t = 0; s = clamp(-dd / aa); }
  else if (t > 1) { t = 1; s = clamp((bb - dd) / aa); }
  return w.addScaledVector(u, s).addScaledVector(v, -t).length();
}

/** Exact triangle separation: vertex/face and edge/edge closest pairs, plus
 * transverse edge/face intersections. This catches crossing between vertices. */
export function triangleGap(a: Triangle, b: Triangle) {
  const av = [a.a, a.b, a.c], bv = [b.a, b.b, b.c];
  let minimum = Infinity;
  for (const [source, target, triangle] of [[av, bv, b], [bv, av, a]] as const) {
    for (let i = 0; i < 3; i++) {
      minimum = Math.min(minimum, triangle.closestPointToPoint(source[i], new Vector3()).distanceTo(source[i]));
      const direction = source[(i + 1) % 3].clone().sub(source[i]);
      const length = direction.length();
      if (length > 1e-10) {
        const hit = new Ray(source[i], direction.divideScalar(length)).intersectTriangle(triangle.a, triangle.b, triangle.c, false, new Vector3());
        if (hit && hit.distanceTo(source[i]) <= length + 1e-10) return 0;
      }
      for (let j = 0; j < 3; j++)
        minimum = Math.min(minimum, segmentGap(source[i], source[(i + 1) % 3], target[j], target[(j + 1) % 3]));
    }
  }
  return minimum;
}


