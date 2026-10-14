import { expect, it } from 'vitest';
import * as THREE from 'three';
import { createTrafficContour } from '../app/game/trafficContours';

it('retains body boundaries while small interior traffic lines fade in the existing shared draw', () => {
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4));
  body.name = 'sculpted-body';
  const window = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.6));
  window.name = 'rear-window';
  const line = createTrafficContour([body, window], []);
  const detail = line.geometry.getAttribute('cartoonTrafficDetail');
  expect(line.material.transparent).toBe(true);
  expect(detail.count).toBe(line.geometry.attributes.position.count);
  expect(Array.from(detail.array).includes(0)).toBe(true);
  expect(Array.from(detail.array).includes(1)).toBe(true);
  for (let i = 0; i < detail.count; i += 2) expect(detail.getX(i)).toBe(detail.getX(i + 1));
  const shader = { vertexShader: THREE.ShaderLib.basic.vertexShader,
    fragmentShader: THREE.ShaderLib.basic.fragmentShader,
    uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.basic.uniforms) };
  line.material.onBeforeCompile(shader as Parameters<THREE.Material['onBeforeCompile']>[0], {} as THREE.WebGLRenderer);
  expect(shader.vertexShader.includes('cartoonTrafficDetail * smoothstep(24.0, 62.0, -mvPosition.z)')).toBe(true);
  expect(shader.fragmentShader.includes('diffuseColor.a *= vCartoonTrafficOpacity')).toBe(true);
  expect(shader.fragmentShader.includes('#include <fog_fragment>')).toBe(true);
  const clone = line.clone();
  expect(clone.geometry).toBe(line.geometry);
  expect(clone.material).toBe(line.material);
  expect(line.material.depthWrite).toBe(false);
});
