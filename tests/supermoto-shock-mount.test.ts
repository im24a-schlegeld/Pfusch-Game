import { describe, expect, it, vi } from 'vitest';
import { Box3, CylinderGeometry, DoubleSide, Group, InstancedMesh, Line3, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeBike } from '../app/game/vehicle';
import { SUPERMOTO_SHOCK_BOTTOM, SUPERMOTO_SHOCK_TOP } from '../app/game/supermotoFit';
import { SUPERMOTO_SHOCK_LOWER_MOUNT } from '../app/game/supermotoShockMount';
import { envelope, faces, gap, triangleGap } from './helpers/solidClearance';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(), fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(), accessoryMaterial: () => new MeshStandardMaterial(),
}));
const point = (p: readonly [number, number, number]) => new Vector3(...p);
const shockNames = ['supermoto-shock-damper', 'supermoto-shock-reservoir',
  'supermoto-shock-spring-seat', 'supermoto-shock-eyelet', 'rear-shock-spring',
  'supermoto-shock-upper-body', 'supermoto-shock-reservoir-cap', 'supermoto-shock-reservoir-neck'];
const mountNames = ['shock-lower-link', 'supermoto-shock-lower-pin'];
const sourceNames = [...shockNames, ...mountNames];
const partsNamed = (body: Group, names: string[]) => names.flatMap(name => body.getObjectsByProperty('name', name)) as Mesh[];

describe('compact direct Supermoto shock mount', () => {
  it('welds both short clevis ears to the real arm bridge and supports the upper eye from the frame', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    const rear = bike.body.getObjectByName('rear-suspension-axle') as Group;
    const axis = (part: Mesh<CylinderGeometry>) => {
      const half = part.geometry.parameters.height / 2;
      return new Line3(new Vector3(0, -half, 0).applyMatrix4(part.matrix), new Vector3(0, half, 0).applyMatrix4(part.matrix));
    };
    expect(partsNamed(bike.body, ['supermoto-linkage-rocker', 'supermoto-linkage-dogbone',
      'supermoto-linkage-frame-pin', 'supermoto-linkage-frame-tab'])).toHaveLength(0);
    const cheeks = partsNamed(bike.body, ['shock-lower-link']);
    expect(cheeks).toHaveLength(2);
    for (const travel of [-0.2, 0, 0.2]) {
      bike.animateSuspension(0, travel); bike.root.updateMatrixWorld(true);
      const inverse = bike.body.matrixWorld.clone().invert();
      const bridge = bike.body.getObjectByName('swingarm-crossmember') as Mesh<CylinderGeometry>;
      const bridgeAxis = axis(bridge);
      const base = point(SUPERMOTO_SHOCK_LOWER_MOUNT.bridge).applyMatrix4(rear.matrix);
      expect(bridgeAxis.closestPointToPoint(base, true, new Vector3()).distanceTo(base)).toBeLessThan(1e-10);
      for (const cheek of cheeks) {
        const root = base.clone().setX(Math.sign(envelope(cheek, inverse).getCenter(new Vector3()).x) * 0.033);
        expect(envelope(cheek, inverse).distanceToPoint(root)).toBeLessThan(1e-10);
        let minimum = Infinity;
        for (const a of faces(cheek, inverse)) for (const b of faces(bridge, inverse)) {
          if (gap(a.bounds, b.bounds) > 0.001) continue;
          minimum = Math.min(minimum, triangleGap(a.triangle, b.triangle));
        }
        expect(minimum, 'formed ear is physically welded to the bridge').toBeLessThan(0.001);
      }
      const frameBridge = axis(bike.body.getObjectByName('shock-frame-crossmember') as Mesh<CylinderGeometry>);
      for (const brace of partsNamed(bike.body, ['supermoto-shock-upper-brace']) as Mesh<CylinderGeometry>[]) {
        const line = axis(brace);
        expect(frameBridge.closestPointToPoint(line.start, true, new Vector3()).distanceTo(line.start)).toBeLessThan(1e-8);
        expect(line.end.clone().setX(0).distanceTo(point(SUPERMOTO_SHOCK_TOP))).toBeLessThan(1e-8);
      }
    }
  });

  it('drives the actual lower eye directly with the rigid arm while shortening the damper and restoring rest', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    const rear = bike.body.getObjectByName('rear-suspension-axle') as Group;
    const shock = bike.body.getObjectByName('active-rear-shock') as Group;
    const top = point(SUPERMOTO_SHOCK_TOP), bottom = point(SUPERMOTO_SHOCK_BOTTOM);
    const parts = partsNamed(bike.body, sourceNames);
    expect(parts).toHaveLength(14);
    const geometry = parts.map(part => part.geometry), children = [...bike.body.children];
    bike.root.updateMatrixWorld(true);
    const settled = parts.map(part => part.matrixWorld.clone());
    const damper = bike.body.getObjectByName('supermoto-shock-damper') as Mesh<CylinderGeometry>;
    const pin = bike.body.getObjectByName('supermoto-shock-lower-pin') as Mesh;
    const half = damper.geometry.parameters.height / 2, lengths: number[] = [];
    for (const travel of [-0.2, -0.025, 0, 0.025, 0.06, 0.2]) {
      bike.animateSuspension(0, travel); bike.root.updateMatrixWorld(true);
      const lower = bottom.clone().applyMatrix4(rear.matrix);
      expect(bottom.clone().applyMatrix4(shock.matrix).distanceTo(lower)).toBeLessThan(1e-10);
      expect(top.clone().applyMatrix4(shock.matrix).distanceTo(top)).toBeLessThan(1e-10);
      expect(new Vector3().setFromMatrixPosition(pin.matrix).distanceTo(lower)).toBeLessThan(1e-10);
      for (const mount of partsNamed(bike.body, mountNames)) expect(mount.matrix.determinant()).toBeCloseTo(1, 10);
      const inverse = bike.body.matrixWorld.clone().invert();
      const a = new Vector3(0, -half, 0).applyMatrix4(damper.matrixWorld).applyMatrix4(inverse);
      const b = new Vector3(0, half, 0).applyMatrix4(damper.matrixWorld).applyMatrix4(inverse);
      expect(a.distanceTo(top)).toBeLessThan(1e-10); expect(b.distanceTo(lower)).toBeLessThan(1e-10);
      expect(a.distanceTo(b)).toBeCloseTo(top.distanceTo(lower), 12);
      lengths.push(a.distanceTo(b));
      expect(parts.map(part => part.geometry)).toEqual(geometry); expect(bike.body.children).toEqual(children);
    }
    for (let i = 1; i < lengths.length; i++) expect(lengths[i]).toBeLessThanOrEqual(lengths[i - 1]);
    expect(lengths[0] - lengths.at(-1)!).toBeGreaterThan(0);
    bike.animateSuspension(0, 0); bike.root.updateMatrixWorld(true);
    for (const [i, part] of parts.entries()) for (const [k, value] of part.matrixWorld.elements.entries())
      expect(value).toBeCloseTo(settled[i].elements[k], 10);
  });

  it('keeps every moving shock and clevis solid clear of tyre, frame, engine and exhaust', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    const moving = partsNamed(bike.body, sourceNames), obstacles: Mesh[] = [];
    bike.body.traverse(part => {
      if (part instanceof Mesh && (part.name.startsWith('engine-')
        || /^supermoto-(frame-|rear-subframe|lower-cradle|cradle-crossmember)/.test(part.name)
        || ['connected-exhaust-pipe', 'single-exhaust', 'box-section-swingarm'].includes(part.name))) obstacles.push(part);
    });
    obstacles.push(bike.wheels[1].getObjectByName('tire') as Mesh);
    const failures: string[] = [];
    for (const travel of [-0.2, 0, 0.2]) {
      bike.animateSuspension(0.85, travel, 1); bike.root.updateMatrixWorld(true);
      const inverse = bike.body.matrixWorld.clone().invert();
      const targets = obstacles.map(part => ({ part, bounds: envelope(part, inverse), faces: faces(part, inverse) }));
      for (const part of moving) {
        const bounds = envelope(part, inverse); let source: ReturnType<typeof faces> | undefined;
        for (const target of targets) {
          const threshold = target.part.name === 'tire' ? 0.008 : 0.003;
          if (gap(bounds, target.bounds) > threshold) continue;
          source ??= faces(part, inverse); let minimum = Infinity;
          for (const a of source) for (const b of target.faces) {
            if (gap(a.bounds, b.bounds) > Math.min(minimum, threshold)) continue;
            minimum = Math.min(minimum, triangleGap(a.triangle, b.triangle));
          }
          if (minimum <= threshold) failures.push(`${part.name}/${target.part.name}: ${minimum}, travel ${travel}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('aligns the open clevis holes with the pin and leaves every moving chain link clear', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    const rear = bike.body.getObjectByName('rear-suspension-axle') as Group;
    const finish = new MeshBasicMaterial({ side: DoubleSide });
    const cheeks = partsNamed(bike.body, ['shock-lower-link']);
    const probes = cheeks.map(part => ({ part, probe: new Mesh(part.geometry, finish) }));
    const mounts = partsNamed(bike.body, mountNames);
    const chains = ['left-drive-chain', 'chain-rollers'].map(name => bike.body.getObjectByName(name) as InstancedMesh);
    const instance = new Matrix4(), transform = new Matrix4(), vertex = new Vector3();
    try {
      for (const travel of [-0.2, 0, 0.2]) {
        bike.animateSuspension(0, travel); bike.root.updateMatrixWorld(true);
        const inverse = bike.body.matrixWorld.clone().invert();
        const eye = point(SUPERMOTO_SHOCK_BOTTOM).applyMatrix4(rear.matrix);
        const direction = new Vector3(1, 0, 0).transformDirection(bike.body.matrixWorld);
        for (const { part, probe } of probes) {
          probe.matrixWorld.copy(part.matrixWorld);
          const origin = eye.clone().setX(-0.2).applyMatrix4(bike.body.matrixWorld);
          expect(new Raycaster(origin, direction).intersectObject(probe, false)).toHaveLength(0);
          origin.copy(eye).setX(-0.2).add(new Vector3(0, 0.0125, 0)).applyMatrix4(bike.body.matrixWorld);
          expect(new Raycaster(origin, direction).intersectObject(probe, false).length).toBeGreaterThan(0);
        }
        const targets = mounts.map(part => ({ bounds: envelope(part, inverse), faces: faces(part, inverse) }));
        for (const chain of chains) {
          const positions = chain.geometry.getAttribute('position'), chainProbe = new Mesh(chain.geometry, finish);
          for (let index = 0; index < chain.count; index++) {
            chain.getMatrixAt(index, instance); transform.copy(inverse).multiply(chain.matrixWorld).multiply(instance);
            const bounds = new Box3();
            for (let i = 0; i < positions.count; i++) bounds.expandByPoint(vertex.fromBufferAttribute(positions, i).applyMatrix4(transform));
            for (const target of targets) {
              if (gap(target.bounds, bounds) > 0.006) continue;
              chainProbe.matrixWorld.multiplyMatrices(chain.matrixWorld, instance); let minimum = Infinity;
              for (const a of target.faces) for (const b of faces(chainProbe, inverse)) {
                if (gap(a.bounds, b.bounds) > Math.min(minimum, 0.006)) continue;
                minimum = Math.min(minimum, triangleGap(a.triangle, b.triangle));
              }
              expect(minimum).toBeGreaterThan(0.006);
            }
          }
        }
      }
    } finally { finish.dispose(); }
  });
});
