import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { World } from '../app/game/world';
import { makeWorldView, WORLD_VIEW } from '../app/game/worldView';

function fixture(low = false) {
  const scene = new THREE.Scene();
  const view = makeWorldView(scene, low);
  const sources = ['world-cone-foliage', 'world-canopy-foliage', 'world-round-trunk'].map(name => view.root.getObjectByName(name) as THREE.InstancedMesh);
  const shells = () => sources.map(source => source.children.find(object => object.userData.cartoonWorldFoliageOutline) as THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>);
  return { scene, view, sources, shells };
}

it.each([false, true])('outlines both crown forms and actual trunks without changing the original world pools (low=%s)', low => {
  const { view, sources, shells } = fixture(low);
  expect(view.root.children).toHaveLength(56);
  const outlines = shells();
  expect(outlines.every(Boolean)).toBe(true);
  view.root.position.set(0, 0.2, -12);
  view.root.updateMatrixWorld(true);
  expect(new Set(outlines.map(shell => shell.material)).size).toBe(1);
  outlines.forEach((shell, i) => {
    expect(shell.geometry).toBe(sources[i].geometry);
    expect(shell.instanceMatrix).toBe(sources[i].instanceMatrix);
    expect(shell.instanceMatrix.count).toBe(WORLD_VIEW.instancesPerBatch);
    expect(shell.parent).toBe(sources[i]);
    expect(shell.matrixWorld.elements).toEqual(sources[i].matrixWorld.elements);
    expect(shell.castShadow).toBe(false);
    expect(shell.receiveShadow).toBe(false);
    expect(shell.frustumCulled).toBe(false);
    expect(shell.material.side).toBe(THREE.BackSide);
    expect(shell.material.fog).toBe(true);
    expect(shell.material.depthWrite).toBe(false);
    expect(shell.renderOrder).toBeGreaterThan(sources[i].renderOrder);
    expect(new THREE.Raycaster().intersectObject(shell, false)).toEqual([]);
  });
});

it('reuses the same shell geometry and instance uploads while counts follow recycled trees', () => {
  const { view, sources, shells } = fixture();
  const outlines = shells();
  expect(outlines.every(Boolean)).toBe(true);
  const writes = outlines.map(shell => vi.spyOn(shell, 'setMatrixAt'));
  const world = new World(523, { acceleration: 0.15, maxSpeed: 35 });
  let populated = false;
  for (const distance of [0, 24, 480, 1500, 3200, 5200]) {
    world.advance(distance); view.update(world, distance);
    outlines.forEach((shell, i) => {
      expect(shell.count).toBe(sources[i].count);
      expect(shell.visible).toBe(sources[i].visible);
      expect(shell.instanceMatrix).toBe(sources[i].instanceMatrix);
      expect(shell.geometry).toBe(sources[i].geometry);
      populated ||= shell.count > 0;
    });
    expect(outlines.filter(shell => shell.visible && shell.count).length).toBeLessThanOrEqual(3);
  }
  expect(populated).toBe(true);
  expect(writes.every(write => write.mock.calls.length === 0)).toBe(true);
});

it('keeps the border stroke in CSS pixels, fogs it with the world and never disposes borrowed geometry', () => {
  const { view, sources, shells } = fixture();
  const outlines = shells();
  expect(outlines.every(Boolean)).toBe(true);
  const material = outlines[0].material;
  const shader = { vertexShader: THREE.ShaderLib.basic.vertexShader,
    fragmentShader: THREE.ShaderLib.basic.fragmentShader,
    uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.basic.uniforms) };
  material.onBeforeCompile(shader as Parameters<THREE.Material['onBeforeCompile']>[0], {} as THREE.WebGLRenderer);
  view.resize(1440, 900);
  expect(shader.uniforms.cartoonWorldFoliageViewport.value.toArray()).toEqual([1440, 900]);
  view.resize(0, NaN);
  expect(shader.uniforms.cartoonWorldFoliageViewport.value.toArray()).toEqual([1440, 900]);
  expect(shader.vertexShader).toContain('instanceMatrix');
  expect(shader.vertexShader).toContain('worldFoliageConeOffset(position, pixelOffset)');
  expect(shader.vertexShader).toContain('attribute vec3 cartoonWorldConeProfile');
  expect(sources[0].geometry.getAttribute('cartoonWorldConeProfile').getX(0)).toBe(10);
  expect(sources[1].geometry.getAttribute('cartoonWorldConeProfile').getX(0)).toBe(0);
  expect(sources[2].geometry.getAttribute('cartoonWorldConeProfile').getX(0)).toBe(0);
  expect(shader.vertexShader).toContain('#include <fog_vertex>');
  expect(shader.fragmentShader).toContain('#include <fog_fragment>');
  const geometryDisposals = sources.map(source => vi.spyOn(source.geometry, 'dispose'));
  const sourceMaterialDisposals = sources.map(source => vi.spyOn(source.material as THREE.Material, 'dispose'));
  const materialDisposal = vi.spyOn(material, 'dispose');
  view.dispose(); view.dispose();
  expect(materialDisposal).toHaveBeenCalledTimes(1);
  expect(geometryDisposals.every(disposal => disposal.mock.calls.length === 0)).toBe(true);
  expect(sourceMaterialDisposals.every(disposal => disposal.mock.calls.length === 0)).toBe(true);
  expect(outlines.every(shell => shell.parent === null)).toBe(true);
});
