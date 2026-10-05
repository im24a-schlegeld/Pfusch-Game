import { installImportedBikeFixtures } from './importedBikeFixture';
installImportedBikeFixtures();
import { describe, expect, it, vi } from 'vitest';
import { Box3, Color, Line3, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeBike } from '../app/game/vehicle';
import { getImportedBikeAsset } from '../app/game/importedBikeAsset';
import { IMPORTED_BIKE_WHEELBASE } from '../app/game/importedBikeDimensions';
vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(), fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(), accessoryMaterial: () => new MeshStandardMaterial(),
}));
function rodAxis(part: Mesh) {
  // The Supermoto silencer is an authored lathe, while forks and the other
  // silencers are cylinders. Both have their axial extent along local Y.
  part.geometry.computeBoundingBox();
  const bounds = part.geometry.boundingBox!;
  part.updateMatrix();
  return new Line3(
    new Vector3(0, bounds.min.y, 0).applyMatrix4(part.matrix),
    new Vector3(0, bounds.max.y, 0).applyMatrix4(part.matrix),
  );
}

function ringCenter(part: Mesh, ring: number, sides = 14) {
  const vertices = part.geometry.getAttribute('position');
  const result = new Vector3();
  for (let i = 0; i < sides; i++)
    result.add(
      new Vector3().fromBufferAttribute(vertices, ring * (sides + 1) + i),
    );
  return result.divideScalar(sides);
}

describe('assembled motorcycle connections', () => {
  it('keeps the Töffli yokes and bearings coaxial with its actual fork legs and steering head', () => {
    const bike = makeBike({ ...newPlayer(), bike: '125' }, []);
    const forks = bike.body.getObjectsByProperty('name', 'telescopic-fork-slider') as Mesh[];
    const yokes = bike.body.getObjectsByProperty('name', 'fork-yoke') as Mesh[];
    expect(forks).toHaveLength(2); expect(yokes).toHaveLength(2);
    const nearest = new Vector3();
    for (const yoke of yokes) for (const end of [rodAxis(yoke).start, rodAxis(yoke).end]) {
      const fork = forks.find(part => Math.sign(part.position.x) === Math.sign(end.x))!;
      expect(rodAxis(fork).closestPointToPoint(end, true, nearest).distanceTo(end)).toBeLessThan(1e-6);
    }
    const head = rodAxis(bike.body.getObjectByName('steering-head') as Mesh);
    for (const bearing of bike.body.getObjectsByProperty('name', 'steering-head-bearing') as Mesh[])
      expect(head.closestPointToPoint(rodAxis(bearing).getCenter(new Vector3()), true, nearest).distanceTo(rodAxis(bearing).getCenter(new Vector3()))).toBeLessThan(1e-6);
    expect(bike.wheels[0].position.z).toBe(-.7);
    for (const fork of forks) expect((fork.material as MeshStandardMaterial).color.getHexString()).toBe('101214');
  });
  it('keeps the Töffli exhaust continuously joined to its frame-mounted silencer', () => {
    const bike = makeBike({ ...newPlayer(), bike: '125' }, []);
    const pipe = bike.body.getObjectByName('connected-exhaust-pipe') as Mesh;
    const muffler = bike.body.getObjectByName('single-exhaust') as Mesh;
    const sides = 14;
    const lastRing = pipe.geometry.getAttribute('position').count / (sides + 1) - 1;
    const end = ringCenter(pipe, lastRing, sides);
    expect(rodAxis(muffler).closestPointToPoint(end, true, new Vector3()).distanceTo(end)).toBeLessThan(.016);
    const start = ringCenter(pipe, 0, sides);
    expect(start.y).toBeGreaterThan(.27); expect(start.z).toBeLessThan(-.14);
    expect(bike.body.getObjectByName('exhaust-frame-hanger')).toBeDefined();
    expect(bike.body.getObjectByName('exhaust-mount-band')).toBeDefined();
  });
  it('bridges the photographed Töffli handlebar gap and mounts its lamp and rack', () => {
    const bike = makeBike({ ...newPlayer(), bike: '125' }, []);
    const stem = bike.body.getObjectByName('handlebar-stem') as Mesh;
    const top = rodAxis(stem).end;
    expect(top.distanceTo(new Vector3(0, 1, -0.45))).toBeLessThan(0.013);
    bike.root.updateMatrixWorld(true);
    expect(
      new Box3()
        .setFromObject(stem)
        .intersectsBox(
          new Box3().setFromObject(bike.body.getObjectByName('steering-head')!),
        ),
    ).toBe(true);
    expect(
      bike.body.getObjectsByProperty('name', 'headlamp-bracket'),
    ).toHaveLength(2);
    expect(
      bike.body.getObjectsByProperty('name', 'rack-frame-mount'),
    ).toHaveLength(2);
    expect(
      bike.body.getObjectsByProperty('name', 'rack-crossbar'),
    ).toHaveLength(4);
    expect(bike.body.getObjectByName('moped-drive-belt')).toBeDefined();
    expect(bike.body.getObjectByName('left-drive-chain')).toBeUndefined();
  });

  it('joins the moderately widened Töffli upper frame into its actual steering head', () => {
    const bike = makeBike({ ...newPlayer(), bike: '125' }, []);
    const frame = bike.body.getObjectByName('moped-main-frame') as Mesh;
    const neck = rodAxis(bike.body.getObjectByName('steering-head') as Mesh);
    const frameEnd = ringCenter(frame, 22, 20);
    expect(neck.closestPointToPoint(frameEnd, true, new Vector3())
      .distanceTo(frameEnd)).toBeLessThan(0.001);
    const points = frame.geometry.getAttribute('position');
    let halfWidth = 0;
    for (let i = 0; i < points.count; i++)
      if (points.getY(i) > 0.58 && points.getY(i) < 0.82)
        halfWidth = Math.max(halfWidth, Math.abs(points.getX(i)));
    expect(halfWidth).toBeGreaterThan(0.082);
    expect(halfWidth).toBeLessThan(0.094);
  });


  it.each(['450', '701', 'scooter'] as const)('%s attaches imported forks, swingarm and shock at their actual source pivots', id => {
    const bike = makeBike({ ...newPlayer(), bike: id }, []);
    const source = getImportedBikeAsset(id).manifest.anchors;
    const size = IMPORTED_BIKE_WHEELBASE[id] / (source.rearAxle[2] - source.frontAxle[2]);
    const pivot = new Vector3(...source.pivot).multiplyScalar(size);
    const rear = bike.body.getObjectByName('rear-suspension-axle')!;
    const front = bike.body.getObjectByName('front-suspension-axle')!;
    const steering = bike.body.getObjectByName('imported-steering')!;
    expect(front.parent).toBe(steering);
    expect(bike.wheels[0].parent).toBe(front); expect(bike.wheels[1].parent).toBe(rear);
    const arms = rear.children.filter(part => part.userData.importedRig === 'swingarm');
    expect(arms.length).toBeGreaterThan(0);
    for (const travel of [-.025, 0, .12]) {
      bike.animateSuspension(.6, travel); bike.root.updateMatrixWorld(true);
      expect(pivot.clone().applyMatrix4(rear.matrix).distanceTo(pivot)).toBeLessThan(1e-9);
      for (const part of arms) expect(part.scale.toArray()).toEqual([1, 1, 1]);
      const shock = bike.body.getObjectByName('active-rear-shock')!;
      const top = new Vector3(...source.shockTop).multiplyScalar(size), bottom = new Vector3(...source.shockBottom).multiplyScalar(size);
      expect(top.clone().applyMatrix4(shock.matrix).distanceTo(top)).toBeLessThan(1e-8);
      expect(bottom.clone().applyMatrix4(shock.matrix).distanceTo(bottom.clone().applyMatrix4(rear.matrix))).toBeLessThan(1e-8);
    }
  });
  it.each(['450', '701'] as const)('%s keeps the metal caliper fixed while its steel rotor spins', id => {
    const bike = makeBike({ ...newPlayer(), bike: id }, []);
    const calipers: Mesh[] = [], rotors: Mesh[] = [];
    bike.body.traverse(part => { if (part instanceof Mesh) {
      if (/caliper/.test(part.name)) calipers.push(part);
      if (/steel/.test(part.name) && part.userData.importedRig === 'frontWheel') rotors.push(part);
    } });
    expect(calipers.length).toBeGreaterThan(0); expect(rotors.length).toBeGreaterThan(0);
    bike.animateSuspension(.35, .06); bike.root.updateMatrixWorld(true);
    const fixed = calipers.map(part => part.matrixWorld.clone());
    const rotor = rotors[0].matrixWorld.clone();
    bike.wheels[0].rotation.x = 1.3; bike.root.updateMatrixWorld(true);
    calipers.forEach((part, i) => {
      expect(part.parent?.name).toBe('front-suspension-axle');
      expect(part.matrixWorld.equals(fixed[i])).toBe(true);
      expect((part.material as MeshStandardMaterial).metalness).toBeGreaterThan(.3);
    });
    expect(rotors[0].matrixWorld.equals(rotor)).toBe(false);
    expect((rotors[0].material as MeshStandardMaterial).metalness).toBeGreaterThan(.4);
  });
  it.each(['450', '701', 'scooter'] as const)('%s paints only actual bodywork and keeps its seat and mechanics distinct', id => {
    const bike = makeBike({ ...newPlayer(), bike: id, paint: '#e33126', rims: '#27d4c5' }, []);
    const definitions = getImportedBikeAsset(id).manifest.materials;
    const painted: Mesh[] = [], seats: Mesh[] = [];
    bike.body.traverse(part => { if (!(part instanceof Mesh) || !part.userData.importedPart) return;
      if (part.userData.bikePaintSurface) painted.push(part);
      if (/seat/.test(part.name)) seats.push(part);
    });
    expect(painted.length).toBeGreaterThan(0); expect(seats.length).toBeGreaterThan(0);
    for (const part of painted) expect((part.material as MeshStandardMaterial).color.getHexString()).toBe('e33126');
    for (const part of seats) expect((part.material as MeshStandardMaterial).color.getHexString()).not.toBe('e33126');
    const trim: Mesh[] = [], tyres: Mesh[] = [];
    bike.body.traverse(part => {
      if (!(part instanceof Mesh) || !part.userData.importedPart) return;
      if (/trim|dark/.test((part.material as MeshStandardMaterial).name)) trim.push(part);
      if (part.name === 'tire') tyres.push(part);
    });
    expect(trim.length).toBeGreaterThan(0);
    for (const part of trim) {
      const actual = part.material as MeshStandardMaterial;
      const definition = definitions.find(material => material.name === actual.name)!;
      const expected = Array.isArray(definition.color) ? new Color().fromArray(definition.color) : new Color(definition.color);
      // "trim" contains "rim": selecting wheel paint must not recolor it.
      expect(actual.color.equals(expected)).toBe(true);
    }
    expect(tyres).toHaveLength(2);
    for (const part of tyres) {
      const material = part.material as MeshStandardMaterial;
      expect(material.color.getHexString()).toBe('16181a');
      expect(material.roughness).toBe(1); expect(material.metalness).toBe(0);
      expect(material.map).toBeNull();
    }
    expect(bike.body.getObjectByName('open-silencer-outlet')).toBeDefined();
  });
});
