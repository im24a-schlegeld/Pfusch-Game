import { expect, it } from 'vitest';
import * as THREE from 'three';
import { makeTrafficVariants } from '../app/game/models';
import { applyCartoonStyle } from '../app/game/cartoonStyle';
import { ROAD_EVENTS } from '../app/game/roadEvents';

it('shows a low one-lane nail strip with raised metal tips and visible end markers', () => {
  const model = makeTrafficVariants('spikes')[0];
  const shape = ROAD_EVENTS.spikes;
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  expect(size.x).toBeCloseTo(shape.width, 4);
  expect(size.z).toBeCloseTo(shape.length, 4);
  expect(size.y).toBeCloseTo(shape.height, 4);
  const teeth = model.getObjectByName('spike-teeth') as THREE.Mesh;
  expect(teeth).toBeInstanceOf(THREE.Mesh);
  expect((teeth.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('c4ced0');
  expect(model.children.filter(child => child.name === 'spike-end-marker')).toHaveLength(2);
});

it('keeps the cartoon strip bounded and shares its resources across pooled copies', () => {
  const variants = makeTrafficVariants('spikes');
  expect(new Set(variants).size).toBe(1);
  const model = variants[0];
  applyCartoonStyle(model);
  const meshes: THREE.Mesh[] = [];
  model.traverse(object => { if (object instanceof THREE.Mesh) meshes.push(object); });
  expect(meshes.length).toBeLessThanOrEqual(4);
  const contour = model.getObjectByName('cartoon-traffic-contour') as THREE.LineSegments;
  expect(contour).toBeInstanceOf(THREE.LineSegments);
  expect(contour.geometry.getAttribute('position').count).toBeGreaterThan(24);
  expect(contour.geometry.getAttribute('position').count).toBeLessThan(512);
  expect((contour.material as THREE.LineBasicMaterial).depthTest).toBe(true);
  const clone = model.clone(true);
  for (const mesh of meshes) {
    const copy = clone.getObjectByName(mesh.name) as THREE.Mesh;
    expect(copy.geometry).toBe(mesh.geometry);
    expect(copy.material).toBe(mesh.material);
    expect([...mesh.geometry.getAttribute('position').array].every(Number.isFinite)).toBe(true);
  }
  expect(new THREE.Raycaster().intersectObject(contour, false)).toEqual([]);
});
