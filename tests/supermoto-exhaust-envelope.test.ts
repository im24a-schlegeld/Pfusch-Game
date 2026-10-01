import { describe, expect, it, vi } from 'vitest';
import { Box3, Matrix4, Mesh, MeshStandardMaterial, Ray, Triangle, Vector3 } from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeBike } from '../app/game/vehicle';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

const canNames = [
  'single-exhaust', 'open-silencer-outlet', 'exhaust-mount-band',
  'silencer-inner-bore', 'silencer-bore-depth', 'silencer-outlet-ring',
] as const;

/** Actual transformed vertices, including can end caps and outlet fittings.
 * Both operands use one declared, unscaled coordinate system. A positive box
 * separation proves that every point of both complete solids is separated. */
function envelope(part: Mesh, inverse: Matrix4) {
  const transform = inverse.clone().multiply(part.matrixWorld);
  const bounds = new Box3(), point = new Vector3();
  const positions = part.geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++)
    bounds.expandByPoint(point.fromBufferAttribute(positions, i).applyMatrix4(transform));
  return bounds;
}

function gap(a: Box3, b: Box3) {
  return Math.hypot(
    Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x),
    Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y),
    Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z),
  );
}

function faces(part: Mesh, inverse: Matrix4) {
  const transform = inverse.clone().multiply(part.matrixWorld);
  const positions = part.geometry.getAttribute('position'), index = part.geometry.getIndex();
  const result: { triangle: Triangle; bounds: Box3 }[] = [];
  for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
    const p = [0, 1, 2].map(k => new Vector3().fromBufferAttribute(positions, index ? index.getX(i + k) : i + k).applyMatrix4(transform));
    result.push({ triangle: new Triangle(p[0], p[1], p[2]), bounds: new Box3().setFromPoints(p) });
  }
  return result;
}

function segmentGap(a: Vector3, b: Vector3, c: Vector3, d: Vector3) {
  const u = b.clone().sub(a), v = d.clone().sub(c), w = a.clone().sub(c);
  const aa = u.lengthSq(), bb = u.dot(v), cc = v.lengthSq(), dd = u.dot(w), ee = v.dot(w);
  if (aa < 1e-20 || cc < 1e-20) return Infinity;
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const determinant = aa * cc - bb * bb;
  let s = determinant > 1e-20 ? clamp((bb * ee - cc * dd) / determinant) : 0;
  let t = (bb * s + ee) / cc;
  if (t < 0) { t = 0; s = clamp(-dd / aa); }
  else if (t > 1) { t = 1; s = clamp((bb - dd) / aa); }
  return w.addScaledVector(u, s).addScaledVector(v, -t).length();
}

/** Exact triangle separation: vertex/face and edge/edge closest pairs, plus
 * transverse edge/face intersections. This catches crossing between vertices. */
function triangleGap(a: Triangle, b: Triangle) {
  const av = [a.a, a.b, a.c], bv = [b.a, b.b, b.c];
  let minimum = Infinity;
  for (const [source, target, triangle] of [[av, bv, b], [bv, av, a]] as const) {
    for (let i = 0; i < 3; i++) {
      minimum = Math.min(minimum, triangle.closestPointToPoint(source[i], new Vector3()).distanceTo(source[i]));
      const direction = source[(i + 1) % 3].clone().sub(source[i]);
      const length = direction.length();
      if (length > 1e-10) {
        const hit = new Ray(source[i], direction.divideScalar(length)).intersectTriangle(triangle.a, triangle.b, triangle.c, false, new Vector3());
        if (hit && hit.distanceTo(source[i]) <= length + 1e-10) return 0;
      }
      for (let j = 0; j < 3; j++)
        minimum = Math.min(minimum, segmentGap(source[i], source[(i + 1) % 3], target[j], target[(j + 1) % 3]));
    }
  }
  return minimum;
}

describe('complete Supermoto exhaust clearance envelopes', () => {
  it('keeps header, can inlet and hanger clear of the rear frame, including triangle crossings', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    bike.root.updateMatrixWorld(true);
    const inverse = bike.body.matrixWorld.clone().invert();
    const rails = ['supermoto-rear-subframe', 'supermoto-upper-subframe']
      .flatMap(name => bike.body.getObjectsByProperty('name', name)) as Mesh[];
    expect(rails).toHaveLength(4);
    const insufficient: string[] = [];
    for (const name of ['connected-exhaust-pipe', 'single-exhaust', 'exhaust-frame-hanger']) {
      const source = bike.body.getObjectByName(name) as Mesh;
      const sourceFaces = faces(source, inverse).filter(face => name === 'exhaust-frame-hanger'
        || (face.bounds.max.z > 0.30 && face.bounds.min.z < 0.56));
      expect(sourceFaces.length).toBeGreaterThan(20);
      for (const rail of rails) {
        // The hanger's upper eye intentionally attaches to the upper rail;
        // its full solid must still clear both diagonal rear frame members.
        if (name === 'exhaust-frame-hanger' && rail.name === 'supermoto-upper-subframe') continue;
        let minimum = Infinity, minimumAt = '';
        for (const target of faces(rail, inverse)) for (const face of sourceFaces) {
          if (gap(face.bounds, target.bounds) > 0.002) continue;
          const distance = triangleGap(face.triangle, target.triangle);
          if (distance < minimum) {
            minimum = distance;
            minimumAt = face.triangle.getMidpoint(new Vector3()).toArray().join(',');
          }
        }
        if (minimum <= 0.002) insufficient.push(`${name} / ${rail.name}: gap ${minimum} near ${minimumAt}`);
      }
    }
    expect(insufficient, 'every pipe/inlet triangle must retain more than 2 mm to the frame').toEqual([]);
  });

  it('clears the actual rear tyre and moving shock at rebound, settled stance and maximum compression', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    const can = [...canNames, 'exhaust-frame-hanger'].map(name => {
      const part = bike.body.getObjectByName(name);
      expect(part, name).toBeInstanceOf(Mesh);
      return part as Mesh;
    });
    const tire = bike.wheels[1].getObjectByName('tire') as Mesh;
    const shocks = [
      'supermoto-shock-damper', 'supermoto-shock-reservoir',
      'supermoto-shock-spring-seat', 'supermoto-shock-eyelet', 'rear-shock-spring',
    ].flatMap(name => bike.body.getObjectsByProperty('name', name)) as Mesh[];
    expect(shocks.length).toBeGreaterThan(6);
    // Extreme inputs reach the existing absolute stops even with 50 mm sag.
    // Reusing the real animator includes arm rotation and axial spring motion.
    for (const pitch of [0, 0.85]) for (const travel of [-0.20, 0, 0.06, 0.20]) {
      bike.animateSuspension(pitch, travel, pitch > 0 ? 1 : 0);
      bike.root.updateMatrixWorld(true);
      const inverse = bike.body.matrixWorld.clone().invert();
      const tireBounds = envelope(tire, inverse);
      for (const part of can) {
        const bounds = envelope(part, inverse);
        expect(gap(bounds, tireBounds), `${part.name} / rear tyre; pitch ${pitch}, travel ${travel}`)
          .toBeGreaterThan(0.008);
        for (const shock of shocks)
          expect(gap(bounds, envelope(shock, inverse)), `${part.name} / ${shock.name}; pitch ${pitch}, travel ${travel}`)
            .toBeGreaterThan(0.003);
      }
    }
  });

  it('keeps the complete relocated can outside the frame tubes and solid airbox', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    bike.root.updateMatrixWorld(true);
    const inverse = bike.body.matrixWorld.clone().invert();
    const cans = canNames.map(name => bike.body.getObjectByName(name) as Mesh);
    const canFaces = cans.map(part => faces(part, inverse));
    const frames = ['supermoto-frame-main-spar', 'supermoto-rear-subframe', 'supermoto-upper-subframe']
      .flatMap(name => bike.body.getObjectsByProperty('name', name)) as Mesh[];
    expect(frames).toHaveLength(6);
    const airbox = ['supermoto-airbox', 'airbox-inner-splash-wall']
      .flatMap(name => bike.body.getObjectsByProperty('name', name)) as Mesh[];
    expect(airbox).toHaveLength(3);
    // A frame's whole bounding box contains large empty triangular space.
    // Use actual triangle separation wherever whole-solid bounds overlap.
    for (const frame of [...frames, ...airbox]) {
      const transform = inverse.clone().multiply(frame.matrixWorld);
      const positions = frame.geometry.getAttribute('position'), index = frame.geometry.getIndex();
      const canBounds = cans.map(part => envelope(part, inverse));
      for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
        const vertices: Vector3[] = [];
        for (let k = 0; k < 3; k++)
          vertices.push(new Vector3().fromBufferAttribute(positions, index ? index.getX(i + k) : i + k).applyMatrix4(transform));
        const face = new Box3().setFromPoints(vertices);
        for (let j = 0; j < cans.length; j++) {
          if (gap(face, canBounds[j]) > 0.003) continue;
          const triangle = new Triangle(vertices[0], vertices[1], vertices[2]);
          let minimum = Infinity;
          for (const target of canFaces[j]) {
            if (gap(face, target.bounds) > 0.003) continue;
            minimum = Math.min(minimum, triangleGap(triangle, target.triangle));
          }
          expect(minimum, `${cans[j].name} / ${frame.name}, triangle ${i / 3}`)
            .toBeGreaterThan(0.003);
        }
      }
    }
  });
});
