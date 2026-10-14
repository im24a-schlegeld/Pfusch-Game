import { expect, it } from 'vitest';
import * as THREE from 'three';
import { World } from '../app/game/world';
import { makeWorldView, WORLD_VIEW } from '../app/game/worldView';
import { makeLoadingWorldContinuation } from '../scripts/loading-art-continuation';

function bounds(mesh: THREE.InstancedMesh) {
  mesh.geometry.computeBoundingBox();
  const box = new THREE.Box3(), matrix = new THREE.Matrix4();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(matrix));
  }
  return box;
}

it('continues the actual approved loading street seamlessly past its rear pool edge into the fog', () => {
  const scene = new THREE.Scene(), world = new World(42, { acceleration: 0.6, maxSpeed: 38 });
  world.advance(72);
  const view = makeWorldView(scene, false); view.update(world, 72);
  const sources = view.root.children.filter(object => object instanceof THREE.InstancedMesh) as THREE.InstancedMesh[];
  const original = sources.map(source => ({ count: source.count, buffer: source.instanceMatrix,
    matrices: Float32Array.from(source.instanceMatrix.array), geometry: source.geometry, material: source.material }));
  const road = view.root.getObjectByName('world-box-asphalt') as THREE.InstancedMesh;
  expect(bounds(road).max.z).toBe(48); // The camera sees the actual gameplay rear-window cutoff.
  const continuation = makeLoadingWorldContinuation(view.root);
  expect(continuation.seam).toBe(48);
  expect(continuation.end).toBe(180); expect(continuation.rows).toBe(11);
  for (const name of ['asphalt', 'sidewalk', 'curb', 'grass']) {
    const added = continuation.root.getObjectByName(`loading-world-box-${name}`) as THREE.InstancedMesh;
    expect(added).toBeInstanceOf(THREE.InstancedMesh);
    expect(bounds(added).min.z).toBe(48); expect(bounds(added).max.z).toBe(180);
    const source = view.root.getObjectByName(`world-box-${name}`) as THREE.InstancedMesh;
    expect(added.geometry).toBe(source.geometry); expect(added.material).toBe(source.material);
  }
  expect(continuation.root.children.some(object => /^loading-world-box-city[0-3]$/.test(object.name))).toBe(true);
  expect(continuation.root.getObjectByName('loading-world-box-glass')).toBeDefined();
  for (const object of continuation.root.children as THREE.InstancedMesh[]) {
    // Continuation contains existing cel-inked street/facade/lamp forms. Trees
    // keep the original pool's silhouettes; no unoutlined crowns are cloned.
    expect(object.name).not.toMatch(/canopy|cone|trunk/);
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    expect(materials.every(material => material.userData.pfuschCartoon === true)).toBe(true);
    if (object.name.startsWith('loading-world-box-'))
      expect(object.geometry.getAttribute('cartoonBox')).toBeDefined();
  }
  const marks = continuation.root.getObjectByName('loading-world-box-marking') as THREE.InstancedMesh;
  expect(bounds(marks).min.z).toBeCloseTo(48, 4); expect(bounds(marks).max.z).toBeCloseTo(180, 4);
  const dashMatrix = new THREE.Matrix4(), dashBounds: [number, number][] = [];
  for (let i = 0; i < marks.count; i++) {
    marks.getMatrixAt(i, dashMatrix);
    if (Math.abs(dashMatrix.elements[12] - 1.4) < 0.0001)
      dashBounds.push([dashMatrix.elements[14] - dashMatrix.elements[10] / 2,
        dashMatrix.elements[14] + dashMatrix.elements[10] / 2]);
  }
  dashBounds.sort((a, b) => a[0] - b[0]);
  expect(dashBounds[0][0]).toBeCloseTo(48, 4); // Completes the actual dash clipped at the pool edge.
  expect(dashBounds[0][1]).toBeCloseTo(51, 4);
  for (let i = 1; i < dashBounds.length; i++)
    expect(dashBounds[i][0] - dashBounds[i - 1][1]).toBeCloseTo(3.2, 4);
  expect(continuation.root.children.length).toBeLessThanOrEqual(20);
  expect(continuation.instances).toBeLessThanOrEqual(600);
  expect(view.root.children).toHaveLength(56); expect(WORLD_VIEW.cellCount).toBe(22);
  let sourceGeometryDisposals = 0, sourceMaterialDisposals = 0;
  road.geometry.addEventListener('dispose', () => sourceGeometryDisposals++);
  (road.material as THREE.Material).addEventListener('dispose', () => sourceMaterialDisposals++);
  continuation.dispose(); continuation.dispose();
  expect(sourceGeometryDisposals).toBe(0); expect(sourceMaterialDisposals).toBe(0);
  sources.forEach((source, i) => {
    expect(source.count).toBe(original[i].count); expect(source.instanceMatrix).toBe(original[i].buffer);
    expect(Array.from(source.instanceMatrix.array)).toEqual(Array.from(original[i].matrices));
    expect(source.geometry).toBe(original[i].geometry); expect(source.material).toBe(original[i].material);
  });
  view.dispose();
});
