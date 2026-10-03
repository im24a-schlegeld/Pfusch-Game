import { describe, expect, it, vi } from 'vitest';
import { Box3, Matrix4, Mesh, MeshStandardMaterial, Ray, Triangle, Vector3 } from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeBike } from '../app/game/vehicle';
import { SUPERMOTO_STATIC_SAG } from '../app/game/supermotoRideHeight';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

const clearance = 0.003;
const bodyworkNames = ['supermoto-airbox', 'airbox-inner-splash-wall',
  'supermoto-airbox-access-panel', 'supermoto-middle-side-cover', 'supermoto-side-cover'];
type Face = { triangle: Triangle; bounds: Box3 };
type Tree = { bounds: Box3; faces?: Face[]; children?: [Tree, Tree] };

function faces(part: Mesh, inverse: Matrix4): Face[] {
  const transform = inverse.clone().multiply(part.matrixWorld);
  const p = part.geometry.getAttribute('position'), index = part.geometry.getIndex();
  const result: Face[] = [];
  for (let i = 0; i < (index?.count ?? p.count); i += 3) {
    const points = [0, 1, 2].map(k => new Vector3()
      .fromBufferAttribute(p, index ? index.getX(i + k) : i + k).applyMatrix4(transform));
    const triangle = new Triangle(...points as [Vector3, Vector3, Vector3]);
    if (triangle.getArea() > 1e-14)
      result.push({ triangle, bounds: new Box3().setFromPoints(points) });
  }
  return result;
}

function boundsGap(a: Box3, b: Box3) {
  return Math.hypot(
    Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x),
    Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y),
    Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z),
  );
}

function tree(faces: Face[]): Tree {
  const bounds = new Box3();
  for (const face of faces) bounds.union(face.bounds);
  if (faces.length <= 8) return { bounds, faces };
  const size = bounds.getSize(new Vector3());
  const axis = size.x > size.y && size.x > size.z ? 'x' : size.y > size.z ? 'y' : 'z';
  const sorted = [...faces].sort((a, b) => a.bounds.min[axis] + a.bounds.max[axis]
    - b.bounds.min[axis] - b.bounds.max[axis]);
  const middle = Math.floor(sorted.length / 2);
  return { bounds, children: [tree(sorted.slice(0, middle)), tree(sorted.slice(middle))] };
}

function segmentGap(a: Vector3, b: Vector3, c: Vector3, d: Vector3) {
  const u = b.clone().sub(a), v = d.clone().sub(c), w = a.clone().sub(c);
  const aa = u.lengthSq(), bb = u.dot(v), cc = v.lengthSq(), dd = u.dot(w), ee = v.dot(w);
  if (aa < 1e-20 || cc < 1e-20) return Infinity;
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const determinant = aa * cc - bb * bb;
  let s = determinant > 1e-20 ? clamp((bb * ee - cc * dd) / determinant) : 0;
  let t = (bb * s + ee) / cc;
  if (t < 0) { t = 0; s = clamp(-dd / aa); }
  else if (t > 1) { t = 1; s = clamp((bb - dd) / aa); }
  return w.addScaledVector(u, s).addScaledVector(v, -t).length();
}

/** Full surface distance: includes closest points inside a triangle, skew
 * edges, coplanar overlap and edges passing through another face's interior. */
function triangleGap(a: Triangle, b: Triangle) {
  const av = [a.a, a.b, a.c], bv = [b.a, b.b, b.c];
  let minimum = Infinity;
  for (const [source, target] of [[av, b], [bv, a]] as const) {
    for (let i = 0; i < 3; i++) {
      minimum = Math.min(minimum, target.closestPointToPoint(source[i], new Vector3()).distanceTo(source[i]));
      const edge = source[(i + 1) % 3].clone().sub(source[i]), length = edge.length();
      if (length < 1e-10) continue;
      const hit = new Ray(source[i], edge.divideScalar(length))
        .intersectTriangle(target.a, target.b, target.c, false, new Vector3());
      if (hit && hit.distanceTo(source[i]) <= length + 1e-10) return 0;
    }
  }
  // Each edge pair is evaluated once, rather than once per operand order.
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    minimum = Math.min(minimum, segmentGap(av[i], av[(i + 1) % 3], bv[j], bv[(j + 1) % 3]));
  return minimum;
}

function nearbyGap(face: Face, target: Tree): number {
  if (boundsGap(face.bounds, target.bounds) >= clearance) return Infinity;
  if (target.children) return Math.min(...target.children.map(child => nearbyGap(face, child)));
  let minimum = Infinity;
  for (const other of target.faces!) {
    if (boundsGap(face.bounds, other.bounds) >= clearance) continue;
    minimum = Math.min(minimum, triangleGap(face.triangle, other.triangle));
  }
  return minimum;
}

/** A completely enclosed solid has no crossing triangles. Test parity too,
 * using actual surface points, never a coil's empty bounding-box centre. */
function oddCrossings(point: Vector3, direction: Vector3, target: Tree): boolean {
  const ray = new Ray(point, direction);
  const distances: number[] = [];
  const visit = (node: Tree) => {
    if (!ray.intersectsBox(node.bounds)) return;
    if (node.children) { for (const child of node.children) visit(child); return; }
    for (const { triangle } of node.faces!) {
      const hit = ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, new Vector3());
      if (hit) distances.push(hit.distanceTo(point));
    }
  };
  visit(target);
  distances.sort((a, b) => a - b);
  return distances.filter((d, i, all) => i === 0 || d - all[i - 1] > 1e-7).length % 2 === 1;
}

const containmentDirections = [
  [0.731, 0.293, 0.615], [-0.61, 0.73, 0.31], [0.29, -0.65, 0.70],
  [-0.65, -0.72, -0.24], [0.13, 0.98, -0.10], [0.98, -0.12, 0.03], [-0.07, -0.14, -0.99],
].map(([x, y, z]) => new Vector3(x, y, z).normalize());

function isInside(point: Vector3, target: Tree): boolean {
  if (!target.bounds.containsPoint(point)) return false;
  // Brace slots intentionally make the airbox an open housing. One ray can
  // enter the skin and leave through a slot, producing a false odd parity.
  // Use a majority of dispersed directions for enclosure; surface crossings
  // and sub-3-mm distances still fail independently for every actual triangle.
  return containmentDirections.filter(direction => oddCrossings(point, direction, target)).length >= 4;
}

function surfaceSamples(faces: Face[], bounds: Box3) {
  let upper = faces[0].triangle.a, lower = upper;
  const center = bounds.getCenter(new Vector3());
  let middle = faces[0].triangle.getMidpoint(new Vector3()), middleDistance = Infinity;
  for (const { triangle } of faces) {
    for (const point of [triangle.a, triangle.b, triangle.c]) {
      if (point.y > upper.y) upper = point;
      if (point.y < lower.y) lower = point;
    }
    const sample = triangle.getMidpoint(new Vector3()), distance = sample.distanceToSquared(center);
    if (distance < middleDistance) { middle = sample; middleDistance = distance; }
  }
  return [lower, middle, upper];
}

describe('actual Supermoto airbox / moving shock clearance', () => {
  it('provides real openings around the relocated upper frame supports', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    bike.root.updateMatrixWorld(true);
    const inverse = bike.body.matrixWorld.clone().invert();
    const airbox = bike.body.getObjectByName('supermoto-airbox') as Mesh;
    const housing = tree(faces(airbox, inverse));
    const supports = ['supermoto-shock-bridge-support', 'supermoto-shock-upper-brace']
      .flatMap(name => bike.body.getObjectsByProperty('name', name)) as Mesh[];
    expect(supports).toHaveLength(4);
    for (const part of supports) for (const face of faces(part, inverse))
      expect(nearbyGap(face, housing), part.name).toBeGreaterThanOrEqual(clearance);
  });

  it('keeps every shock surface at least 3 mm outside the airbox over rebound, sag and compression', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    bike.root.updateMatrixWorld(true);
    // Cancel the full current body transform, including scale and suspension;
    // transform each moving mesh independently into the same chassis space.
    const initialInverse = bike.body.matrixWorld.clone().invert();
    const airboxes = bodyworkNames.flatMap(name => bike.body.getObjectsByProperty('name', name)) as Mesh[];
    expect(airboxes).toHaveLength(9);
    const obstacles = airboxes.map(part => {
      const geometry = faces(part, initialInverse), hierarchy = tree(geometry);
      return { part, hierarchy, samples: surfaceSamples(geometry, hierarchy.bounds) };
    });
    const movingNames = ['supermoto-shock-damper', 'supermoto-shock-reservoir',
      'supermoto-shock-spring-seat', 'supermoto-shock-eyelet', 'rear-shock-spring'];
    const movingRoots = movingNames.flatMap(name => bike.body.getObjectsByProperty('name', name));
    expect(movingRoots).toHaveLength(7);
    const moving: Mesh[] = [];
    for (const root of movingRoots) root.traverse(part => {
      if (part instanceof Mesh && !moving.includes(part)) moving.push(part);
    });
    // The separate upper barrel, reservoir caps and connecting neck are real
    // moving solids too, even though they inherit their parent rig transform.
    for (const name of ['supermoto-shock-upper-body', 'supermoto-shock-reservoir-cap',
      'supermoto-shock-reservoir-neck']) expect(moving.some(part => part.name === name)).toBe(true);
    // Include both absolute travel stops, the exact zero input (static sag),
    // and densely spaced intermediate poses. Wheelie load exercises the other
    // real rear-load input; the animator determines linkage motion in all cases.
    const travelInputs = [-0.20, -SUPERMOTO_STATIC_SAG / 0.72,
      ...Array.from({ length: 25 }, (_, i) => -0.12 + i * 0.01), 0.20];
    const insufficient: string[] = [];
    for (const wheelieLoad of [0, 1]) for (const travel of travelInputs) {
      bike.animateSuspension(wheelieLoad * 0.85, travel, wheelieLoad);
      bike.root.updateMatrixWorld(true);
      const inverse = bike.body.matrixWorld.clone().invert();
      for (const part of moving) {
        const geometry = faces(part, inverse), hierarchy = tree(geometry);
        for (const obstacle of obstacles) {
          if (boundsGap(hierarchy.bounds, obstacle.hierarchy.bounds) >= clearance) continue;
          let minimum = Infinity, closest: Vector3 | undefined;
          for (const face of geometry) {
            const gap = nearbyGap(face, obstacle.hierarchy);
            if (gap < minimum) { minimum = gap; closest = face.triangle.getMidpoint(new Vector3()); }
          }
          const insidePoint = surfaceSamples(geometry, hierarchy.bounds).find(point => isInside(point, obstacle.hierarchy))
            ?? obstacle.samples.find(point => isInside(point, hierarchy));
          const inside = insidePoint !== undefined;
          if (inside || minimum < clearance) insufficient.push(
            `${part.name} / ${obstacle.part.name}; travel=${travel.toFixed(3)}, load=${wheelieLoad}; `
            + `gap=${minimum}, enclosed=${inside}, near=${(closest ?? insidePoint)?.toArray().join(',') ?? 'unknown'}`,
          );
        }
      }
    }
    expect(insufficient, 'all actual faces and enclosed solids must retain at least 3 mm').toEqual([]);
  }, 60000);

  it('keeps the header outside the expanded airbox and painted backing, including between mesh vertices', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    bike.root.updateMatrixWorld(true);
    const inverse = bike.body.matrixWorld.clone().invert();
    const header = bike.body.getObjectByName('connected-exhaust-pipe') as Mesh;
    const headerFaces = faces(header, inverse), hierarchy = tree(headerFaces);
    const obstacles = [...bodyworkNames, 'radiator-shroud']
      .flatMap(name => bike.body.getObjectsByProperty('name', name)) as Mesh[];
    expect(obstacles).toHaveLength(11);
    const insufficient: string[] = [];
    for (const obstacle of obstacles) {
      const geometry = faces(obstacle, inverse), target = tree(geometry);
      if (boundsGap(hierarchy.bounds, target.bounds) >= clearance) continue;
      let minimum = Infinity, closest: Vector3 | undefined;
      for (const face of headerFaces) {
        const gap = nearbyGap(face, target);
        if (gap < minimum) { minimum = gap; closest = face.triangle.getMidpoint(new Vector3()); }
      }
      const enclosed = surfaceSamples(headerFaces, hierarchy.bounds).some(point => isInside(point, target));
      if (enclosed || minimum < clearance)
        insufficient.push(`${obstacle.name}; gap=${minimum}, enclosed=${enclosed}, near=${closest?.toArray().join(',')}`);
    }
    expect(insufficient, 'the complete pipe must retain at least 3 mm from the denser bodywork').toEqual([]);
  });
});
