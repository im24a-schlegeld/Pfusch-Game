import { beforeAll, describe, expect, it } from 'vitest';
import {
  Box3,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Raycaster,
  Vector3,
} from 'three';
import { addSupermotoEngine } from '../app/game/supermotoEngine';
import { CHAIN_DRIVE } from '../app/game/driveGeometry';

describe('formed Supermoto single-cylinder engine', () => {
  const body = new Group();
  beforeAll(() => {
    addSupermotoEngine(body);
    body.updateMatrixWorld(true);
  });
  const part = (name: string) => body.getObjectByName(name) as Mesh;

  it('builds closed, finite castings with real depth and outward faces', () => {
    for (const name of [
      'engine-crankcase',
      'engine-clutch-cover',
      'engine-ignition-cover',
      'engine-water-jacket',
      'engine-cylinder-head',
      'engine-valve-cover',
    ]) {
      const mesh = part(name),
        p = mesh.geometry.getAttribute('position'),
        ix = mesh.geometry.index!;
      expect(mesh).toBeInstanceOf(Mesh);
      const edges = new Map<string, number>();
      let volume6 = 0;
      for (let i = 0; i < ix.count; i += 3) {
        const ids = [ix.getX(i), ix.getX(i + 1), ix.getX(i + 2)];
        const [a, b, c] = ids.map((index) =>
          new Vector3().fromBufferAttribute(p, index),
        );
        expect([...a, ...b, ...c].every(Number.isFinite)).toBe(true);
        volume6 += a.dot(new Vector3().crossVectors(b, c));
        for (let edge = 0; edge < 3; edge++) {
          const pair = [ids[edge], ids[(edge + 1) % 3]]
            .sort((x, y) => x - y)
            .join(':');
          edges.set(pair, (edges.get(pair) ?? 0) + 1);
        }
      }
      expect(volume6, `${name} must enclose positive volume`).toBeGreaterThan(
        0.00001,
      );
      expect(
        [...edges.values()].every((count) => count === 2),
        `${name} must have no open casting edges`,
      ).toBe(true);
      const size = new Box3().setFromObject(mesh).getSize(new Vector3());
      expect(size.x).toBeGreaterThan(0.03);
    }
  });

  it('joins the crankcase, barrel, separate head and valve cover without floating sections', () => {
    const finish = new MeshBasicMaterial({ side: DoubleSide });
    try {
      const ranges = [
        'engine-crankcase',
        'engine-water-jacket',
        'engine-head-gasket',
        'engine-cylinder-head',
        'engine-valve-gasket',
        'engine-valve-cover',
      ].map((name) => {
        const source = part(name),
          probe = new Mesh(source.geometry, finish);
        probe.matrixWorld.copy(source.matrixWorld);
        const heights = new Raycaster(
          new Vector3(0, 1, -0.14),
          new Vector3(0, -1, 0),
        )
          .intersectObject(probe, false)
          .map((hit) => hit.point.y);
        expect(
          heights.length,
          `${name} must cross the cylinder's actual assembly axis`,
        ).toBeGreaterThanOrEqual(2);
        return { name, low: Math.min(...heights), high: Math.max(...heights) };
      });
      for (let i = 1; i < ranges.length; i++)
        expect(
          ranges[i].low - ranges[i - 1].high,
          `${ranges[i].name} must seat on ${ranges[i - 1].name}`,
        ).toBeLessThanOrEqual(0.0005);
      const core = new Box3().setFromObject(part('engine-crankcase'));
      expect(core.min.y).toBeGreaterThanOrEqual(0.397);
      expect(core.min.y).toBeLessThan(0.405);
    } finally {
      finish.dispose();
    }
  });

  it('gives each side cover a broad planar face with consistent casting normals', () => {
    for (const [name, side] of [
      ['engine-clutch-cover', 1],
      ['engine-ignition-cover', -1],
    ] as const) {
      const geometry = part(name).geometry,
        p = geometry.getAttribute('position');
      const normal = geometry.getAttribute('normal');
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox!,
        faceX = side > 0 ? bounds.max.x : bounds.min.x;
      const faceBounds = new Box3();
      let faceVertices = 0;
      for (let i = 0; i < p.count; i++) {
        if (Math.abs(p.getX(i) - faceX) > 1e-7) continue;
        faceBounds.expandByPoint(new Vector3().fromBufferAttribute(p, i));
        // Flat casting faces must not inherit uneven triangulation weights
        // from their rounded shoulders, which formerly drew a radial star.
        expect(normal.getX(i)).toBeCloseTo(side, 6);
        expect(Math.hypot(normal.getY(i), normal.getZ(i))).toBeLessThan(1e-6);
        faceVertices++;
      }
      expect(faceVertices).toBeGreaterThan(100);
      const whole = bounds.getSize(new Vector3()),
        face = faceBounds.getSize(new Vector3());
      expect(face.y / whole.y).toBeGreaterThan(0.65);
      expect(face.z / whole.z).toBeGreaterThan(0.65);
      expect(whole.x).toBeGreaterThan(0.025);
    }
  });

  it('recesses the actual left gearbox wall and leaves the existing output sprocket clear', () => {
    const caseMesh = part('engine-crankcase'),
      finish = new MeshBasicMaterial({ side: DoubleSide });
    const probe = new Mesh(caseMesh.geometry, finish);
    probe.matrixWorld.copy(caseMesh.matrixWorld);
    try {
      const wall = new Raycaster(
        new Vector3(-1, 0.49, 0.08),
        new Vector3(1, 0, 0),
      ).intersectObject(probe, false)[0];
      expect(wall).toBeDefined();
      expect(wall.point.x).toBeGreaterThan(
        CHAIN_DRIVE.planeX + CHAIN_DRIVE.chainHalfWidth + 0.002,
      );
      const shaft = part('engine-output-shaft');
      const length = (shaft.geometry as CylinderGeometry).parameters.height;
      const ends = [-1, 1].map((sign) =>
        new Vector3(0, (sign * length) / 2, 0).applyMatrix4(shaft.matrixWorld),
      );
      expect(Math.min(...ends.map((p) => p.x))).toBeCloseTo(
        CHAIN_DRIVE.planeX,
        6,
      );
      expect(Math.max(...ends.map((p) => p.x))).toBeGreaterThanOrEqual(
        wall.point.x - 0.001,
      );
      const cover = part('engine-ignition-cover'),
        p = cover.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const point = new Vector3()
          .fromBufferAttribute(p, i)
          .applyMatrix4(cover.matrixWorld);
        expect(Math.hypot(point.y - 0.49, point.z - 0.08)).toBeGreaterThan(
          CHAIN_DRIVE.frontRadius + 0.005,
        );
      }
    } finally {
      finish.dispose();
    }
  });

  it('seats the marked lower front exhaust outlet inside the engine casting', () => {
    const port = part('engine-exhaust-port');
    const length = (port.geometry as CylinderGeometry).parameters.height;
    const start = new Vector3(0, -length / 2, 0).applyMatrix4(port.matrixWorld);
    const end = new Vector3(0, length / 2, 0).applyMatrix4(port.matrixWorld);
    const datum = new Vector3(0, 0.560, -0.236);
    const axis = end.clone().sub(start).normalize();
    expect(datum.clone().sub(start).cross(axis).length()).toBeLessThan(1e-7);
    const finish = new MeshBasicMaterial({ side: DoubleSide });
    const casing = part('engine-crankcase'),
      probe = new Mesh(casing.geometry, finish);
    probe.matrixWorld.copy(casing.matrixWorld);
    try {
      const hits = new Raycaster(start, new Vector3(0, 0, 1)).intersectObject(
        probe,
        false,
      );
      const distinct = hits.filter(
        (hit, i) => i === 0 || hit.distance - hits[i - 1].distance > 1e-6,
      );
      expect(
        distinct.length % 2,
        'the marked front outlet must have a physical seat in the engine casting',
      ).toBe(1);
    } finally {
      finish.dispose();
    }
  });

  it('seats the round black removable cover in a separately formed alloy housing', () => {
    const removable = part('engine-clutch-cover'), housing = part('engine-clutch-housing');
    const outer = new Box3().setFromObject(removable), seat = new Box3().setFromObject(housing);
    const size = outer.getSize(new Vector3());
    expect(size.y / size.z, 'round cover silhouette').toBeCloseTo(1, 2);
    expect(outer.min.x).toBeLessThan(seat.max.x);
    expect(outer.max.x - seat.max.x).toBeGreaterThan(0.015);
    expect(outer.max.x).toBeLessThanOrEqual(0.152001);
    const finish = removable.material as MeshStandardMaterial;
    expect(finish.color.r + finish.color.g + finish.color.b).toBeLessThan(0.05);
    expect(finish.color.equals((housing.material as MeshStandardMaterial).color)).toBe(false);
    const casting = part('engine-timing-chest');
    expect(new Box3().setFromObject(casting).min.z).toBeLessThan(outer.min.z - 0.1);
  });

  it('seats actual recessed fasteners in the cast surfaces without expanding the engine envelope', () => {
    const bolts = ['engine-clutch-fastener', 'engine-case-fastener']
      .flatMap(name => body.getObjectsByProperty('name', name)) as Mesh[];
    expect(body.getObjectsByProperty('name', 'engine-clutch-fastener')).toHaveLength(8);
    expect(body.getObjectsByProperty('name', 'engine-case-fastener').length).toBeGreaterThanOrEqual(7);
    const finish = new MeshBasicMaterial({ side: DoubleSide });
    try {
      for (const bolt of bolts) {
        const substrates = (bolt.name === 'engine-clutch-fastener'
          ? ['engine-clutch-cover']
          : ['engine-crankcase', 'engine-clutch-housing', 'engine-timing-chest'])
          .map(name => {
            const source = part(name), proxy = new Mesh(source.geometry, finish);
            proxy.matrixWorld.copy(source.matrixWorld);
            return proxy;
          });
        const bounds = new Box3().setFromObject(bolt);
        const origin = new Vector3(1, bolt.position.y, bolt.position.z);
        const ray = new Raycaster(origin, new Vector3(-1, 0, 0));
        const seat = ray.intersectObjects(substrates, false)[0]?.point.x;
        expect(seat, 'each bolt reaches an actual cast face').toBeDefined();
        expect(bounds.min.x).toBeLessThan(seat!);
        expect(bounds.max.x).toBeGreaterThan(seat!);
        expect(bounds.max.x).toBeLessThanOrEqual(0.152001);
        const proxy = new Mesh(bolt.geometry, finish);
        proxy.matrixWorld.copy(bolt.matrixWorld);
        expect(ray.intersectObject(proxy, false), 'the hex socket must be a real recess').toHaveLength(0);
        const floor = body.getObjectsByProperty('name', `${bolt.name}-socket-floor`)
          .find(part => Math.abs(part.position.y - bolt.position.y) < 1e-8
            && Math.abs(part.position.z - bolt.position.z) < 1e-8) as Mesh;
        expect(floor).toBeInstanceOf(Mesh);
        const floorSurface = ray.intersectObject(floor, false)[0]?.point.x;
        expect(floorSurface).toBeGreaterThan(seat!);
        expect(bounds.max.x - floorSurface!).toBeGreaterThan(0.0005);
      }
    } finally {
      finish.dispose();
    }
  });
});
