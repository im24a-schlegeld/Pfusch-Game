import { installImportedBikeFixtures } from './importedBikeFixture';
installImportedBikeFixtures();
import { describe, expect, it, vi } from 'vitest';
import { Color, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeBike } from '../app/game/vehicle';
import { getImportedBikeAsset } from '../app/game/importedBikeAsset';
import { IMPORTED_BIKE_WHEELBASE } from '../app/game/importedBikeDimensions';
vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(), fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(), accessoryMaterial: () => new MeshStandardMaterial(),
}));
describe('assembled motorcycle connections', () => {
  it('keeps the Ciao rear axle rigid and the native lamp attached to its steering', () => {
    const bike = makeBike({ ...newPlayer(), bike: '125' }, []);
    const rear = bike.body.getObjectByName('rear-suspension-axle')!;
    const steering = bike.body.getObjectByName('imported-steering')!;
    const source = getImportedBikeAsset('125').manifest.anchors;
    expect(bike.body.userData.importedBike).toBe('125');
    expect(bike.body.getObjectByName('open-silencer-outlet')!.position.toArray()).toEqual(source.exhaust);
    expect(bike.body.userData.headlightAnchors[0].parent).toBe(steering);
    expect(bike.body.getObjectByName('active-rear-shock')!.children).toHaveLength(0);
    for (const travel of [-.025, 0, .12]) {
      bike.animateSuspension(.6, travel, 1);
      expect(rear.rotation.x).toBeCloseTo(0, 10);
      expect(rear.position.length()).toBeLessThan(1e-10);
    }
  });
  it.each(['125', 'moped', '450', '701', 'scooter'] as const)('%s attaches imported forks, swingarm and shock at their actual source pivots', id => {
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
    if (id === '125') expect(arms).toHaveLength(0);
    else expect(arms.length).toBeGreaterThan(0);
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
  it.each(['125', 'moped', '450', '701', 'scooter'] as const)('%s paints only actual bodywork and keeps its seat and mechanics distinct', id => {
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
      expect(material.color.getHexString()).toBe(id === '450' ? '090909' : '16181a');
      expect(material.roughness).toBe(1); expect(material.metalness).toBe(0);
      expect(material.map).toBeNull();
    }
    expect(bike.body.getObjectByName('open-silencer-outlet')).toBeDefined();
  });
});
