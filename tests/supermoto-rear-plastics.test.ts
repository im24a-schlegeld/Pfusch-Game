import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DoubleSide, Mesh, MeshBasicMaterial, MeshStandardMaterial, Raycaster, Triangle, Vector3 } from 'three';
import { newPlayer } from '../app/domain/progression';
import { exhaustAxisY, TUBE_EXHAUST } from '../app/game/exhaustClearance';
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
      for (const z of [0.56, 0.60, 0.65, 0.70]) {
        const direction = new Vector3(-1, 0, 0).transformDirection(bike.body.matrixWorld);
        const upper = new Raycaster(bike.body.localToWorld(new Vector3(0.6, exhaustAxisY(z) + TUBE_EXHAUST.verticalRadius * 0.98, z)), direction);
        const lower = new Raycaster(bike.body.localToWorld(new Vector3(0.6, exhaustAxisY(z) + TUBE_EXHAUST.verticalRadius * 0.73, z)), direction);
        expect(upper.intersectObjects(probes, false)[0]?.object.name).toBe('supermoto-side-cover');
        expect(upper.intersectObject(probes[probes.length - 1], false).length,
          'upper overlap must cover real alloy, not just empty space above the can').toBeGreaterThan(0);
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
          if (point.x < -0.03 || point.z < 0.42 || point.z > 0.89) continue;
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
          if (vertices.every(point => point.x < -0.03 || point.z < 0.42 || point.z > 0.89)) continue;
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

  it('keeps the left return straight and raises a shorter narrow blade behind the shallow covers', () => {
    const cover = (bike.body.getObjectsByProperty('name', 'supermoto-side-cover') as Mesh[])
      .find(part => part.geometry.getAttribute('position').getX(0) < 0)!;
    const p = cover.geometry.getAttribute('position'), boundary = cover.geometry.userData.sideBoundaryCount as number;
    const frontTip = Array.from({ length: boundary }, (_, i) => new Vector3().fromBufferAttribute(p, i))
      .filter(point => Math.abs(point.z - 0.278) < 1e-6);
    expect(Math.min(...frontTip.map(point => point.y))).toBeCloseTo(0.705, 6);
    const lower = [];
    for (let i = 0; i < boundary; i++) {
      const y = p.getY(i), z = p.getZ(i);
      if (z >= 0.530 && z <= 0.715 && y < 0.97) lower.push({ y, z, x: p.getX(i) });
    }
    expect(lower.length).toBeGreaterThan(8);
    for (const point of lower) {
      const expected = point.z <= 0.625
        ? 0.894 + (point.z - 0.530) * (0.929 - 0.894) / (0.625 - 0.530)
        : 0.929 + (point.z - 0.625) * (0.965 - 0.929) / (0.715 - 0.625);
      expect(Math.abs(point.y - expected)).toBeLessThan(1e-6);
      expect(Math.abs(point.x)).toBeLessThan(0.140);
    }
    const right = (bike.body.getObjectsByProperty('name', 'supermoto-side-cover') as Mesh[])
      .find(part => part.geometry.getAttribute('position').getX(0) > 0)!;
    const rp = right.geometry.getAttribute('position');
    expect(Math.max(...Array.from({ length: rp.count }, (_, i) => rp.getX(i)))).toBeLessThan(0.155);
    const lowerEdge = new Map<number, number>();
    for (let i = 0; i < right.geometry.userData.sideBoundaryCount; i++) {
      const z = rp.getZ(i);
      if (z < 0.278 || z > 0.730) continue;
      lowerEdge.set(z, Math.min(lowerEdge.get(z) ?? Infinity, rp.getY(i)));
    }
    const ordered = [...lowerEdge].sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < ordered.length; i++)
      expect(ordered[i][1] - ordered[i - 1][1], `no notch before the can at z ${ordered[i][0]}`).toBeGreaterThanOrEqual(-1e-6);
    const tail = bike.body.getObjectByName('supermoto-tail-fender') as Mesh;
    const tp = tail.geometry.getAttribute('position');
    const rear = Array.from({ length: tp.count }, (_, i) => new Vector3().fromBufferAttribute(tp, i)).filter(p => p.z > 0.84);
    expect(Math.max(...rear.map(p => Math.abs(p.x)))).toBeLessThan(0.062);
    expect(Math.max(...rear.map(p => p.z))).toBeCloseTo(0.90, 6);
    const tip = rear.filter(point => Math.abs(point.x) < 1e-6 && point.z > 0.899);
    expect(Math.max(...tip.map(point => point.y))).toBeCloseTo(1.079, 6);
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

  it('fits the complete rear lamp beneath the real blade without a floating housing', () => {
    const source = bike.body.getObjectByName('supermoto-tail-fender') as Mesh;
    const material = new MeshBasicMaterial({ side: DoubleSide });
    const probe = new Mesh(source.geometry, material); probe.matrixWorld.copy(source.matrixWorld);
    try {
      for (const name of ['supermoto-tail-light-housing', 'supermoto-tail-light-lens']) {
        const part = bike.body.getObjectByName(name) as Mesh;
        const positions = part.geometry.getAttribute('position');
        let closestRoof = Infinity;
        for (let i = 0; i < positions.count; i++) {
          const point = bike.body.worldToLocal(new Vector3().fromBufferAttribute(positions, i).applyMatrix4(part.matrixWorld));
          const ray = new Raycaster(bike.body.localToWorld(new Vector3(point.x, 0, point.z)),
            new Vector3(0, 1, 0).transformDirection(bike.body.matrixWorld));
          const roof = ray.intersectObject(probe, false)[0];
          expect(roof, `${name} must stay inside the blade outline`).toBeDefined();
          const gap = bike.body.worldToLocal(roof.point.clone()).y - point.y;
          expect(gap, `${name} must not protrude above the blade underside`).toBeGreaterThan(-0.002);
          closestRoof = Math.min(closestRoof, Math.abs(gap));
        }
        expect(closestRoof, `${name} must meet the blade, rather than float beneath it`).toBeLessThan(0.004);
      }
    } finally { material.dispose(); }
  });
});
