import { describe, expect, it, vi } from 'vitest';
import { Box3, CylinderGeometry, DoubleSide, Group, InstancedMesh, Line3, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeBike } from '../app/game/vehicle';
import { SUPERMOTO_SHOCK_BOTTOM, SUPERMOTO_SHOCK_TOP } from '../app/game/supermotoFit';
import { SUPERMOTO_LINKAGE, solveSupermotoLinkage } from '../app/game/supermotoLinkage';
import { envelope, faces, gap, triangleGap } from './helpers/solidClearance';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(), fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(), accessoryMaterial: () => new MeshStandardMaterial(),
}));
const point = (p: readonly [number, number, number]) => new Vector3(...p);
const sourceNames = ['supermoto-linkage-rocker', 'supermoto-linkage-dogbone',
  'supermoto-linkage-rocker-pin', 'supermoto-linkage-frame-pin', 'shock-lower-link',
  'supermoto-linkage-frame-tab', 'supermoto-shock-damper', 'supermoto-shock-reservoir',
  'supermoto-shock-spring-seat', 'supermoto-shock-eyelet', 'rear-shock-spring'];

describe('articulated Supermoto shock linkage', () => {
  it('attaches the linkage to the real arm bridge and cradle, and the shock to both upper rails', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    const rear = bike.body.getObjectByName('rear-suspension-axle') as Group;
    const members = (name: string) => bike.body.getObjectsByProperty('name', name) as Mesh<CylinderGeometry>[];
    const axis = (part: Mesh<CylinderGeometry>) => {
      const half = part.geometry.parameters.height / 2;
      return new Line3(new Vector3(0, -half, 0).applyMatrix4(part.matrix), new Vector3(0, half, 0).applyMatrix4(part.matrix));
    };
    for (const travel of [-0.2, 0, 0.2]) {
      bike.animateSuspension(0, travel); bike.root.updateMatrixWorld(true);
      const pose = solveSupermotoLinkage(rear.matrix);
      const bridge = axis(members('swingarm-crossmember')[0]);
      for (const clevis of members('shock-lower-link')) {
        const line = axis(clevis);
        expect(bridge.closestPointToPoint(line.start, true, new Vector3()).distanceTo(line.start)).toBeLessThan(1e-8);
        expect(line.end.clone().setX(0).distanceTo(pose.pivot)).toBeLessThan(1e-8);
      }
      for (const tab of members('supermoto-linkage-frame-tab')) {
        const line = axis(tab), side = Math.sign(line.start.x);
        expect(line.end.clone().setX(0).distanceTo(point(SUPERMOTO_LINKAGE.frame))).toBeLessThan(1e-8);
        const cradle = bike.body.getObjectsByProperty('name', 'supermoto-frame-merge-branch') as Mesh[];
        const facesOnSide = cradle.flatMap(part => faces(part, bike.body.matrixWorld.clone().invert()))
          .filter(face => Math.sign(face.bounds.getCenter(new Vector3()).x) === side);
        const nearest = Math.min(...facesOnSide.map(face => face.triangle.closestPointToPoint(line.start, new Vector3()).distanceTo(line.start)));
        expect(nearest, 'frame tab root must be seated within the real cradle tube').toBeLessThan(0.017);
      }
      const rails = members('supermoto-upper-subframe').map(axis);
      for (const brace of members('supermoto-shock-upper-brace')) {
        const line = axis(brace);
        expect(Math.min(...rails.map(rail => rail.closestPointToPoint(line.start, true, new Vector3()).distanceTo(line.start)))).toBeLessThan(1e-8);
        expect(line.end.clone().setX(0).distanceTo(point(SUPERMOTO_SHOCK_TOP))).toBeLessThan(1e-8);
      }
    }
  });

  it('closes the actual rigid dogbone and rocker through the full travel while preserving all meshes', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    const rear = bike.body.getObjectByName('rear-suspension-axle') as Group;
    const shock = bike.body.getObjectByName('active-rear-shock') as Group;
    const frame = point(SUPERMOTO_LINKAGE.frame), top = point(SUPERMOTO_SHOCK_TOP);
    const authored = solveSupermotoLinkage(new Matrix4());
    expect(authored.dogbone.distanceTo(point(SUPERMOTO_LINKAGE.dogbone))).toBeLessThan(1e-12);
    expect(authored.shock.distanceTo(point(SUPERMOTO_SHOCK_BOTTOM))).toBeLessThan(1e-12);
    const parts = sourceNames.flatMap(name => bike.body.getObjectsByProperty('name', name)) as Mesh[];
    const geometry = parts.map(part => part.geometry), children = [...bike.body.children];
    const pins = bike.body.getObjectsByProperty('name', 'supermoto-linkage-rocker-pin') as Mesh[];
    const rocker = bike.body.getObjectsByProperty('name', 'supermoto-linkage-rocker') as Mesh[];
    const dogbones = bike.body.getObjectsByProperty('name', 'supermoto-linkage-dogbone') as Mesh[];
    expect(pins).toHaveLength(3); expect(rocker).toHaveLength(2); expect(dogbones).toHaveLength(2);
    const lengths: number[] = [];
    for (const travel of [-0.2, -0.025, 0, 0.025, 0.06, 0.2]) {
      bike.animateSuspension(0, travel); bike.root.updateMatrixWorld(true);
      const pose = solveSupermotoLinkage(rear.matrix);
      expect(pose.dogbone.distanceTo(frame)).toBeCloseTo(authored.dogbone.distanceTo(frame), 12);
      for (const [a, b] of [['pivot', 'dogbone'], ['pivot', 'shock'], ['dogbone', 'shock']] as const)
        expect(pose[a].distanceTo(pose[b])).toBeCloseTo(authored[a].distanceTo(authored[b]), 12);
      for (const plate of [...rocker, ...dogbones]) expect(plate.matrix.determinant()).toBeCloseTo(1, 10);
      for (const [index, eye] of [pose.pivot, pose.dogbone, pose.shock].entries()) {
        expect(new Vector3().setFromMatrixPosition(pins[index].matrix).distanceTo(eye)).toBeLessThan(1e-10);
        const radius = (pins[index].geometry as CylinderGeometry).parameters.radiusTop;
        expect(radius).toBeCloseTo(0.010, 8);
      }
      expect(point(SUPERMOTO_SHOCK_BOTTOM).applyMatrix4(shock.matrix).distanceTo(pose.shock)).toBeLessThan(1e-10);
      expect(top.clone().applyMatrix4(shock.matrix).distanceTo(top)).toBeLessThan(1e-10);
      lengths.push(top.distanceTo(pose.shock));
      expect(parts.map(part => part.geometry)).toEqual(geometry);
      expect(bike.body.children).toEqual(children);
    }
    for (let i = 1; i < lengths.length; i++) expect(lengths[i]).toBeLessThanOrEqual(lengths[i - 1]);
    expect(lengths[0] - lengths.at(-1)!).toBeGreaterThan(0.025);
  });

  it('keeps every moving linkage and shock solid clear of tyre, frame, engine and exhaust', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    const moving = sourceNames.filter(name => !name.includes('frame-tab') && !name.includes('frame-pin'))
      .flatMap(name => bike.body.getObjectsByProperty('name', name)) as Mesh[];
    const obstacles: Mesh[] = [];
    bike.body.traverse(part => {
      if (part instanceof Mesh && (part.name.startsWith('engine-')
        || /^supermoto-(frame-|rear-subframe|lower-cradle|cradle-crossmember)/.test(part.name)
        || ['connected-exhaust-pipe', 'single-exhaust', 'box-section-swingarm'].includes(part.name))) obstacles.push(part);
    });
    obstacles.push(bike.wheels[1].getObjectByName('tire') as Mesh);
    expect(obstacles.length).toBeGreaterThan(10);
    const failures: string[] = [];
    for (const travel of [-0.2, 0, 0.2]) {
      bike.animateSuspension(0.85, travel, 1); bike.root.updateMatrixWorld(true);
      const inverse = bike.body.matrixWorld.clone().invert();
      const targets = obstacles.map(part => ({ part, bounds: envelope(part, inverse), faces: faces(part, inverse) }));
      for (const movingPart of moving) {
        const bounds = envelope(movingPart, inverse);
        let movingFaces: ReturnType<typeof faces> | undefined;
        for (const target of targets) {
          const threshold = target.part.name === 'tire' ? 0.008 : 0.003;
          if (gap(bounds, target.bounds) > threshold) continue;
          movingFaces ??= faces(movingPart, inverse);
          let minimum = Infinity, at = '';
          for (const a of movingFaces) for (const b of target.faces) {
            if (gap(a.bounds, b.bounds) > Math.min(minimum, threshold)) continue;
            const distance = triangleGap(a.triangle, b.triangle);
            if (distance < minimum) { minimum = distance; at = a.triangle.getMidpoint(new Vector3()).toArray().join(','); }
          }
          if (minimum <= threshold) failures.push(`${movingPart.name}/${target.part.name}: ${minimum} at ${at}, travel ${travel}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('aligns the real machined holes with their pins and leaves the full chain clear', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    const rear = bike.body.getObjectByName('rear-suspension-axle') as Group;
    const finish = new MeshBasicMaterial({ side: DoubleSide });
    const rocks = bike.body.getObjectsByProperty('name', 'supermoto-linkage-rocker') as Mesh[];
    const dogs = bike.body.getObjectsByProperty('name', 'supermoto-linkage-dogbone') as Mesh[];
    const plates = [...rocks, ...dogs].map(part => ({ part, probe: new Mesh(part.geometry, finish) }));
    const linkage = sourceNames.filter(name => !name.startsWith('supermoto-shock') && name !== 'rear-shock-spring')
      .flatMap(name => bike.body.getObjectsByProperty('name', name)) as Mesh[];
    const chains = ['left-drive-chain', 'chain-rollers'].map(name => bike.body.getObjectByName(name) as InstancedMesh);
    const instance = new Matrix4(), transform = new Matrix4(), vertex = new Vector3();
    try {
      for (const travel of [-0.2, 0, 0.2]) {
        bike.animateSuspension(0, travel); bike.root.updateMatrixWorld(true);
        const inverse = bike.body.matrixWorld.clone().invert(), pose = solveSupermotoLinkage(rear.matrix);
        const direction = new Vector3(1, 0, 0).transformDirection(bike.body.matrixWorld);
        for (const { part, probe } of plates) {
          probe.matrixWorld.copy(part.matrixWorld);
          const eyes = rocks.includes(part) ? [pose.pivot, pose.dogbone, pose.shock] : [point(SUPERMOTO_LINKAGE.frame), pose.dogbone];
          for (const eye of eyes) {
            const origin = eye.clone().setX(-0.2).applyMatrix4(bike.body.matrixWorld);
            expect(new Raycaster(origin, direction).intersectObject(probe, false), `${part.name} hole must remain open`).toHaveLength(0);
            origin.copy(eye).setX(-0.2).add(new Vector3(0, 0.0125, 0)).applyMatrix4(bike.body.matrixWorld);
            expect(new Raycaster(origin, direction).intersectObject(probe, false).length, `${part.name} must retain solid material around hole`).toBeGreaterThan(0);
          }
        }
        const linkageTargets = linkage.map(part => ({ part, bounds: envelope(part, inverse), faces: faces(part, inverse) }));
        for (const chain of chains) {
          expect(chain).toBeInstanceOf(InstancedMesh);
          const positions = chain.geometry.getAttribute('position');
          const chainProbe = new Mesh(chain.geometry, finish);
          for (let index = 0; index < chain.count; index++) {
            chain.getMatrixAt(index, instance);
            transform.copy(inverse).multiply(chain.matrixWorld).multiply(instance);
            const chainBounds = new Box3();
            for (let i = 0; i < positions.count; i++) chainBounds.expandByPoint(vertex.fromBufferAttribute(positions, i).applyMatrix4(transform));
            for (const target of linkageTargets) {
              if (gap(target.bounds, chainBounds) > 0.006) continue;
              chainProbe.matrixWorld.multiplyMatrices(chain.matrixWorld, instance);
              let minimum = Infinity, at = '';
              for (const a of target.faces) for (const b of faces(chainProbe, inverse)) {
                if (gap(a.bounds, b.bounds) > Math.min(minimum, 0.006)) continue;
                const distance = triangleGap(a.triangle, b.triangle);
                if (distance < minimum) { minimum = distance; at = a.triangle.getMidpoint(new Vector3()).toArray().join(','); }
              }
              expect(minimum, `${target.part.name}/${chain.name} link ${index}, travel ${travel}, near ${at}`).toBeGreaterThan(0.006);
            }
          }
        }
      }
    } finally { finish.dispose(); }
  });
});
