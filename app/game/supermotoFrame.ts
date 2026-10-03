import {
  CurvePath,
  CubicBezierCurve3,
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

/** Wide sump rails merge into the down tube with one continuous rounded
 * front sweep, following the drawn profile without a square outer corner. */
export const SUPERMOTO_LOWER_FRAME = Object.freeze({
  radius: 0.017,
  cornerTrim: 0.026,
  points: [
    SUPERMOTO_PIVOT_FRAME_JOINT,
    // The bearing throat stays ahead of the moving lower chain return.
    [0.121, 0.436, 0.16],
    [0.139, 0.39, 0.12],
    [0.139, 0.39, 0.084],
    [0.134, 0.39, -0.070],
  ] as readonly Point[],
  frontBend: [
    [0.134, 0.390, -0.225],
    [0.070, 0.510, -0.255],
    [0, 0.650, -0.290],
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
  const bend = SUPERMOTO_LOWER_FRAME.frontBend.map(([x, y, z]) => new Vector3(side * x, y, z));
  path.add(new CubicBezierCurve3(points[points.length - 1], bend[0], bend[1], bend[2]));
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
        .multiplyScalar(radius / SUPERMOTO_LOWER_FRAME.radius);
      // The concealed bearing throat is pressed oval between the case,
      // moving swingarm and chain return; retain the full visible sump tubes.
      const throat = MathUtils.smoothstep(center.y, 0.402, 0.418)
        * (1 - MathUtils.smoothstep(center.y, 0.480, 0.496))
        * MathUtils.smoothstep(center.z, 0.08, 0.11);
      point.x *= 1 - 0.78 * throat;
      point.add(center);
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
          // A pressed, guarded spar sweeps behind the case. Its visible side
          // is broad in the load plane while the inboard/outboard faces stay
          // slim enough for the engine, pipe and fixed chain corridor.
          const shoulder = MathUtils.smoothstep(center.y, 0.57, 0.65)
            * (1 - MathUtils.smoothstep(center.y, 0.81, 0.875));
          point.x *= 1 - 0.38 * shoulder;
          point.y *= 1 + 0.45 * shoulder;
          point.z *= 1 + 0.45 * shoulder;
          // The welded bearing throat has a pressed oval section between the
          // chain and swinging arm. Preserve its side-view depth while making
          // room laterally; the exposed frame above retains its full diameter.
          const throat = MathUtils.smoothstep(center.y, 0.499, 0.516) *
            (1 - MathUtils.smoothstep(center.y, 0.56, 0.59));
          point.x *= 1 - 0.55 * throat;
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
        [side * 0.137, 0.820, -0.030],
        [side * 0.143, 0.744, 0.095],
        [side * 0.132, 0.610, 0.190],
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
    // The shaped rear pivot/peg carrier meets the bowed spar above and the
    // original cradle below. Its narrow X section remains inside the moving
    // swingarm and outside the exposed chain, rather than covering either.
    const carrier = new Shape();
    carrier.moveTo(-0.145, 0.586);
    carrier.quadraticCurveTo(-0.177, 0.613, -0.204, 0.596);
    carrier.quadraticCurveTo(-0.218, 0.576, -0.211, 0.541);
    carrier.lineTo(-0.192, 0.467);
    carrier.quadraticCurveTo(-0.189, 0.445, -0.175, 0.423);
    carrier.lineTo(-0.146, 0.410);
    carrier.lineTo(-0.122, 0.425);
    carrier.quadraticCurveTo(-0.115, 0.438, -0.129, 0.465);
    carrier.quadraticCurveTo(-0.144, 0.492, -0.131, 0.516);
    carrier.quadraticCurveTo(-0.120, 0.549, -0.145, 0.586);
    carrier.closePath();
    const relief = new Path();
    relief.absellipse(-0.179, 0.562, 0.010, 0.021, 0, Math.PI * 2, true);
    carrier.holes.push(relief);
    const carrierGeometry = new ExtrudeGeometry(carrier, {
      depth: 0.004, bevelEnabled: true, bevelThickness: 0.0005,
      bevelSize: 0.0012, bevelSegments: 1, steps: 1, curveSegments: 10,
    });
    carrierGeometry.rotateY(Math.PI / 2);
    carrierGeometry.translate(side * 0.133 - 0.002, 0, 0);
    add(carrierGeometry, 'supermoto-frame-pivot-carrier');
    for (const [y, z] of [[0.586, 0.182], [0.454, 0.162], [0.433, 0.146]])
      rod([side * 0.1325, y, z], [side * 0.136, y, z], 0.0053, 'supermoto-frame-carrier-fastener');
    add(supermotoLowerFrameGeometry(side), 'supermoto-frame-merge-branch');
    rod(
      [side * 0.118, 0.855, -0.15],
      [side * 0.085, 0.918, 0.12],
      0.017,
      'supermoto-under-seat-frame-rail',
    );
    rod(
      [side * 0.143, 0.744, 0.095],
      [side * MathUtils.lerp(0.085, 0.06154, 0.200 / 0.610),
        MathUtils.lerp(0.918, 0.97806, 0.200 / 0.610), 0.320],
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
    [[0, 0.650, -0.290], [0, 0.74, -0.340], [0, 0.84, -0.370], lowerNeck],
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
