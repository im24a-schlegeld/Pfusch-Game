import {
  CurvePath,
  LineCurve3,
  MathUtils,
  QuadraticBezierCurve3,
  TubeGeometry,
  Vector3,
} from 'three';

type Point = readonly [number, number, number];

/** Compact inboard weld behind the gearcase. It seats on the rear of the
 * existing pivot sleeve, clear of the rotating swingarm's inner face. */
export const SUPERMOTO_PIVOT_FRAME_JOINT = [0.124, 0.496, 0.141] as const;
export const SUPERMOTO_PIVOT_FRAME_RADIUS = 0.0105;

/** Actual cradle centerline in bike coordinates. Small pipe bends hug the
 * sump instead of a free Catmull-Rom curve sagging between distant stations. */
export const SUPERMOTO_LOWER_FRAME = Object.freeze({
  radius: 0.013,
  cornerTrim: 0.018,
  points: [
    SUPERMOTO_PIVOT_FRAME_JOINT,
    [0.124, 0.438, 0.18],
    [0.139, 0.39, 0.12],
    [0.139, 0.39, 0.084],
    [0.134, 0.39, -0.126],
    [0.115, 0.415, -0.208],
    [0.087, 0.486, -0.228],
    [0.043, 0.578, -0.3],
    [0, 0.625, -0.35],
  ] as readonly Point[],
});

export function supermotoLowerFramePath(side: number) {
  if (side !== -1 && side !== 1) throw new Error('Frame side must be -1 or 1');
  const points = SUPERMOTO_LOWER_FRAME.points.map(
    ([x, y, z]) => new Vector3(side * x, y, z),
  );
  const path = new CurvePath<Vector3>();
  let previous = points[0];
  for (let index = 1; index < points.length - 1; index++) {
    const corner = points[index];
    const incoming = points[index - 1].clone().sub(corner);
    const outgoing = points[index + 1].clone().sub(corner);
    const trim = Math.min(
      SUPERMOTO_LOWER_FRAME.cornerTrim,
      incoming.length() * 0.25,
      outgoing.length() * 0.25,
    );
    const entry = corner.clone().addScaledVector(incoming.normalize(), trim);
    const exit = corner.clone().addScaledVector(outgoing.normalize(), trim);
    path.add(new LineCurve3(previous, entry));
    path.add(new QuadraticBezierCurve3(entry, corner, exit));
    previous = exit;
  }
  path.add(new LineCurve3(previous, points[points.length - 1]));
  return path;
}

export function supermotoLowerFrameGeometry(side: number) {
  const path = supermotoLowerFramePath(side);
  const geometry = new TubeGeometry(
    path,
    64,
    SUPERMOTO_LOWER_FRAME.radius,
    12,
    false,
  );
  // Only the short bearing neck is narrower. The sump rails retain their
  // existing section, and the weld has the same diameter as the other branches.
  const positions = geometry.getAttribute('position');
  const point = new Vector3();
  const length = path.getLength();
  for (let ring = 0; ring <= 64; ring++) {
    const fraction = ring / 64;
    const center = path.getPointAt(fraction);
    const radius = MathUtils.lerp(
      SUPERMOTO_PIVOT_FRAME_RADIUS,
      SUPERMOTO_LOWER_FRAME.radius,
      MathUtils.smoothstep(fraction * length, 0, 0.07),
    );
    for (let around = 0; around <= 12; around++) {
      const index = ring * 13 + around;
      point
        .fromBufferAttribute(positions, index)
        .sub(center)
        .multiplyScalar(radius / SUPERMOTO_LOWER_FRAME.radius)
        .add(center);
      positions.setXYZ(index, point.x, point.y, point.z);
    }
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
