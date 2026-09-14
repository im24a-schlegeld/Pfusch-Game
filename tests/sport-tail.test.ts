import { expect, it, vi } from 'vitest';
import {
  Box3,
  Line3,
  Mesh,
  MeshStandardMaterial,
  Ray,
  Triangle,
  Vector3,
  type CylinderGeometry,
} from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeBike } from '../app/game/vehicle';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

function triangles(mesh: Mesh) {
  mesh.updateMatrix();
  const p = mesh.geometry.getAttribute('position'),
    index = mesh.geometry.index!;
  return Array.from({ length: index.count / 3 }, (_, i) => {
    const v = [0, 1, 2].map((j) =>
      new Vector3()
        .fromBufferAttribute(p, index.getX(i * 3 + j))
        .applyMatrix4(mesh.matrix),
    );
    const triangle = new Triangle(v[0], v[1], v[2]);
    return { triangle, box: new Box3().setFromPoints(v) };
  });
}
function meshDistance(a: Mesh, b: Mesh) {
  const first = triangles(a),
    second = triangles(b);
  let min = Infinity;
  const nearest = new Vector3(),
    ray = new Ray(),
    hit = new Vector3();
  const edges = (t: Triangle) => [
    new Line3(t.a, t.b),
    new Line3(t.b, t.c),
    new Line3(t.c, t.a),
  ];
  const segmentDistance = (a: Line3, b: Line3) => {
    const u = a.delta(new Vector3()),
      v = b.delta(new Vector3()),
      w = a.start.clone().sub(b.start);
    const aa = u.dot(u),
      bb = u.dot(v),
      cc = v.dot(v),
      dd = u.dot(w),
      ee = v.dot(w),
      denominator = aa * cc - bb * bb;
    const pairs: [number, number][] = [
      [0, Math.max(0, Math.min(1, ee / cc))],
      [1, Math.max(0, Math.min(1, (ee + bb) / cc))],
      [Math.max(0, Math.min(1, -dd / aa)), 0],
      [Math.max(0, Math.min(1, (bb - dd) / aa)), 1],
    ];
    if (denominator > 1e-20) {
      const s = (bb * ee - cc * dd) / denominator,
        t = (aa * ee - bb * dd) / denominator;
      if (s >= 0 && s <= 1 && t >= 0 && t <= 1) pairs.push([s, t]);
    }
    return Math.min(
      ...pairs.map(([s, t]) =>
        a.at(s, new Vector3()).distanceTo(b.at(t, new Vector3())),
      ),
    );
  };
  for (const one of first)
    for (const two of second) {
      const lowerBound = Math.hypot(
        ...(['x', 'y', 'z'] as const).map((axis) =>
          Math.max(
            0,
            one.box.min[axis] - two.box.max[axis],
            two.box.min[axis] - one.box.max[axis],
          ),
        ),
      );
      if (lowerBound >= min) continue;
      for (const [source, target] of [
        [one.triangle, two.triangle],
        [two.triangle, one.triangle],
      ]) {
        for (const point of [source.a, source.b, source.c])
          min = Math.min(
            min,
            target.closestPointToPoint(point, nearest).distanceTo(point),
          );
        for (const edge of edges(source)) {
          const length = edge.distance();
          if (length < 1e-10) continue;
          ray.set(edge.start, edge.delta(new Vector3()).normalize());
          if (
            ray.intersectTriangle(target.a, target.b, target.c, false, hit) &&
            hit.distanceTo(edge.start) <= length + 1e-9
          )
            return 0;
        }
      }
      for (const aEdge of edges(one.triangle))
        for (const bEdge of edges(two.triangle))
          if (aEdge.distanceSq() > 1e-20 && bEdge.distanceSq() > 1e-20)
            min = Math.min(min, segmentDistance(aEdge, bEdge));
    }
  return min;
}

it('keeps rear rail triangles clear of Sport plastics while two mounts meet the real tail underside', () => {
  const bike = makeBike({ ...newPlayer(), bike: '701' }, []);
  const tail = bike.body.getObjectByName('sport-tail-shell') as Mesh;
  const saddle = bike.body.children.find(
    (o) =>
      o instanceof Mesh &&
      o.material instanceof MeshStandardMaterial &&
      o.material.color.getHexString() === '171c20',
  ) as Mesh;
  const rails = bike.body.getObjectsByProperty(
    'name',
    'sport-rear-subframe',
  ) as Mesh[];
  expect(tail).toBeDefined();
  expect(saddle).toBeDefined();
  expect(rails).toHaveLength(2);
  const clearances = rails.map((rail) => ({
    tail: meshDistance(rail, tail),
    saddle: meshDistance(rail, saddle),
  }));
  const hitSurface = (part: Mesh, origin: Vector3, direction: Vector3) => {
    const ray = new Ray(origin, direction),
      hit = new Vector3();
    return triangles(part)
      .flatMap(({ triangle }) => {
        if (
          !ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, hit)
        )
          return [];
        const point = hit.clone();
        return [
          {
            point,
            normal: triangle.getNormal(new Vector3()),
            distance: point.distanceTo(origin),
          },
        ];
      })
      .sort((a, b) => a.distance - b.distance)[0];
  };
  for (const clearance of clearances) {
    expect(clearance.tail).toBeGreaterThan(0.006);
    expect(clearance.saddle).toBeGreaterThan(0.006);
  }
  const mounts = bike.body.getObjectsByProperty(
    'name',
    'sport-tail-mount',
  ) as Mesh<CylinderGeometry>[];
  expect(mounts).toHaveLength(2);
  const mountAudit = mounts.map((mount, side) => {
    mount.updateMatrix();
    const height = mount.geometry.parameters.height;
    const top = new Vector3(0, height / 2, 0).applyMatrix4(mount.matrix);
    const bottom = new Vector3(0, -height / 2, 0).applyMatrix4(mount.matrix);
    const underside = hitSurface(
      tail,
      new Vector3(top.x, 0.6, top.z),
      new Vector3(0, 1, 0),
    );
    expect(underside).toBeDefined();
    expect(underside.point.distanceTo(top)).toBeLessThan(1e-7);
    expect(underside.normal.y).toBeLessThan(0);
    expect(
      top.clone().sub(bottom).normalize().dot(underside.normal),
    ).toBeCloseTo(-1, 8);
    const rail = rails[side];
    const p = mount.geometry.getAttribute('position');
    let maximumTopGap = 0;
    for (let i = 0; i < p.count; i++) {
      const point = new Vector3()
        .fromBufferAttribute(p, i)
        .applyMatrix4(mount.matrix);
      if (p.getY(i) > 0) {
        const contact = hitSurface(
          tail,
          new Vector3(point.x, 0.6, point.z),
          new Vector3(0, 1, 0),
        );
        expect(contact).toBeDefined();
        // Every point of the complete top disc lies on the same actual face.
        // A guessed endpoint can pass a centre-only check while the rim intrudes.
        maximumTopGap = Math.max(
          maximumTopGap,
          contact.point.distanceTo(point),
        );
      } else {
        // The lower disc sits inside the supporting tube, not merely near it.
        expect(hitSurface(rail, point, underside.normal)).toBeDefined();
        expect(
          hitSurface(rail, point, underside.normal.clone().negate()),
        ).toBeDefined();
      }
    }
    expect(maximumTopGap).toBeLessThan(1e-7);
    const saddleClearance = meshDistance(mount, saddle);
    expect(saddleClearance).toBeGreaterThan(0.006);
    return {
      top: top.toArray(),
      bottom: bottom.toArray(),
      length: height,
      maximumTopGap,
      saddleClearance,
    };
  });
  if (process.env.PFUSCH_GEOMETRY_AUDIT === '1')
    console.log(
      JSON.stringify(
        {
          units: 'model metres before display scale',
          clearances,
          mounts: mountAudit,
        },
        null,
        2,
      ),
    );
});
