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
