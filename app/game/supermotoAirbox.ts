import * as THREE from 'three';
import { SUPERMOTO_SHOCK_TOP, SUPERMOTO_SHOCK_BOTTOM } from './supermotoFit';

type Point = readonly [number, number, number];
const rings = [
  [0.075, 0.084, 0.046, 0.890],
  [0.22, 0.108, 0.079, 0.862],
  [0.43, 0.099, 0.044, 0.905],
  [0.61, 0.064, 0.027, 0.990],
  [0.74, 0.053, 0.018, 1.031],
];

function capsuleSamples(a: Point, b: Point, radius: number) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const count = Math.ceil(start.distanceTo(end) / 0.003);
  return Array.from({ length: count + 1 }, (_, i) => ({
    center: start.clone().lerp(end, i / count), radius,
  }));
}

/** The original outer airbox profile is retained. A moulded underside tunnel
 * gives the upright shock and its forward mount room, with small pass-throughs
 * for the two braces that attach to the upper frame rails. */
export function supermotoAirboxGeometry() {
  const profile = new THREE.CatmullRomCurve3(rings.map(r => new THREE.Vector3(r[0], r[1], r[2])), false, 'catmullrom', 0.25);
  const centers = new THREE.CatmullRomCurve3(rings.map(r => new THREE.Vector3(r[0], r[3], 0)), false, 'catmullrom', 0.25);
  // The rounded 57 mm envelope encloses the 47.5 mm spring envelope and its
  // small lateral sweep near the fixed top eye over the full suspension travel.
  const tunnel = [
    ...capsuleSamples(SUPERMOTO_SHOCK_TOP, SUPERMOTO_SHOCK_BOTTOM, 0.057),
    ...capsuleSamples([0, 0.885, 0.090], SUPERMOTO_SHOCK_TOP, 0.031),
  ];
  const supportT = (SUPERMOTO_SHOCK_TOP[2] - 0.120) / (0.730 - 0.120);
  const braces = [-1, 1].map(side => new THREE.Line3(
    new THREE.Vector3(side * THREE.MathUtils.lerp(0.085, 0.06154, supportT),
      THREE.MathUtils.lerp(0.918, 0.97806, supportT), SUPERMOTO_SHOCK_TOP[2]),
    new THREE.Vector3(side * 0.028, SUPERMOTO_SHOCK_TOP[1], SUPERMOTO_SHOCK_TOP[2]),
  ));
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const longitudinal = 80, segments = 48;
  for (let i = 0; i <= longitudinal; i++) {
    const p = profile.getPoint(i / longitudinal), c = centers.getPoint(i / longitudinal);
    for (let j = 0; j <= segments; j++) {
      const angle = j / segments * Math.PI * 2 - Math.PI / 2;
      const x = Math.sin(angle) * p.y, height = Math.cos(angle) * p.z;
      let y = c.y + height;
      if (height < 0) for (const sample of tunnel) {
        const square = sample.radius ** 2 - (x - sample.center.x) ** 2 - (p.x - sample.center.z) ** 2;
        if (square > 0) y = Math.max(y, sample.center.y + Math.sqrt(square));
      }
      positions.push(x, y, p.x);
      uvs.push(j / segments, (p.x - rings[0][0]) / (rings[rings.length - 1][0] - rings[0][0]));
    }
  }
  const point = (index: number) => new THREE.Vector3().fromArray(positions, index * 3);
  const nearBrace = (p: THREE.Vector3) => braces.some(brace =>
    brace.closestPointToPoint(p, true, new THREE.Vector3()).distanceTo(p) < 0.018);
  const triangle = (a: number, b: number, c: number) => {
    const points = [point(a), point(b), point(c)];
    // Deliberate clearance slots in the housing, not a bracket penetrating a
    // nominally solid skin. Include edge midpoints to cover narrow crossings.
    if (points.some(nearBrace) || points.some((p, i) => nearBrace(p.clone().lerp(points[(i + 1) % 3], 0.5)))) return;
    indices.push(a, b, c);
  };
  for (let i = 0; i < longitudinal; i++) for (let j = 0; j < segments; j++) {
    const a = i * (segments + 1) + j, b = a + segments + 1;
    triangle(a, b, a + 1); triangle(b, b + 1, a + 1);
  }
  // Ear clipping also handles the concave underside at the front end cap.
  for (const end of [0, longitudinal]) {
    const first = end * (segments + 1);
    const contour = Array.from({ length: segments }, (_, j) => {
      const p = point(first + j); return new THREE.Vector2(p.x, p.y);
    });
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, []))
      if (end === 0) triangle(first + c, first + b, first + a);
      else triangle(first + a, first + b, first + c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}
