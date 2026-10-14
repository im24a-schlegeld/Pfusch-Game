import { expect, it } from 'vitest';
import * as THREE from 'three';
import { makeWorldFoliageOutline } from '../app/game/worldFoliageOutline';

const cross = (a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function hull(points: THREE.Vector2[]) {
  const sorted = [...new Map(points.map(p => [`${p.x.toFixed(7)},${p.y.toFixed(7)}`, p])).values()]
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const half = (list: THREE.Vector2[]) => {
    const result: THREE.Vector2[] = [];
    for (const p of list) {
      while (result.length > 1 && cross(result[result.length - 2], result[result.length - 1], p) <= 0) result.pop();
      result.push(p);
    }
    return result;
  };
  return [...half(sorted).slice(0, -1), ...half([...sorted].reverse()).slice(0, -1)];
}
function contains(p: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2) {
  const signs = [cross(a, b, p), cross(b, c, p), cross(c, a, p)];
  return Math.max(...signs) <= 1e-7 || Math.min(...signs) >= -1e-7;
}

/** Numerical reference for the shader's cone branch. Coverage is checked
 * independently against the real coloured convex hull and BackSide triangles,
 * rather than treating a changed projected normal as proof of an outline. */
function sampleCone(segments: number, side: number, z: number) {
  const width = 390, height = 844, stroke = 1.05;
  const geometry = new THREE.ConeGeometry(1, 1, segments);
  const positions = geometry.getAttribute('position');
  const originalPositions = Array.from(positions.array);
  const source = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), 1);
  const helper = makeWorldFoliageOutline([source]);
  const profile = geometry.getAttribute('cartoonWorldConeProfile');
  expect(profile.getX(0)).toBe(segments);
  expect(Array.from(positions.array)).toEqual(originalPositions);
  const sine = profile.getY(0), cosine = profile.getZ(0);
  const camera = new THREE.PerspectiveCamera(91, width / height, 0.1, 190);
  camera.position.set(-3.2 * 0.27, 4.4, 10.4);
  camera.lookAt(-3.2 * 0.38, 1.4, -12); camera.updateMatrixWorld(true);
  const instance = new THREE.Matrix4().makeScale(1.43, 3.816, 1.43).setPosition(side * 9.5, 3.498, z);
  const modelView = new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse, instance);
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(modelView);
  const project = (p: THREE.Vector3) => {
    const clip = new THREE.Vector4(p.x, p.y, p.z, 1).applyMatrix4(modelView).applyMatrix4(camera.projectionMatrix);
    expect(clip.w).toBeGreaterThan(0.1);
    return new THREE.Vector2((clip.x / clip.w + 1) * width / 2, (clip.y / clip.w + 1) * height / 2);
  };
  const apex = project(new THREE.Vector3(0, 0.5, 0)), centre = project(new THREE.Vector3());
  const outside = (p: THREE.Vector2, next: THREE.Vector2, previous: THREE.Vector2) =>
    cross(p, next, previous) * cross(p, next, apex) < 0;
  const miter = (p: THREE.Vector2, previous: THREE.Vector2, next: THREE.Vector2) => {
    const outward = (neighbor: THREE.Vector2) => {
      const edge = neighbor.clone().sub(p), normal = new THREE.Vector2(edge.y, -edge.x).normalize();
      if (normal.dot(centre.clone().sub(p)) > 0) normal.negate();
      return normal;
    };
    const a = outward(previous), b = outward(next);
    const offset = a.clone().add(b).multiplyScalar(stroke / Math.max(0.01, 1 + a.dot(b)));
    if (offset.length() > 4 * stroke) offset.setLength(4 * stroke);
    return offset;
  };
  const tangencies: THREE.Vector2[] = [];
  const ring = new THREE.Vector2(0, 1);
  let previous = project(new THREE.Vector3(-sine, -0.5, cosine));
  let current = project(new THREE.Vector3(0, -0.5, 1));
  for (let i = 0; i < segments; i++) {
    ring.set(ring.x * cosine + ring.y * sine, ring.y * cosine - ring.x * sine);
    const next = project(new THREE.Vector3(ring.x, -0.5, ring.y));
    if (outside(current, next, previous) !== outside(current, previous, next)) tangencies.push(current);
    previous = current; current = next;
  }
  expect(tangencies).toHaveLength(2);
  const base: THREE.Vector2[] = [], radial: THREE.Vector2[] = [], expanded: THREE.Vector2[] = [];
  for (let i = 0; i < positions.count; i++) {
    const point = new THREE.Vector3().fromBufferAttribute(positions, i), pixel = project(point);
    base.push(pixel);
    const normal = point.clone().normalize().applyMatrix3(normalMatrix).normalize();
    const projected = new THREE.Vector4(normal.x, normal.y, normal.z, 0).applyMatrix4(camera.projectionMatrix);
    const t = THREE.MathUtils.clamp((Math.hypot(projected.x, projected.y) - 0.025) / 0.095, 0, 1);
    const fallback = new THREE.Vector2(projected.x * width, projected.y * height).normalize().multiplyScalar(stroke * t * t * (3 - 2 * t));
    radial.push(pixel.clone().add(fallback));
    let offset = fallback;
    if (point.y > 0.49 && Math.hypot(point.x, point.z) < 0.001) offset = miter(pixel, tangencies[0], tangencies[1]);
    else if (Math.hypot(point.x, point.z) > 0.9) {
      const prev = project(new THREE.Vector3(point.x * cosine - point.z * sine, -0.5, point.z * cosine + point.x * sine));
      const next = project(new THREE.Vector3(point.x * cosine + point.z * sine, -0.5, point.z * cosine - point.x * sine));
      const nextOutside = outside(pixel, next, prev), previousOutside = outside(pixel, prev, next);
      if (!(nextOutside && previousOutside)) offset = miter(pixel, previousOutside ? apex : prev, nextOutside ? apex : next);
    }
    expect(offset.length()).toBeLessThanOrEqual(4 * stroke + 1e-7);
    expanded.push(pixel.clone().add(offset));
  }
  const gaps = (vertices: THREE.Vector2[]) => {
    const triangles: THREE.Vector2[][] = [];
    for (let i = 0; i < geometry.index!.count; i += 3) {
      const triangle = [0, 1, 2].map(j => vertices[geometry.index!.getX(i + j)]);
      if (cross(triangle[0], triangle[1], triangle[2]) < 0) triangles.push(triangle);
    }
    const boundary = hull(base); let misses = 0, samples = 0;
    for (let i = 0; i < boundary.length; i++) {
      const a = boundary[i], b = boundary[(i + 1) % boundary.length];
      const outward = new THREE.Vector2(b.y - a.y, a.x - b.x).normalize();
      for (const t of [0.15, 0.35, 0.5, 0.65, 0.85]) {
        const p = a.clone().lerp(b, t).addScaledVector(outward, 0.75);
        if (p.x < 0 || p.x > width || p.y < 0 || p.y > height) continue;
        samples++;
        if (!triangles.some(tri => contains(p, tri[0], tri[1], tri[2]))) misses++;
      }
    }
    return { samples, misses };
  };
  const old = gaps(radial), fixed = gaps(expanded);
  helper.dispose(); geometry.dispose(); (source.material as THREE.Material).dispose();
  return { old, fixed };
}

it.each([[7, -1, -14], [7, 1, -30], [10, -1, -14], [10, 1, -30]])(
  'preserves visible pine border width during an off-axis ride (%i segments, side %i, z %i)', (segments, side, z) => {
    const { old, fixed } = sampleCone(segments, side, z);
    expect(old.misses).toBeGreaterThan(0);
    expect(fixed.samples).toBeGreaterThan(15);
    expect(fixed.misses).toBe(0);
  },
);
