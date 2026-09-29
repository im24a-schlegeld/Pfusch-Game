import {
  CurvePath,
  CatmullRomCurve3,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  LineCurve3,
  Material,
  MathUtils,
  Mesh,
  Path,
  QuadraticBezierCurve3,
  Shape,
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
  radius: 0.017,
  cornerTrim: 0.026,
  points: [
    SUPERMOTO_PIVOT_FRAME_JOINT,
    [0.121, 0.436, 0.18],
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
  // A real cradle tube, with only the concealed bearing throat relieved for
  // the swingarm. The front ends flare into the single steering down tube.
  const positions = geometry.getAttribute('position');
  const point = new Vector3();
  const length = path.getLength();
  for (let ring = 0; ring <= 64; ring++) {
    const fraction = ring / 64;
    const center = path.getPointAt(fraction);
    const bearingRadius = MathUtils.lerp(
      SUPERMOTO_PIVOT_FRAME_RADIUS,
      SUPERMOTO_LOWER_FRAME.radius,
      MathUtils.smoothstep(fraction * length, 0.025, 0.11),
    );
    const radius = MathUtils.lerp(
      bearingRadius,
      0.021,
      MathUtils.smoothstep(fraction, 0.78, 1),
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

/** The welded main frame follows the photographed double-cradle load path:
 * a pressed steering neck, two upper spars and one front down tube which
 * divides beneath the cylinder. Fork, engine, shock and pivot datums stay put. */
export function addSupermotoMainFrame(
  body: Group,
  material: Material,
  upperNeck: Point,
  lowerNeck: Point,
) {
  const add = (
    geometry: TubeGeometry | ExtrudeGeometry | CylinderGeometry,
    name: string,
  ) => {
    const part = new Mesh(geometry, material);
    part.name = name;
    part.castShadow = part.receiveShadow = true;
    body.add(part);
    return part;
  };
  const pipe = (
    points: readonly Point[],
    radius: number,
    name: string,
    bearingThroat = false,
  ) => {
    const path = new CatmullRomCurve3(
      points.map((point) => new Vector3(...point)),
      false,
      'centripetal',
    );
    const geometry = new TubeGeometry(path, 48, radius, 14, false);
    if (bearingThroat) {
      const positions = geometry.getAttribute('position'),
        point = new Vector3();
      for (let ring = 0; ring <= 48; ring++) {
        const center = path.getPointAt(ring / 48);
        const localRadius = MathUtils.lerp(
          SUPERMOTO_PIVOT_FRAME_RADIUS,
          radius,
          MathUtils.smoothstep(center.y, 0.52, 0.68),
        );
        for (let around = 0; around <= 14; around++) {
          const index = ring * 15 + around;
          point
            .fromBufferAttribute(positions, index)
            .sub(center)
            .multiplyScalar(localRadius / radius);
          // The welded bearing throat has a pressed oval section between the
          // chain and swinging arm. Preserve its side-view depth while making
          // room laterally; the exposed frame above retains its full diameter.
          const throat = MathUtils.smoothstep(center.y, 0.499, 0.516) *
            (1 - MathUtils.smoothstep(center.y, 0.56, 0.59));
          point.x *= 1 - 0.35 * throat;
          point.add(center);
          positions.setXYZ(index, point.x, point.y, point.z);
        }
      }
      positions.needsUpdate = true;
      geometry.computeVertexNormals();
    }
    return add(geometry, name);
  };
  const rod = (from: Point, to: Point, radius: number, name: string) => {
    const a = new Vector3(...from),
      b = new Vector3(...to),
      axis = b.clone().sub(a);
    const part = add(
      new CylinderGeometry(radius, radius, axis.length(), 14),
      name,
    );
    part.position.copy(a.add(b).multiplyScalar(0.5));
    part.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), axis.normalize());
    return part;
  };
  for (const side of [-1, 1]) {
    pipe(
      [
        [side * 0.018, upperNeck[1], upperNeck[2]],
        [side * 0.094, 0.98, -0.32],
        [side * 0.118, 0.855, -0.15],
        [side * 0.137, 0.69, 0.035],
        [side * 0.132, 0.596, 0.142],
        [side * 0.132, 0.543, 0.172],
        [
          side * SUPERMOTO_PIVOT_FRAME_JOINT[0],
          SUPERMOTO_PIVOT_FRAME_JOINT[1],
          SUPERMOTO_PIVOT_FRAME_JOINT[2],
        ],
      ],
      0.022,
      'supermoto-frame-main-spar',
      true,
    );
    add(supermotoLowerFrameGeometry(side), 'supermoto-frame-merge-branch');
    rod(
      [side * 0.118, 0.855, -0.15],
      [side * 0.085, 0.918, 0.12],
      0.017,
      'supermoto-under-seat-frame-rail',
    );
    rod(
      [side * 0.108, 0.885, 0.09],
      [side * 0.085, 0.918, 0.12],
      0.016,
      'supermoto-shock-bridge-support',
    );

    // A formed pair of thin load-bearing neck plates. Their taper in width
    // seats them on both the wider steering head and the single down tube.
    const outline: readonly [number, number][] = [
      [upperNeck[2] - 0.015, 1.001],
      [upperNeck[2] + 0.037, 0.985],
      [-0.255, 0.927],
      [-0.226, 0.899],
      [-0.32, 0.864],
      [-0.356, 0.784],
      [-0.385, 0.768],
      [-0.414, 0.908],
    ];
    const plate = new Shape();
    outline.forEach(([z, y], index) =>
      index ? plate.lineTo(-z, y) : plate.moveTo(-z, y),
    );
    plate.closePath();
    const opening = new Path();
    opening.absellipse(0.329, 0.92, 0.014, 0.019, 0, Math.PI * 2, true);
    plate.holes.push(opening);
    const geometry = new ExtrudeGeometry(plate, {
      depth: 0.006,
      bevelEnabled: true,
      bevelThickness: 0.001,
      bevelSize: 0.0015,
      bevelSegments: 1,
      steps: 1,
      curveSegments: 16,
    });
    geometry.rotateY(Math.PI / 2);
    const positions = geometry.getAttribute('position');
    for (let index = 0; index < positions.count; index++) {
      const centerX = MathUtils.lerp(
        0.014,
        0.031,
        MathUtils.smoothstep(positions.getY(index), 0.77, 0.96),
      );
      positions.setX(index, side * centerX + positions.getX(index) - 0.003);
    }
    geometry.computeVertexNormals();
    add(geometry, 'supermoto-steering-neck-gusset');
  }
  pipe(
    [[0, 0.625, -0.35], [0, 0.72, -0.365], [0, 0.84, -0.39], lowerNeck],
    0.022,
    'supermoto-frame-central-up-tube',
  );
  rod(
    [-0.132, 0.409, 0.151],
    [0.132, 0.409, 0.151],
    0.012,
    'supermoto-cradle-crossmember',
  );
}
