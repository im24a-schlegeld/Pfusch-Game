import { describe, expect, it } from 'vitest';
import {
  Box3,
  BufferGeometry,
  DoubleSide,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Triangle,
  Vector2,
  Vector3,
} from 'three';
import {
  makeTunnelBermGeometry,
  makeTunnelMountainGeometry,
  writeTunnelBermMatrix,
} from '../app/game/worldTerrain';

function triangles(geometry: BufferGeometry, matrix = new Matrix4()) {
  const position = geometry.getAttribute('position');
  const index = geometry.index;
  return Array.from(
    { length: (index?.count ?? position.count) / 3 },
    (_, i) => {
      const points = [0, 1, 2].map((j) =>
        new Vector3()
          .fromBufferAttribute(
            position,
            index ? index.getX(i * 3 + j) : i * 3 + j,
          )
          .applyMatrix4(matrix),
      );
      return new Triangle(points[0], points[1], points[2]);
    },
  );
}

/** Convex hull of the current portal arch and support exterior, not its hole. */
function portalEnvelope() {
  const points = [
    new Vector2(-7.205, 0),
    new Vector2(7.205, 0),
    new Vector2(-7.205, 4.3),
    new Vector2(7.205, 4.3),
  ];
  for (let i = 0; i <= 40; i++) {
    const angle = (i / 40) * Math.PI;
    points.push(
      new Vector2(
        Math.cos(angle) * 6.9 * 1.025,
        (4 + Math.sin(angle) * 4.25) * 1.025,
      ),
    );
  }
  points.sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: Vector2, b: Vector2, c: Vector2) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const chain = (ordered: Vector2[]) => {
    const result: Vector2[] = [];
    for (const point of ordered) {
      while (
        result.length > 1 &&
        cross(result.at(-2)!, result.at(-1)!, point) <= 0
      )
        result.pop();
      result.push(point);
    }
    result.pop();
    return result;
  };
  return [...chain(points), ...chain([...points].reverse())];
}

/** Clip complete triangles against the extruded convex portal envelope. */
function intersectsPortal(triangle: Triangle, envelope: Vector2[]) {
  let polygon = [triangle.a, triangle.b, triangle.c];
  const planes: ((p: Vector3) => number)[] = [
    (p) => p.z + 0.5,
    (p) => 0.5 - p.z,
  ];
  for (let i = 0; i < envelope.length; i++) {
    const a = envelope[i],
      b = envelope[(i + 1) % envelope.length];
    planes.push((p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
  }
  for (const distance of planes) {
    const clipped: Vector3[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        b = polygon[(i + 1) % polygon.length];
      const da = distance(a),
        db = distance(b);
      if (da >= 0) clipped.push(a);
      if (da < 0 !== db < 0) clipped.push(a.clone().lerp(b, da / (da - db)));
    }
    polygon = clipped;
    if (polygon.length === 0) return false;
  }
  return true;
}

function topAt(geometry: BufferGeometry, x: number, matrix = new Matrix4()) {
  const material = new MeshBasicMaterial({ side: DoubleSide });
  const mesh = new Mesh(geometry, material);
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(matrix);
  mesh.updateMatrixWorld(true);
  const hits = new Raycaster(
    new Vector3(x, 25, 0),
    new Vector3(0, -1, 0),
  ).intersectObject(mesh, false);
  material.dispose();
  expect(hits.length).toBeGreaterThan(0);
  return hits[0].point.y;
}

describe('reusable tunnel terrain geometry', () => {
  it.each([
    { name: 'mountain', make: makeTunnelMountainGeometry },
    { name: 'berm', make: makeTunnelBermGeometry },
  ])(
    'bakes restrained $name rock layers with matching colors at both cell ends',
    ({ make }) => {
      const geometry = make();
      const position = geometry.getAttribute('position');
      const color = geometry.getAttribute('color');
      expect(color.count).toBe(position.count);
      const ends = [new Set<string>(), new Set<string>()];
      const tones = new Set<string>();
      for (let i = 0; i < color.count; i++) {
        const tone = [color.getX(i), color.getY(i), color.getZ(i)]
          .map((v) => v.toFixed(5))
          .join(',');
        tones.add(tone);
        const z = position.getZ(i);
        if (Math.abs(z) === 0.5)
          ends[z < 0 ? 0 : 1].add(
            `${position.getX(i).toFixed(4)},${position.getY(i).toFixed(4)}:${tone}`,
          );
      }
      expect(tones.size).toBeGreaterThan(11);
      expect([...ends[0]].sort()).toEqual([...ends[1]].sort());
      const repeated = make();
      expect(repeated.getAttribute('color').array).toEqual(color.array);
      expect(repeated.getAttribute('position').array).toEqual(position.array);
      geometry.dispose();
      repeated.dispose();
    },
  );

  it('encloses the portal with a mountain while all triangles clear the road and portal exterior', () => {
    const geometry = makeTunnelMountainGeometry();
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.toArray()).toEqual([-35, -0.25, -0.5]);
    expect(geometry.boundingBox!.max.toArray()).toEqual([35, 17.5, 0.5]);
    const road = new Box3(
      new Vector3(-4.8, -0.19, -0.5),
      new Vector3(4.8, 4, 0.5),
    );
    const envelope = portalEnvelope();
    const faces = triangles(geometry);
    // Surface-only rock beds subdivide the fixed profile once at allocation.
    expect(faces.length).toBeLessThan(1600);
    for (const face of faces) {
      expect(face.getArea()).toBeGreaterThan(0);
      expect(road.intersectsTriangle(face)).toBe(false);
      expect(intersectsPortal(face, envelope)).toBe(false);
    }
    // Check actual surfaces: a closed front face across the mouth would fail
    // the triangle checks above; absent overhead/side mass would fail these.
    expect(topAt(geometry, 0)).toBeCloseTo(17.5);
    for (const side of [-1, 1]) {
      expect(topAt(geometry, side * 10)).toBeGreaterThan(14);
      expect(topAt(geometry, side * 30)).toBeCloseTo(3);
    }
    geometry.dispose();
  });

  it.each([-1, 1] as const)(
    'keeps the entire side %s berm outside asphalt and joins the mountain surface',
    (side) => {
      const geometry = makeTunnelBermGeometry();
      const mountain = makeTunnelMountainGeometry();
      const matrix = new Matrix4();
      const road = new Box3(
        new Vector3(-4.8, -20, -0.5),
        new Vector3(4.8, 20, 0.5),
      );
      for (const near of [0, 0.25, 0.5, 0.75, 1]) {
        writeTunnelBermMatrix(matrix, side, -0.5, 0.5, near, near, 0);
        for (const face of triangles(geometry, matrix)) {
          expect(road.intersectsTriangle(face)).toBe(false);
          for (const point of [face.a, face.b, face.c]) {
            expect(side * point.x).toBeGreaterThanOrEqual(7.21);
            if (near === 0) expect(point.y).toBeLessThan(-0.11);
          }
        }
      }
      for (const x of [7.24, 10, 16, 20, 30, 34])
        expect(topAt(geometry, side * x, matrix)).toBeCloseTo(
          topAt(mountain, side * x),
          5,
        );
      geometry.dispose();
      mountain.dispose();
    },
  );

  it.each([true, false])(
    'clips a continuous %s approach profile into partial 12 m cells without changing shared geometry',
    (approach) => {
      const geometry = makeTunnelBermGeometry();
      const position = geometry.getAttribute('position');
      geometry.computeBoundingBox();
      const original = Array.from(position.array);
      const start = 93.7,
        end = 151.25,
        anchor = 96;
      const proximity = (z: number) => {
        const progress = (z - start) / (end - start);
        return approach ? progress : 1 - progress;
      };
      const edges = [start, 96, 108, 120, 132, 144, end];
      const matrix = new Matrix4(),
        whole = new Matrix4();
      for (const side of [-1, 1] as const) {
        writeTunnelBermMatrix(
          whole,
          side,
          start,
          end,
          proximity(start),
          proximity(end),
          anchor,
        );
        for (let i = 0; i < edges.length - 1; i++) {
          const a = edges[i],
            b = edges[i + 1];
          expect(
            writeTunnelBermMatrix(
              matrix,
              side,
              a,
              b,
              proximity(a),
              proximity(b),
              anchor,
            ),
          ).toBe(matrix);
          expect(matrix.determinant()).toBeGreaterThan(0);
          const box = geometry.boundingBox!.clone().applyMatrix4(matrix);
          expect(anchor - box.max.z).toBeCloseTo(a, 8);
          expect(anchor - box.min.z).toBeCloseTo(b, 8);
          for (let j = 0; j < position.count; j++) {
            const local = new Vector3().fromBufferAttribute(position, j);
            const clipped = local.clone().applyMatrix4(matrix);
            const worldZ = anchor - clipped.z;
            local.z = ((start + end) / 2 - worldZ) / (side * (end - start));
            expect(local.applyMatrix4(whole).distanceTo(clipped)).toBeLessThan(
              1e-10,
            );
          }
        }
      }
      expect(Array.from(position.array)).toEqual(original);
      geometry.dispose();
    },
  );
});
