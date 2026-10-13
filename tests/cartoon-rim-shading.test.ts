import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { newPlayer } from '../app/domain/progression';
import { applyCartoonHeroStyle, applyCartoonMaterial } from '../app/game/cartoonStyle';
import { applyColorFinish } from '../app/game/carbonFinish';
import { DARK_CARBON } from '../app/domain/carbon';
import { makeBike } from '../app/game/vehicle';
import { installImportedBikeFixtures } from './importedBikeFixture';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new THREE.MeshStandardMaterial(),
  fabricMaterial: () => new THREE.MeshStandardMaterial(),
  sleeveMaterial: () => new THREE.MeshStandardMaterial(),
  accessoryMaterial: () => new THREE.MeshStandardMaterial(),
}));
installImportedBikeFixtures();

function compile(material: THREE.MeshStandardMaterial) {
  const shader = {
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),
  };
  material.onBeforeCompile(shader as Parameters<THREE.Material['onBeforeCompile']>[0], {} as THREE.WebGLRenderer);
  return shader;
}

it.each(['scooter', '450'])('separates the actual %s inner rim from its outer face while retaining the picked blue finish', id => {
  const bike = makeBike({ ...newPlayer(), bike: id, rims: '#627dac' }, []);
  const rims: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = [];
  bike.body.traverse(object => {
    if (object instanceof THREE.Mesh && (object.material as THREE.Material).userData?.rimPalette === true) rims.push(object);
  });
  expect(rims).toHaveLength(2);
  const sources = rims.map(rim => ({ position: rim.geometry.getAttribute('position'), normal: rim.geometry.getAttribute('normal'),
    index: rim.geometry.index, material: rim.material, color: rim.material.color.clone(), children: rim.children.length }));
  applyCartoonHeroStyle(bike.root);
  rims.forEach((rim, i) => {
    const recess = rim.geometry.getAttribute('cartoonRimRecess');
    expect(recess).toBeDefined();
    expect(recess.count).toBe(sources[i].position.count);
    const values = Array.from({ length: recess.count }, (_, vertex) => recess.getX(vertex));
    expect(Math.min(...values)).toBe(0);
    expect(Math.max(...values)).toBeGreaterThan(0.9);
    expect(values.every(value => value >= 0 && value <= 1)).toBe(true);
    expect(rim.geometry.getAttribute('position')).toBe(sources[i].position);
    expect(rim.geometry.getAttribute('normal')).toBe(sources[i].normal);
    expect(rim.geometry.index).toBe(sources[i].index);
    expect(rim.material).toBe(sources[i].material);
    expect(rim.material.color.equals(sources[i].color)).toBe(true);
    expect(rim.material.userData.rimPalette).toBe(true);
    expect(rim.material.userData.pfuschCartoonRimShading).toBe(true);
    expect(rim.children).toHaveLength(sources[i].children);
    const shader = compile(rim.material);
    expect(shader.uniforms.cartoonFacingInkStrength.value).toBe(0);
    expect(shader.fragmentShader).toContain('directionalLights[ 0 ].direction');
    expect(shader.fragmentShader).toContain('vCartoonRimRecess');
    expect(rim.material.customProgramCacheKey()).toContain(':rim-v1');
  });
});

it('shades only rim finishes and leaves hardware, paint and cloth with their existing material pass', () => {
  const rim = new THREE.MeshStandardMaterial(), hardware = new THREE.MeshStandardMaterial();
  rim.userData.rimPalette = true;
  const root = new THREE.Group();
  const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.03), rim);
  const spokes = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.3), hardware);
  spokes.name = 'cross-laced-spokes';
  root.add(hoop, spokes);
  applyCartoonHeroStyle(root);
  const shader = compile(hardware);
  expect(shader.fragmentShader).not.toContain('vCartoonRimRecess');
  expect(shader.uniforms.cartoonFacingInkStrength.value).toBe(0.92);
  expect(hardware.userData.pfuschCartoonRimShading).toBe(false);
  expect(spokes.geometry.getAttribute('cartoonRimRecess')).toBeUndefined();
  expect(root.children).toHaveLength(2);
});

it('retains one rim shader and its barrel shade across repeated styling and carbon/colour changes', () => {
  const material = new THREE.MeshStandardMaterial({ color: '#627dac' });
  material.userData.rimPalette = true;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.03), material);
  applyCartoonHeroStyle(rim);
  const recess = rim.geometry.getAttribute('cartoonRimRecess'), firstVersion = material.version;
  applyCartoonHeroStyle(rim);
  expect(material.version).toBe(firstVersion);
  expect(rim.geometry.getAttribute('cartoonRimRecess')).toBe(recess);
  for (const color of [DARK_CARBON, '#627dac', DARK_CARBON, '#eeeeea']) {
    applyColorFinish(material, color);
    applyCartoonMaterial(material);
    const shader = compile(material);
    expect(shader.fragmentShader.match(/\/\/ PFUSCH_CARTOON/g)).toHaveLength(1);
    expect(shader.fragmentShader.match(/float cartoonRimDirectional/g)).toHaveLength(1);
    expect(shader.fragmentShader.includes('uniform sampler2D carbonWeave')).toBe(color === DARK_CARBON);
    expect(material.customProgramCacheKey()).toContain(':rim-v1');
  }
});
