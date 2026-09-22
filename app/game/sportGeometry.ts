import * as THREE from 'three';

// Yamaha R1 2024 factory wheelbase/tire sizes; metres before display scale.
export const SPORT_GEOMETRY = Object.freeze({
  frontAxle: -0.72,
  rearAxle: 0.685,
  rimRadius: (17 * 0.0254) / 2,
  frontRadius: (17 * 0.0254) / 2 + 0.12 * 0.7,
  rearRadius: (17 * 0.0254) / 2 + 0.19 * 0.55,
  frontWidth: 0.12,
  rearWidth: 0.19,
  forkTopY: 1.02,
  forkTopZ: -0.413,
});

/** Cast/extruded chassis beam: wide planar faces with narrow chamfer returns.
 * Stations are [centre X, centre Y, Z, half width, half height]. Keeping the
 * faces separate preserves a real box section instead of a rounded tube. */
export function sportBoxBeamGeometry(
  stations: readonly (readonly [number, number, number, number, number])[],
) {
  const centers = new THREE.CatmullRomCurve3(
    stations.map((s) => new THREE.Vector3(s[0], s[1], s[2])),
    false,
    'centripetal',
  );
  const sections = new THREE.CatmullRomCurve3(
    stations.map((s) => new THREE.Vector3(s[3], s[4], 0)),
    false,
    'centripetal',
  );
  const steps = (stations.length - 1) * 5;
  const rings = Array.from({ length: steps + 1 }, (_, i) => {
    const c = centers.getPoint(i / steps),
      size = sections.getPoint(i / steps);
    const w = size.x,
      h = size.y,
      b = Math.min(w, h) * 0.26;
    return [
      [-w + b, -h],
      [w - b, -h],
      [w, -h + b],
      [w, h - b],
      [w - b, h],
      [-w + b, h],
      [-w, h - b],
      [-w, -h + b],
    ].map(([x, y]) => new THREE.Vector3(c.x + x, c.y + y, c.z));
  });
  const vertices: number[] = [],
    indices: number[] = [];
  for (let face = 0; face < 8; face++) {
    const base = vertices.length / 3;
    for (const ring of rings)
      vertices.push(...ring[face].toArray(), ...ring[(face + 1) % 8].toArray());
    for (let i = 0; i < steps; i++) {
      const a = base + i * 2,
        b = a + 2;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  for (const end of [0, steps]) {
    const base = vertices.length / 3;
    for (const p of rings[end]) vertices.push(...p.toArray());
    for (let i = 1; i < 7; i++) {
      if (end) indices.push(base, base + i, base + i + 1);
      else indices.push(base, base + i + 1, base + i);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Folded R6-style swingarm cover: long forward wedge and a short tire lip. */
export function sportRearHuggerGeometry() {
  const vertices: number[] = [],
    indices: number[] = [];
  // z, half width, crown, shoulder, lower side edge. These broad side returns
  // descend onto the arms rather than making a separate round fender above them.
  const sections = [
    [0.34, 0.15, 0.6, 0.586, 0.571],
    [0.43, 0.15, 0.614, 0.591, 0.543],
    [0.53, 0.123, 0.64, 0.611, 0.559],
    [0.61, 0.113, 0.651, 0.631, 0.614],
    [0.685, 0.104, 0.654, 0.638, 0.632],
  ];
  const arcs = sections.length - 1,
    across = 6,
    stride = (arcs + 1) * (across + 1);
  for (let layer = 0; layer < 2; layer++)
    for (let i = 0; i <= arcs; i++) {
      const [z, width, crown, shoulder, edge] = sections[i];
      const row = [
        [-width, edge],
        [-width * 0.84, shoulder],
        [-width * 0.58, crown],
        [0, crown],
        [width * 0.58, crown],
        [width * 0.84, shoulder],
        [width, edge],
      ];
      for (let j = 0; j <= across; j++) {
        vertices.push(row[j][0], row[j][1] - (1 - layer) * 0.0035, z);
      }
    }
  for (let layer = 0; layer < 2; layer++)
    for (let i = 0; i < arcs; i++)
      for (let j = 0; j < across; j++) {
        const a = layer * stride + i * (across + 1) + j,
          b = a + across + 1;
        if (layer) indices.push(a, a + 1, b, a + 1, b + 1, b);
        else indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
  for (let i = 0; i < arcs; i++)
    for (const j of [0, across]) {
      const a = i * (across + 1) + j,
        b = a + across + 1;
      indices.push(a, a + stride, b, b, a + stride, b + stride);
    }
  for (const i of [0, arcs])
    for (let j = 0; j < across; j++) {
      const a = i * (across + 1) + j;
      indices.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride);
    }
  // Each longitudinal facet owns its edge vertices. Recomputing normals in
  // the renderer cannot round the flat deck into its downturned side panels.
  const creasedVertices: number[] = [],
    creasedIndices: number[] = [];
  const creaseMap = new Map<string, number>();
  const skinTriangles = 2 * arcs * across * 2;
  for (let i = 0; i < indices.length; i++) {
    const triangle = Math.floor(i / 3);
    const facet =
      triangle < skinTriangles
        ? Math.floor(triangle / (arcs * across * 2)) * across +
          (Math.floor(triangle / 2) % across)
        : triangle + across * 2;
    const source = indices[i],
      key = `${facet}:${source}`;
    let target = creaseMap.get(key);
    if (target === undefined) {
      target = creasedVertices.length / 3;
      creasedVertices.push(...vertices.slice(source * 3, source * 3 + 3));
      creaseMap.set(key, target);
    }
    creasedIndices.push(target);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(creasedVertices, 3),
  );
  geometry.setIndex(creasedIndices);
  geometry.computeVertexNormals();
  return geometry;
}

/** A road tire has a broad crown and thin sidewalls around a full-size rim.
 * A circular torus incorrectly makes wider rear tires radially thicker too. */
export function sportTireGeometry(rear: boolean) {
  const radius = rear ? SPORT_GEOMETRY.rearRadius : SPORT_GEOMETRY.frontRadius;
  return roadTireGeometry(
    radius,
    rear ? SPORT_GEOMETRY.rearWidth : SPORT_GEOMETRY.frontWidth,
  );
}

export function roadTireGeometry(
  radius: number,
  width: number,
  beadRadius = SPORT_GEOMETRY.rimRadius,
) {
  const half = width / 2;
  const bead = beadRadius;
  const profile = new THREE.SplineCurve([
    new THREE.Vector2(bead - 0.003, -half * 0.68),
    new THREE.Vector2(bead + 0.012, -half * 0.93),
    new THREE.Vector2(radius - 0.045, -half),
    new THREE.Vector2(radius - 0.017, -half * 0.82),
    new THREE.Vector2(radius - 0.004, -half * 0.43),
    new THREE.Vector2(radius, 0),
    new THREE.Vector2(radius - 0.004, half * 0.43),
    new THREE.Vector2(radius - 0.017, half * 0.82),
    new THREE.Vector2(radius - 0.045, half),
    new THREE.Vector2(bead + 0.012, half * 0.93),
    new THREE.Vector2(bead - 0.003, half * 0.68),
  ]);
  const points = profile.getPoints(40);
  points.push(points[0].clone());
  const geometry = new THREE.LatheGeometry(points, 80);
  geometry.rotateZ(Math.PI / 2);
  return geometry;
}
