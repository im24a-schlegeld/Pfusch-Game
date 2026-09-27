import * as THREE from 'three';

type Point = [number, number, number];
type SidePoint = [z: number, y: number];
type CaseStation = [x: number, outlineScale: number];
type JacketSection = [
  y: number,
  z: number,
  halfWidth: number,
  halfDepth: number,
];

/** A cast volume with individually shaped transverse sections. Side coordinates
 * are z/y; the full outline is retained while the shoulders recede in depth. */
function casting(
  profile: THREE.Shape,
  center: SidePoint,
  stations: CaseStation[],
  rearRelief = false,
) {
  const outline = profile.getSpacedPoints(64).slice(0, -1),
    n = outline.length;
  const vertices: number[] = [],
    indices: number[] = [];
  const at = (x: number, scale: number, p: THREE.Vector2) => {
    const z = center[0] + (p.x - center[0]) * scale;
    const y = center[1] + (p.y - center[1]) * scale;
    // The output sprocket runs outside the left gearbox wall. Shape that
    // casting inward locally rather than making the complete engine thinner.
    const relief =
      rearRelief && x < 0
        ? 0.019 * THREE.MathUtils.smoothstep(z, -0.018, 0.075)
        : 0;
    return [x + relief, y, z] as const;
  };
  for (const [x, scale] of stations)
    for (const p of outline) vertices.push(...at(x, scale, p));
  for (let row = 0; row < stations.length - 1; row++)
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n,
        a = row * n + i,
        b = row * n + j;
      indices.push(a, b, a + n, b, b + n, a + n);
    }
  const capNormals: { index: number; sign: number; relief: boolean }[] = [];
  const axis = Math.sign(stations[stations.length - 1][0] - stations[0][0]);
  for (const first of [true, false]) {
    const station = first ? 0 : stations.length - 1,
      [x, scale] = stations[station];
    const sign = first ? -axis : axis,
      outer = station * n;
    let previous = outer;
    // Concentric cap rings sample the left gearcase recess as actual geometry.
    // They also avoid long, uneven ear-clipped diagonals across the cover face.
    for (let i = 0; i < n; i++)
      capNormals.push({ index: outer + i, sign, relief: rearRelief && x < 0 });
    for (const inset of [0.75, 0.5, 0.25]) {
      const next = vertices.length / 3;
      for (const p of outline) vertices.push(...at(x, scale * inset, p));
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n,
          a = previous + i,
          b = previous + j,
          c = next + i,
          d = next + j;
        if (first) indices.push(a, c, b, b, c, d);
        else indices.push(a, b, c, b, d, c);
        capNormals.push({ index: next + i, sign, relief: rearRelief && x < 0 });
      }
      previous = next;
    }
    const middle = vertices.length / 3;
    vertices.push(...at(x, 0, outline[0]));
    capNormals.push({ index: middle, sign, relief: rearRelief && x < 0 });
    for (let i = 0; i < n; i++) {
      const a = previous + i,
        b = previous + ((i + 1) % n);
      if (first) indices.push(a, middle, b);
      else indices.push(a, b, middle);
    }
  }
  // Both reflected covers and the core use consistent outward faces.
  let volume = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3,
      b = indices[i + 1] * 3,
      c = indices[i + 2] * 3;
    volume +=
      vertices[a] *
        (vertices[b + 1] * vertices[c + 2] -
          vertices[b + 2] * vertices[c + 1]) +
      vertices[a + 1] *
        (vertices[b + 2] * vertices[c] - vertices[b] * vertices[c + 2]) +
      vertices[a + 2] *
        (vertices[b] * vertices[c + 1] - vertices[b + 1] * vertices[c]);
  }
  if (volume < 0)
    for (let i = 0; i < indices.length; i += 3)
      [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal');
  for (const { index, sign, relief } of capNormals) {
    const z = vertices[index * 3 + 2];
    const t = THREE.MathUtils.clamp((z + 0.018) / 0.093, 0, 1);
    const slope = relief ? (0.019 * 6 * t * (1 - t)) / 0.093 : 0;
    // Cap normals follow its planar face or the defined gearcase relief.
    // Triangle area/valence must not imprint a radial star into a flat casting.
    const normal = new THREE.Vector3(sign, 0, -sign * slope).normalize();
    normals.setXYZ(index, normal.x, normal.y, normal.z);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Rounded water-casting sections, with actual changes of width/depth at the
 * cylinder foot, head gasket and cam cover rather than stacked coloured boxes. */
function jacket(sections: JacketSection[]) {
  const vertices: number[] = [],
    indices: number[] = [],
    sides = 32;
  for (const [y, z, rx, rz] of sections)
    for (let side = 0; side < sides; side++) {
      const angle = (side / sides) * Math.PI * 2,
        c = Math.cos(angle),
        s = Math.sin(angle);
      vertices.push(
        Math.sign(c) * Math.abs(c) ** 0.65 * rx,
        y,
        z + Math.sign(s) * Math.abs(s) ** 0.65 * rz,
      );
    }
  for (let row = 0; row < sections.length - 1; row++)
    for (let side = 0; side < sides; side++) {
      const a = row * sides + side,
        b = row * sides + ((side + 1) % sides);
      indices.push(a, a + sides, b, b, a + sides, b + sides);
    }
  const bottom = vertices.length / 3,
    top = bottom + 1,
    end = sections[sections.length - 1];
  vertices.push(0, sections[0][0], sections[0][1], 0, end[0], end[1]);
  const last = (sections.length - 1) * sides;
  for (let side = 0; side < sides; side++) {
    const next = (side + 1) % sides;
    indices.push(bottom, side, next, top, last + next, last + side);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Compact water-cooled single. All contact positions remain in bike space. */
export function addSupermotoEngine(body: THREE.Group): void {
  const group = new THREE.Group();
  group.name = 'supermoto-engine';
  body.add(group);

  const cast = new THREE.MeshStandardMaterial({
    color: '#505754',
    metalness: 0.4,
    roughness: 0.62,
  });
  const cover = new THREE.MeshStandardMaterial({
    color: '#626966',
    metalness: 0.44,
    roughness: 0.49,
  });
  const cylinder = new THREE.MeshStandardMaterial({
    color: '#6b7370',
    metalness: 0.42,
    roughness: 0.59,
  });
  const head = new THREE.MeshStandardMaterial({
    color: '#828986',
    metalness: 0.46,
    roughness: 0.51,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: '#363d3a',
    metalness: 0.28,
    roughness: 0.58,
  });
  const rubber = new THREE.MeshStandardMaterial({
    color: '#15191a',
    metalness: 0.04,
    roughness: 0.86,
  });

  const add = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    name: string,
  ) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const path = (
    points: Point[],
    radius: number,
    material: THREE.Material,
    name: string,
  ) => {
    const curve = new THREE.CatmullRomCurve3(
      points.map((p) => new THREE.Vector3(...p)),
      false,
      'centripetal',
    );
    return add(
      new THREE.TubeGeometry(curve, 20, radius, 10, false),
      material,
      name,
    );
  };
  const rod = (
    a: Point,
    b: Point,
    radius: number,
    material: THREE.Material,
    name: string,
    sides = 16,
  ) => {
    const start = new THREE.Vector3(...a),
      end = new THREE.Vector3(...b),
      delta = end.clone().sub(start);
    const mesh = add(
      new THREE.CylinderGeometry(radius, radius, delta.length(), sides),
      material,
      name,
    );
    mesh.position.copy(start.add(end).multiplyScalar(0.5));
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      delta.normalize(),
    );
    return mesh;
  };

  // The rounded crank chamber narrows into the gearbox, with a shallow sump
  // and a distinct shoulder below the forward-leaning cylinder.
  const core = new THREE.Shape();
  core.moveTo(-0.113, 0.631);
  core.quadraticCurveTo(-0.164, 0.621, -0.174, 0.553);
  core.quadraticCurveTo(-0.178, 0.472, -0.137, 0.425);
  core.quadraticCurveTo(-0.112, 0.398, -0.05, 0.398);
  core.quadraticCurveTo(0.063, 0.398, 0.111, 0.415);
  core.quadraticCurveTo(0.157, 0.43, 0.165, 0.486);
  core.quadraticCurveTo(0.173, 0.55, 0.126, 0.584);
  core.quadraticCurveTo(0.105, 0.602, 0.027, 0.605);
  core.quadraticCurveTo(-0.005, 0.605, -0.024, 0.627);
  core.quadraticCurveTo(-0.06, 0.64, -0.113, 0.631);
  add(
    casting(
      core,
      [-0.003, 0.519],
      [
        [-0.111, 0.88],
        [-0.109, 0.965],
        [-0.084, 1],
        [0.07, 1],
        [0.106, 0.965],
        [0.112, 0.88],
      ],
      true,
    ),
    cast,
    'engine-crankcase',
  );

  // Separate asymmetric side castings. The broad gasket shoulder rolls into
  // a smaller raised face, so depth reads from both side and three-quarter views.
  const clutch = new THREE.Shape();
  clutch.moveTo(-0.039, 0.588);
  clutch.quadraticCurveTo(-0.084, 0.579, -0.09, 0.531);
  clutch.quadraticCurveTo(-0.092, 0.469, -0.051, 0.44);
  clutch.quadraticCurveTo(-0.021, 0.42, 0.045, 0.435);
  clutch.quadraticCurveTo(0.111, 0.444, 0.128, 0.49);
  clutch.quadraticCurveTo(0.144, 0.533, 0.106, 0.57);
  clutch.quadraticCurveTo(0.087, 0.592, 0.026, 0.597);
  clutch.quadraticCurveTo(-0.011, 0.6, -0.039, 0.588);
  add(
    casting(
      clutch,
      [0.022, 0.516],
      [
        [0.104, 1.005],
        [0.11, 1.005],
      ],
    ),
    rubber,
    'engine-clutch-gasket',
  );
  add(
    casting(
      clutch,
      [0.022, 0.516],
      [
        [0.101, 0.92],
        [0.109, 1],
        [0.116, 1],
        [0.125, 0.993],
        [0.133, 0.973],
        [0.14, 0.941],
        [0.146, 0.9],
        [0.15, 0.852],
        [0.152, 0.8],
      ],
    ),
    cover,
    'engine-clutch-cover',
  );

  const ignition = new THREE.Shape();
  ignition.moveTo(-0.108, 0.599);
  ignition.quadraticCurveTo(-0.151, 0.583, -0.158, 0.535);
  ignition.quadraticCurveTo(-0.163, 0.481, -0.124, 0.454);
  ignition.quadraticCurveTo(-0.093, 0.431, -0.048, 0.45);
  ignition.quadraticCurveTo(-0.011, 0.465, 0.002, 0.514);
  ignition.quadraticCurveTo(0.007, 0.55, -0.034, 0.579);
  ignition.quadraticCurveTo(-0.069, 0.607, -0.108, 0.599);
  add(
    casting(
      ignition,
      [-0.081, 0.522],
      [
        [-0.109, 1.005],
        [-0.113, 1.005],
      ],
    ),
    rubber,
    'engine-ignition-gasket',
  );
  add(
    casting(
      ignition,
      [-0.081, 0.522],
      [
        [-0.106, 0.91],
        [-0.112, 1],
        [-0.118, 1],
        [-0.125, 0.993],
        [-0.131, 0.973],
        [-0.136, 0.941],
        [-0.14, 0.9],
        [-0.142, 0.852],
        [-0.143, 0.8],
      ],
    ),
    cover,
    'engine-ignition-cover',
  );
  rod(
    [-0.091, 0.49, 0.08],
    [-0.113, 0.49, 0.08],
    0.024,
    dark,
    'engine-output-shaft',
  );

  add(
    jacket([
      [0.595, -0.111, 0.068, 0.061],
      [0.605, -0.117, 0.084, 0.073],
      [0.613, -0.122, 0.083, 0.072],
      [0.619, -0.124, 0.073, 0.065],
      [0.686, -0.148, 0.078, 0.067],
      [0.697, -0.152, 0.086, 0.073],
    ]),
    cylinder,
    'engine-water-jacket',
  );
  add(
    jacket([
      [0.696, -0.152, 0.088, 0.075],
      [0.701, -0.153, 0.089, 0.076],
    ]),
    dark,
    'engine-head-gasket',
  );
  add(
    jacket([
      [0.7, -0.153, 0.089, 0.076],
      [0.708, -0.156, 0.102, 0.084],
      [0.739, -0.163, 0.103, 0.085],
      [0.749, -0.164, 0.098, 0.08],
      [0.755, -0.164, 0.095, 0.078],
    ]),
    head,
    'engine-cylinder-head',
  );
  add(
    jacket([
      [0.754, -0.164, 0.099, 0.081],
      [0.758, -0.164, 0.099, 0.081],
    ]),
    rubber,
    'engine-valve-gasket',
  );
  add(
    jacket([
      [0.757, -0.164, 0.099, 0.081],
      [0.764, -0.165, 0.101, 0.081],
      [0.784, -0.164, 0.091, 0.074],
      [0.79, -0.163, 0.076, 0.063],
    ]),
    dark,
    'engine-valve-cover',
  );

  const pump = new THREE.Shape();
  pump.absellipse(-0.132, 0.603, 0.03, 0.025, 0, Math.PI * 2, false, -0.2);
  add(
    casting(
      pump,
      [-0.132, 0.603],
      [
        [0.099, 0.87],
        [0.118, 1],
        [0.136, 0.96],
        [0.144, 0.86],
        [0.148, 0.76],
      ],
    ),
    cover,
    'engine-water-pump',
  );
  path(
    [
      [0.152, 0.609, -0.141],
      [0.157, 0.645, -0.18],
      [0.144, 0.67, -0.246],
      [0.133, 0.65, -0.315],
    ],
    0.0105,
    rubber,
    'coolant-hose',
  );
  path(
    [
      [0, 0.715, -0.082],
      [0, 0.761, -0.03],
      [0, 0.825, 0.041],
    ],
    0.031,
    rubber,
    'engine-intake',
  );
  rod(
    [0.112, 0.569, 0.078],
    [0.139, 0.572, 0.078],
    0.015,
    cover,
    'oil-filler-neck',
  );
  rod(
    [0.138, 0.572, 0.078],
    [0.147, 0.573, 0.078],
    0.0125,
    dark,
    'oil-filler-cap',
    8,
  );

  // Preserve the independently authored header's exact seated port.
  const port = new THREE.Vector3(0.046, 0.724, -0.238);
  const direction = new THREE.Vector3(0.083, -0.006, -0.025).normalize();
  const portStart = port.clone().addScaledVector(direction, -0.019);
  const portEnd = port.clone().addScaledVector(direction, 0.01);
  rod(
    portStart.toArray() as Point,
    portEnd.toArray() as Point,
    0.025,
    head,
    'engine-exhaust-port',
  );
  const collar = add(
    new THREE.TorusGeometry(0.022, 0.0025, 6, 24),
    head,
    'engine-exhaust-port-collar',
  );
  collar.position.copy(portEnd);
  collar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
}
