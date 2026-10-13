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

it('inks the garment cuff in the existing skinned surface without touching artwork or armhole topology', () => {
  const artwork = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: artwork });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.1, 0.2, 0, 0.1, 0.2, 0, -0.1, 0.1, 0, 0.1, 0.1, 0,
    -0.1, 0, 0, 0.1, 0, 0,
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0.5, 1, 0.5, 0, 0, 1, 0], 2));
  geometry.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4]);
  geometry.computeVertexNormals();
  const sleeve = new THREE.SkinnedMesh(geometry, material); sleeve.name = 'garment-sleeve';
  const root = new THREE.Group(); root.add(sleeve);
  const uv = geometry.getAttribute('uv'), positions = geometry.getAttribute('position'), index = geometry.index;
  applyCartoonHeroStyle(root);
  const contour = geometry.getAttribute('cartoonGarmentEdge');
  expect(contour.getX(0)).toBe(1); // Hidden shoulder seam stays smooth.
  expect(contour.getX(2)).toBe(0.5);
  expect(contour.getX(4)).toBe(0); // Visible fabric-to-skin cuff.
  expect(geometry.getAttribute('uv')).toBe(uv);
  expect(geometry.getAttribute('position')).toBe(positions);
  expect(geometry.index).toBe(index);
  expect(material.map).toBe(artwork);
  expect(sleeve.children).toHaveLength(0);
  const shader = compile(material);
  expect(shader.uniforms.cartoonFacingInkStrength.value).toBe(0);
  expect(shader.uniforms.cartoonGarmentInkStrength.value).toBe(0.92);
  expect(shader.vertexShader).toContain('vCartoonGarmentEdge = cartoonGarmentEdge');
  expect(shader.fragmentShader).toContain('fwidth(vCartoonGarmentEdge)');
  applyCartoonHeroStyle(root);
  expect(geometry.getAttribute('cartoonGarmentEdge')).toBe(contour);
});

it('keeps a sneaker outer contour without amplifying decimated sole normals into black surface patches', () => {
  const material = new THREE.MeshStandardMaterial({ color: '#7461a5' });
  const boot = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), material);
  boot.name = 'rider-boot';
  applyCartoonHeroStyle(boot);
  expect(compile(material).uniforms.cartoonFacingInkStrength.value).toBe(0);
  expect(material.color.getHexString()).toBe('7461a5');
});

it.each(['tailored-garment', 'folded-garment-hem', 'folded-hood', 'stand-collar', 'continuous-trouser-seat', 'rider-glove', ''])
('does not draw camera-angle bands through the interior of rider surface %s', (name) => {
  const material = new THREE.MeshStandardMaterial();
  const geometry = new THREE.CylinderGeometry(0.09, 0.1, 0.4, 16);
  const surface = name ? new THREE.Mesh(geometry, material) : new THREE.SkinnedMesh(geometry, material);
  surface.name = name;
  applyCartoonHeroStyle(surface);
  const shader = compile(material);
  expect(shader.uniforms.cartoonFacingInkStrength.value).toBe(0);
  expect(shader.uniforms.cartoonGarmentInkStrength.value).toBe(0.92);
  expect(material.customProgramCacheKey()).toContain(':0.0:hero');
});

it('retains the existing surface ink on world shapes and rigid motorcycle forms', () => {
  const world = new THREE.MeshStandardMaterial(), bike = new THREE.MeshStandardMaterial();
  applyCartoonMaterial(world);
  const tank = new THREE.Mesh(new THREE.SphereGeometry(), bike); tank.name = 'sport-fuel-tank';
  applyCartoonHeroStyle(tank);
  expect(compile(world).uniforms.cartoonFacingInkStrength.value).toBe(0.92);
  expect(compile(bike).uniforms.cartoonFacingInkStrength.value).toBe(0.92);
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
