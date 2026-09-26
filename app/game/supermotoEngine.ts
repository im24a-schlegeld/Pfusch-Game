import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

type Point = [number, number, number];
type JacketSection = [y: number, z: number, halfWidth: number, halfDepth: number];

/** Compact, water-cooled single. Coordinates belong to the motorcycle, not the rider. */
export function addSupermotoEngine(body: THREE.Group): void {
  const group = new THREE.Group();
  group.name = 'supermoto-engine';
  body.add(group);

  const cast = new THREE.MeshStandardMaterial({ color: '#3b4243', metalness: 0.48, roughness: 0.58 });
  const cover = new THREE.MeshStandardMaterial({ color: '#495152', metalness: 0.48, roughness: 0.47 });
  const edge = new THREE.MeshStandardMaterial({ color: '#697375', metalness: 0.66, roughness: 0.42 });
  const head = new THREE.MeshStandardMaterial({ color: '#7c8481', metalness: 0.58, roughness: 0.54 });
  const dark = new THREE.MeshStandardMaterial({ color: '#242a2b', metalness: 0.25, roughness: 0.62 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#15191a', metalness: 0.05, roughness: 0.85 });
  const bolt = new THREE.MeshStandardMaterial({ color: '#979f9e', metalness: 0.72, roughness: 0.4 });

  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, name: string) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const path = (points: Point[], radius: number, material: THREE.Material, name: string) => {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), false, 'centripetal');
    return add(new THREE.TubeGeometry(curve, 20, radius, 10, false), material, name);
  };
  const rod = (a: Point, b: Point, radius: number, material: THREE.Material, name: string, sides = 16) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const delta = end.clone().sub(start);
    const mesh = add(new THREE.CylinderGeometry(radius, radius, delta.length(), sides), material, name);
    mesh.position.copy(start.add(end).multiplyScalar(0.5));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    return mesh;
  };

  // The cast case is a rounded, asymmetric extrusion. Shape coordinates are
  // (-bike Z, bike Y), so +PI/2 below maps the tall front chamber beneath the
  // cylinder and the transmission bulge to +Z at the back of the cradle.
  const outline = new THREE.Shape();
  outline.moveTo(-0.099, 0.623);
  outline.quadraticCurveTo(-0.163, 0.606, -0.178, 0.551);
  outline.quadraticCurveTo(-0.189, 0.487, -0.164, 0.448);
  outline.quadraticCurveTo(-0.134, 0.407, -0.078, 0.399);
  outline.lineTo(0.083, 0.399);
  outline.quadraticCurveTo(0.139, 0.404, 0.159, 0.449);
  outline.quadraticCurveTo(0.181, 0.491, 0.169, 0.549);
  outline.quadraticCurveTo(0.157, 0.592, 0.124, 0.624);
  outline.quadraticCurveTo(0.098, 0.646, 0.052, 0.642);
  outline.lineTo(-0.007, 0.619);
  outline.quadraticCurveTo(-0.055, 0.606, -0.099, 0.623);
  const crankcase = new THREE.ExtrudeGeometry(outline, {
    depth: 0.231, bevelEnabled: true, bevelSegments: 3,
    bevelSize: 0.009, bevelThickness: 0.009, steps: 1, curveSegments: 5,
  });
  crankcase.translate(0, 0, -0.1155);
  crankcase.rotateY(Math.PI / 2);
  // ExtrudeGeometry splits normals at every contour segment. Weld the bare
  // cast surface before recomputing them so curved walls do not form stripes.
  crankcase.deleteAttribute('uv');
  crankcase.deleteAttribute('normal');
  const castGeometry = mergeVertices(crankcase, 1e-5);
  castGeometry.computeVertexNormals();
  crankcase.dispose();
  add(castGeometry, cast, 'engine-crankcase');

  // A turned cover has a cast flange, a raised gasket lip and a shallow dome.
  // The center is slightly inset from the lip, so it does not read as a flat disc.
  const caseCover = (side: number, center: Point, radius: number, name: string) => {
    const geometry = new THREE.LatheGeometry([
      new THREE.Vector2(0, 0),
      new THREE.Vector2(radius * 0.96, 0),
      new THREE.Vector2(radius, 0.006),
      new THREE.Vector2(radius, 0.013),
      new THREE.Vector2(radius * 0.965, 0.017),
      new THREE.Vector2(radius * 0.88, 0.017),
      new THREE.Vector2(radius * 0.86, 0.019),
      new THREE.Vector2(radius * 0.77, 0.023),
      new THREE.Vector2(radius * 0.40, 0.026),
      new THREE.Vector2(0, 0.027),
    ], 40);
    geometry.rotateZ(-side * Math.PI / 2);
    geometry.scale(1, 0.98, 1.06);
    const mesh = add(geometry, cover, name);
    mesh.position.set(...center);
    const rim = add(new THREE.TorusGeometry(radius * 0.969, 0.0022, 6, 40), edge, `${name}-rim`);
    rim.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(side, 0, 0));
    rim.scale.set(1.06, 0.98, 1);
    rim.position.set(center[0] + side * 0.014, center[1], center[2]);
    return mesh;
  };
  caseCover(1, [0.131, 0.507, -0.035], 0.099, 'engine-clutch-cover');
  caseCover(-1, [-0.128, 0.512, -0.057], 0.087, 'engine-ignition-cover');

  // A rounded rectangular water jacket, leaning forward with its cylinder.
  const jacket = (sections: JacketSection[]) => {
    const vertices: number[] = [], indices: number[] = [], sides = 32;
    for (const [y, z, rx, rz] of sections) {
      for (let side = 0; side < sides; side++) {
        const angle = side / sides * Math.PI * 2;
        const c = Math.cos(angle), s = Math.sin(angle);
        vertices.push(Math.sign(c) * Math.abs(c) ** 0.55 * rx, y, z + Math.sign(s) * Math.abs(s) ** 0.55 * rz);
      }
    }
    for (let row = 0; row < sections.length - 1; row++) {
      for (let side = 0; side < sides; side++) {
        const a = row * sides + side, b = row * sides + (side + 1) % sides;
        indices.push(a, a + sides, b, b, a + sides, b + sides);
      }
    }
    const bottom = vertices.length / 3, top = bottom + 1;
    vertices.push(0, sections[0][0], sections[0][1]);
    const end = sections[sections.length - 1];
    vertices.push(0, end[0], end[1]);
    const last = (sections.length - 1) * sides;
    for (let side = 0; side < sides; side++) {
      const next = (side + 1) % sides;
      indices.push(bottom, side, next, top, last + next, last + side);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  };
  add(jacket([
    [0.588, -0.112, 0.071, 0.063],
    [0.613, -0.127, 0.082, 0.069],
    [0.682, -0.151, 0.086, 0.077],
    [0.714, -0.163, 0.099, 0.078],
    [0.742, -0.163, 0.099, 0.079],
  ]), head, 'engine-water-jacket');
  for (const [y, z, width, depth] of [
    [0.625, -0.131, 0.086, 0.072],
    [0.699, -0.157, 0.098, 0.079],
  ]) {
    add(jacket([
      [y, z, width, depth], [y + 0.0035, z - 0.001, width, depth],
    ]), edge, 'cylinder-jacket-seam');
  }
  add(jacket([
    [0.741, -0.163, 0.103, 0.082], [0.746, -0.163, 0.103, 0.082],
  ]), rubber, 'engine-head-gasket');
  add(jacket([
    [0.746, -0.163, 0.101, 0.080],
    [0.754, -0.165, 0.107, 0.083],
    [0.776, -0.164, 0.101, 0.080],
    [0.790, -0.163, 0.083, 0.071],
  ]), dark, 'engine-valve-cover');

  const ribs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.010, 0.065, 0.012), head, 4);
  ribs.name = 'engine-jacket-cast-ribs'; ribs.castShadow = ribs.receiveShadow = true;
  const transform = new THREE.Object3D();
  for (let i = 0; i < 4; i++) {
    transform.position.set(i < 2 ? -0.084 : 0.084, 0.658, i % 2 ? -0.180 : -0.113);
    transform.rotation.set(-0.28, 0, 0); transform.updateMatrix(); ribs.setMatrixAt(i, transform.matrix);
  }
  group.add(ribs);

  caseCover(1, [0.126, 0.603, -0.132], 0.029, 'engine-water-pump');
  path([
    [0.152, 0.609, -0.141], [0.157, 0.645, -0.180],
    [0.144, 0.670, -0.246], [0.133, 0.650, -0.315],
  ], 0.0105, rubber, 'coolant-hose');
  path([
    [0, 0.715, -0.082], [0, 0.761, -0.030], [0, 0.825, 0.041],
  ], 0.031, rubber, 'engine-intake');
  rod([0.148, 0.575, 0.034], [0.159, 0.575, 0.034], 0.016, edge, 'oil-filler-neck');
  rod([0.159, 0.575, 0.034], [0.167, 0.575, 0.034], 0.0125, dark, 'oil-filler-cap', 8);

  // This port shares the precise origin of the independently built header.
  const port = new THREE.Vector3(0.046, 0.724, -0.238);
  const direction = new THREE.Vector3(0.083, -0.006, -0.025).normalize();
  const portStart = port.clone().addScaledVector(direction, -0.019);
  const portEnd = port.clone().addScaledVector(direction, 0.010);
  rod(portStart.toArray() as Point, portEnd.toArray() as Point, 0.025, head, 'engine-exhaust-port');
  const collar = add(new THREE.TorusGeometry(0.022, 0.0025, 6, 24), edge, 'engine-exhaust-port-collar');
  collar.position.copy(portEnd);
  collar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);

  // Shared instanced heads keep the small engineering details at two draws.
  const boltPoints: { position: Point; side: number }[] = [];
  for (const side of [-1, 1]) {
    const radius = side > 0 ? 0.095 : 0.083;
    const cy = side > 0 ? 0.507 : 0.512, cz = side > 0 ? -0.035 : -0.057;
    for (let i = 0; i < 6; i++) {
      const angle = i / 6 * Math.PI * 2 + 0.22;
      boltPoints.push({ position: [side > 0 ? 0.149 : -0.146, cy + Math.sin(angle) * radius * 0.98, cz + Math.cos(angle) * radius * 1.06], side });
    }
  }
  const bolts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0044, 0.0044, 0.0038, 6), bolt, boltPoints.length);
  const sockets = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0021, 0.0021, 0.0006, 6), dark, boltPoints.length);
  bolts.name = 'engine-cover-fasteners'; sockets.name = 'engine-fastener-sockets';
  for (let i = 0; i < boltPoints.length; i++) {
    const { position, side } = boltPoints[i];
    transform.position.set(...position); transform.rotation.set(0, 0, -side * Math.PI / 2); transform.updateMatrix();
    bolts.setMatrixAt(i, transform.matrix);
    transform.position.x += side * 0.0021; transform.updateMatrix(); sockets.setMatrixAt(i, transform.matrix);
  }
  bolts.castShadow = bolts.receiveShadow = sockets.receiveShadow = true;
  group.add(bolts, sockets);
}
