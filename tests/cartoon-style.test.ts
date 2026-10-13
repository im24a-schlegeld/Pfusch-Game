import { expect, it } from 'vitest';
import * as THREE from 'three';
import { applyCartoonHeroStyle, applyCartoonMaterial, applyCartoonStyle, prepareCartoonGeometry } from '../app/game/cartoonStyle';
import { applyColorFinish } from '../app/game/carbonFinish';
import { DARK_CARBON } from '../app/domain/carbon';
import { addWorldSurfaceDetail } from '../app/game/worldSurface';

function compile(material: THREE.MeshStandardMaterial) {
  const shader = {
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),
  };
  material.onBeforeCompile(shader as Parameters<THREE.Material['onBeforeCompile']>[0], {} as THREE.WebGLRenderer);
  return shader;
}

it('simplifies hero surface shading while keeping original garment and sticker artwork', () => {
  const artwork = new THREE.Texture(), relief = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: artwork, normalMap: relief, bumpMap: relief });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(), material);
  applyCartoonHeroStyle(mesh);
  expect(material.map).toBe(artwork);
  expect(material.normalMap).toBeNull();
  expect(material.bumpMap).toBeNull();
  expect(compile(material).fragmentShader).toContain('mix(0.36, 0.72');
  expect(material.customProgramCacheKey()).toContain(':hero');
});

it('preserves artwork, alpha and geometry without adding outline draw calls', () => {
  const map = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ color: '#7461a5', map, alphaTest: 0.3 });
  const geometry = new THREE.SphereGeometry(1, 8, 6);
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry, material));
  const originalColor = material.color.clone();
  applyCartoonStyle(root);
  const version = material.version;
  applyCartoonStyle(root);
  expect(material.version).toBe(version);
  expect(root.children).toHaveLength(1);
  expect((root.children[0] as THREE.Mesh).geometry).toBe(geometry);
  expect(material.map).toBe(map);
  expect(material.alphaTest).toBe(0.3);
  expect(material.color.equals(originalColor)).toBe(true);
  expect(compile(material).fragmentShader.match(/\/\/ PFUSCH_CARTOON/g)).toHaveLength(1);
});

it.each([false, true])('retains carbon and one cel layer across colour changes (starts carbon=%s)', (startsCarbon) => {
  const material = new THREE.MeshStandardMaterial();
  if (startsCarbon) applyColorFinish(material, DARK_CARBON);
  applyCartoonMaterial(material);
  for (const color of [DARK_CARBON, '#7461a5', DARK_CARBON, '#eeeeea']) {
    applyColorFinish(material, color);
    applyCartoonMaterial(material);
    const shader = compile(material);
    expect(shader.fragmentShader.match(/\/\/ PFUSCH_CARTOON/g)).toHaveLength(1);
    expect(shader.fragmentShader.includes('uniform sampler2D carbonWeave')).toBe(color === DARK_CARBON);
    expect(material.customProgramCacheKey()).toContain(':pfusch-cartoon-v1:');
  }
});

it('composes streamed surface coordinates and box ink without noisy asphalt grain', () => {
  const material = new THREE.MeshStandardMaterial();
  const origin = { value: 120 };
  addWorldSurfaceDetail(material, origin, 'asphalt', false);
  applyCartoonMaterial(material, true);
  const shader = compile(material);
  expect(shader.uniforms.pfuschSurfaceOrigin).toBe(origin);
  expect(shader.vertexShader).toContain('instanceMatrix * vec4(pfuschSurfacePoint');
  expect(shader.vertexShader).toContain('vCartoonBox = cartoonBox');
  expect(shader.fragmentShader).not.toContain('pfuschGrain');
  const box = new THREE.BoxGeometry(1, 1, 1);
  const sphere = new THREE.SphereGeometry(1, 8, 6);
  prepareCartoonGeometry(box, true);
  prepareCartoonGeometry(sphere, false);
  expect(box.getAttribute('cartoonBox').getW(0)).toBe(1);
  expect(sphere.getAttribute('cartoonBox').getW(0)).toBe(0);
  expect(box.index?.count).toBe(36);
});
