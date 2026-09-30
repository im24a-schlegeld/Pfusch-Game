import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DoubleSide, Mesh, MeshBasicMaterial, MeshStandardMaterial, Raycaster, Triangle, Vector3 } from 'three';
import { newPlayer } from '../app/domain/progression';
import { exhaustAxisY } from '../app/game/exhaustClearance';
import { makeBike } from '../app/game/vehicle';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(), fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(), accessoryMaterial: () => new MeshStandardMaterial(),
}));

describe('Supermoto moulded rear overlap', () => {
  let bike: ReturnType<typeof makeBike>;
  beforeAll(() => {
    bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    bike.root.scale.setScalar(1); bike.body.scale.setScalar(1);
    bike.animateSuspension(0, 0);
    bike.root.updateMatrixWorld(true);
  });

  it('covers only the upper silencer band, leaving the lower alloy face exposed', () => {
    const covers = bike.body.getObjectsByProperty('name', 'supermoto-side-cover') as Mesh[];
    const can = bike.body.getObjectByName('single-exhaust') as Mesh;
    const material = new MeshBasicMaterial({ side: DoubleSide });
    const probes = [...covers, can].map(source => {
      const mesh = new Mesh(source.geometry, material); mesh.name = source.name;
      mesh.matrixWorld.copy(source.matrixWorld); return mesh;
    });
    try {
      for (const z of [0.56, 0.60, 0.65, 0.70, 0.74]) {
        const direction = new Vector3(-1, 0, 0).transformDirection(bike.body.matrixWorld);
        const upper = new Raycaster(bike.body.localToWorld(new Vector3(0.6, exhaustAxisY(z) + 0.066, z)), direction);
        const lower = new Raycaster(bike.body.localToWorld(new Vector3(0.6, exhaustAxisY(z), z)), direction);
        expect(upper.intersectObjects(probes, false)[0]?.object.name).toBe('supermoto-side-cover');
        expect(lower.intersectObjects(probes, false)[0]?.object.name).toBe('single-exhaust');
      }
    } finally { material.dispose(); }
  });

  it('leaves a real air gap between both plastic skins / liner and the complete muffler surface', () => {
    const material = new MeshBasicMaterial({ side: DoubleSide });
    const can = bike.body.getObjectByName('single-exhaust') as Mesh;
    const proxy = new Mesh(can.geometry, material); proxy.matrixWorld.copy(can.matrixWorld);
    const exhaustParts = ['single-exhaust', 'open-silencer-outlet', 'exhaust-mount-band']
      .map(name => bike.body.getObjectByName(name) as Mesh);
    const exhaustProbes = exhaustParts.map(source => {
      const mesh = new Mesh(source.geometry, material); mesh.matrixWorld.copy(source.matrixWorld); return mesh;
    });
    const faces: Triangle[] = [];
    for (const source of exhaustParts) {
      const cp = source.geometry.getAttribute('position'), ci = source.geometry.index!;
      for (let i = 0; i < ci.count; i += 3) {
        const [a, b, c] = [0, 1, 2].map(k => new Vector3().fromBufferAttribute(cp, ci.getX(i + k)).applyMatrix4(source.matrixWorld));
        faces.push(new Triangle(a, b, c));
      }
    }
    const parts = [...bike.body.getObjectsByProperty('name', 'supermoto-side-cover'),
      bike.body.getObjectByName('supermoto-under-tail-liner')!] as Mesh[];
    const direction = new Vector3(0.713, 0.219, 0.665).normalize(), closest = new Vector3();
    let minimum = Infinity;
    let minimumAt = '';
    try {
      for (const part of parts) {
        const p = part.geometry.getAttribute('position');
        for (let i = 0; i < p.count; i++) {
          const point = new Vector3().fromBufferAttribute(p, i).applyMatrix4(part.matrixWorld);
          if (point.x < 0.05 || point.z < 0.42 || point.z > 0.89) continue;
          const hits = new Raycaster(point, direction).intersectObject(proxy, false).map(hit => hit.distance)
            .filter((d, n, all) => n === 0 || d - all[n - 1] > 1e-6);
          expect(hits.length % 2, `${part.name} inside can at ${bike.body.worldToLocal(point.clone()).toArray().join(',')}`).toBe(0);
          for (const face of faces) {
            const gap = face.closestPointToPoint(point, closest).distanceTo(point);
            if (gap < minimum) {
              minimum = gap;
              minimumAt = `${part.name} ${bike.body.worldToLocal(point.clone()).toArray().join(',')}`;
            }
          }
        }
        // Test triangle edges too: two closed surfaces can cross between
        // vertices even when all of their sampled vertices are outside.
        const index = part.geometry.index!;
        for (let i = 0; i < index.count; i += 3) {
          const vertices = [0, 1, 2].map(k => new Vector3().fromBufferAttribute(p, index.getX(i + k)).applyMatrix4(part.matrixWorld));
          if (vertices.every(point => point.x < 0.05 || point.z < 0.42 || point.z > 0.89)) continue;
          for (let j = 0; j < 3; j++) {
            const start = vertices[j], end = vertices[(j + 1) % 3], delta = end.clone().sub(start);
            const distance = delta.length();
            if (distance < 1e-8) continue;
            expect(new Raycaster(start, delta.normalize(), 0, distance).intersectObjects(exhaustProbes, false),
              `${part.name} face intersects the can`).toHaveLength(0);
          }
        }
      }
      expect(minimum, `both skins retain at least 6 mm of sampled thermal clearance (${minimumAt})`).toBeGreaterThan(0.006);
    } finally { material.dispose(); }
  });

  it('keeps the left return straight, the rear blade narrow and the tail contact height unchanged', () => {
    const cover = (bike.body.getObjectsByProperty('name', 'supermoto-side-cover') as Mesh[])
      .find(part => part.geometry.getAttribute('position').getX(0) < 0)!;
    const p = cover.geometry.getAttribute('position'), boundary = cover.geometry.userData.sideBoundaryCount as number;
    const lower = [];
    for (let i = 0; i < boundary; i++) {
      const y = p.getY(i), z = p.getZ(i);
      if (z >= 0.535 && z <= 0.735 && y < 0.93) lower.push({ y, z, x: p.getX(i) });
    }
    expect(lower.length).toBeGreaterThan(8);
    for (const point of lower) {
      expect(Math.abs(point.y - (0.847 + (point.z - 0.535) * 0.36))).toBeLessThan(1e-6);
      expect(Math.abs(point.x)).toBeLessThan(0.165);
    }
    const tail = bike.body.getObjectByName('supermoto-tail-fender') as Mesh;
    const tp = tail.geometry.getAttribute('position');
    const rear = Array.from({ length: tp.count }, (_, i) => new Vector3().fromBufferAttribute(tp, i)).filter(p => p.z > 0.90);
    expect(Math.max(...rear.map(p => Math.abs(p.x)))).toBeLessThan(0.076);
    expect(Math.max(...rear.map(p => p.z))).toBeCloseTo(0.95, 6);
    const tip = rear.filter(point => Math.abs(point.x) < 1e-6 && point.z > 0.949);
    expect(Math.max(...tip.map(point => point.y))).toBeCloseTo(1.034, 6);
  });

  it('keeps the inner thermal channel concealed behind each actual outer panel', () => {
    const material = new MeshBasicMaterial({ side: DoubleSide });
    const liner = bike.body.getObjectByName('supermoto-under-tail-liner') as Mesh;
    const linerProbe = new Mesh(liner.geometry, material); linerProbe.matrixWorld.copy(liner.matrixWorld);
    let samples = 0;
    try {
      for (const cover of bike.body.getObjectsByProperty('name', 'supermoto-side-cover') as Mesh[]) {
        const probe = new Mesh(cover.geometry, material); probe.matrixWorld.copy(cover.matrixWorld);
        const side = Math.sign(cover.geometry.getAttribute('position').getX(0));
        for (let z = 0.445; z < 0.825; z += 0.01) for (let y = 0.79; y < 1; y += 0.01) {
          const ray = new Raycaster(bike.body.localToWorld(new Vector3(side * 0.6, y, z)),
            new Vector3(-side, 0, 0).transformDirection(bike.body.matrixWorld));
          const skin = ray.intersectObject(probe, false)[0];
          if (!skin) continue;
          const backing = ray.intersectObject(linerProbe, false)[0];
          if (!backing) continue;
          samples++;
          expect(backing.distance - skin.distance, `liner shows through skin at ${side},${y},${z}`).toBeGreaterThan(-0.0001);
        }
      }
      expect(samples).toBeGreaterThan(20);
    } finally { material.dispose(); }
  });
});
