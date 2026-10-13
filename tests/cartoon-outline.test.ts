import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CARTOON_OUTLINE_MAX_MESHES, createCartoonOutline } from '../app/game/cartoonOutline';

function panel(name = 'supermoto-side-cover', size = 0.5) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, 0.08), new THREE.MeshStandardMaterial());
  mesh.name = name;
  return mesh;
}

it('keeps a shared-geometry contour attached to the moving part without changing its material, collision picking or ownership', () => {
  const root = new THREE.Group(), steering = new THREE.Group();
  const source = panel();
  root.add(steering); steering.add(source);
  const originalMaterial = source.material;
  const geometryDisposal = vi.spyOn(source.geometry, 'dispose');
  const outlines = createCartoonOutline(root);
  const outline = source.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  expect(outlines.count).toBe(1);
  expect(createCartoonOutline(root)).toBe(outlines);
  expect(outline.geometry).toBe(source.geometry);
  expect(source.material).toBe(originalMaterial);
  expect(outline.material.side).toBe(THREE.BackSide);
  expect(outline.material.depthWrite).toBe(false);
  expect(outline.castShadow).toBe(false);
  expect(outline.userData.bikePaintSurface).toBeUndefined();
  expect(outline.userData.importedPart).toBeUndefined();
  expect(new THREE.Raycaster().intersectObject(outline, false)).toEqual([]);
  steering.rotation.y = 0.4;
  source.position.set(0.4, 0.1, -0.5);
  root.updateMatrixWorld(true);
  expect(outline.matrixWorld.elements).toEqual(source.matrixWorld.elements);
  outlines.update(1440, 900);
  expect(outline.material.uniforms.cartoonViewport.value.toArray()).toEqual([1440, 900]);
  outlines.update(0, NaN);
  expect(outline.material.uniforms.cartoonViewport.value.toArray()).toEqual([1440, 900]);
  const materialDisposal = vi.spyOn(outline.material, 'dispose');
  outlines.dispose(); outlines.dispose();
  expect(source.children).toHaveLength(0);
  expect(geometryDisposal).not.toHaveBeenCalled();
  expect(materialDisposal).toHaveBeenCalledTimes(1);
});

it('shares the original limb skeleton and skin attributes without rebinding or resizing the rider', () => {
  const root = new THREE.Group();
  const bone = new THREE.Bone();
  const geometry = new THREE.CylinderGeometry(0.09, 0.1, 0.6, 8);
  const vertices = geometry.getAttribute('position').count;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(vertices * 4), 4));
  const weights = new Float32Array(vertices * 4);
  for (let i = 0; i < vertices; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const source = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  source.name = 'garment-sleeve';
  source.position.set(0.2, 1.3, 0);
  root.add(bone, source);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton([bone]);
  source.bind(skeleton);
  const inverse = skeleton.boneInverses[0].clone();
  const bind = source.bindMatrix.clone();
  const skeletonDisposal = vi.spyOn(skeleton, 'dispose');
  const outlines = createCartoonOutline(root);
  const outline = source.children[0] as THREE.SkinnedMesh;
  expect(outline.isSkinnedMesh).toBe(true);
  expect(outline.skeleton).toBe(skeleton);
  expect(outline.bindMatrix.elements).toEqual(bind.elements);
  expect(skeleton.boneInverses[0].elements).toEqual(inverse.elements);
  expect(outline.geometry.getAttribute('skinWeight')).toBe(geometry.getAttribute('skinWeight'));
  bone.rotation.z = 0.3;
  root.position.x = 3;
  root.updateMatrixWorld(true);
  skeleton.update();
  expect(outline.matrixWorld.elements).toEqual(source.matrixWorld.elements);
  expect(outline.bindMatrixInverse.elements).toEqual(source.bindMatrixInverse.elements);
  expect(source.scale.toArray()).toEqual([1, 1, 1]);
  outlines.dispose();
  expect(skeletonDisposal).not.toHaveBeenCalled();
});

it('caps hero draw calls and skips tiny hardware and alpha artwork cards', () => {
  const root = new THREE.Group();
  const sources = Array.from({ length: 50 }, () => panel());
  root.add(...sources);
  const tiny = panel('supermoto-side-cover', 0.02);
  const glass = panel('visor', 2); glass.material.transparent = true;
  const artwork = panel('fairing-artwork', 2); artwork.material.alphaMap = new THREE.Texture();
  const decal = panel('bike-sticker', 2); decal.userData.bikeSticker = true;
  const lens = panel('headlight-lens', 2);
  root.add(tiny, glass, artwork, decal, lens);
  const outline = createCartoonOutline(root);
  expect(outline.count).toBe(CARTOON_OUTLINE_MAX_MESHES);
  for (const skipped of [tiny, glass, artwork, decal, lens]) expect(skipped.children).toHaveLength(0);
  const materials = new Set(sources.flatMap((source) => source.children.map((child) => (child as THREE.Mesh).material)));
  expect(materials.size).toBe(1);
  outline.dispose();
  expect(sources.every((source) => source.children.length === 0)).toBe(true);
});
