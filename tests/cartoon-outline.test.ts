import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CARTOON_OUTLINE_MAX_MESHES, CARTOON_CONTOUR_MAX_MESHES, CARTOON_CONTOUR_MAX_SEGMENTS, createCartoonOutline } from '../app/game/cartoonOutline';
import { createMotocrossHelmet } from '../app/game/motocrossHelmet';
import { addSupermotoRim } from '../app/game/supermotoWheels';
import { motorcycleRim } from '../app/game/wheelDetails';

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
  const materials = new Set(sources.flatMap((source) => source.children
    .filter((child) => child.userData.cartoonOutline).map((child) => (child as THREE.Mesh).material)));
  expect(materials.size).toBe(1);
  outline.dispose();
  expect(sources.every((source) => source.children.length === 0)).toBe(true);
});

it('keeps the authored helmet peak, goggle frame and all three bike rim forms ahead of incidental panels', () => {
  const root = new THREE.Group();
  root.add(...Array.from({ length: 50 }, () => panel('sport-fairing', 2)));
  const helmet = createMotocrossHelmet('#eeeeea', '#888888');
  root.add(helmet);
  const supermoto = new THREE.Group(), sport = new THREE.Group(), moped = new THREE.Group();
  for (const wheel of [supermoto, sport, moped]) { wheel.name = 'front-wheel'; root.add(wheel); }
  const rimFinish = new THREE.MeshStandardMaterial(), metal = new THREE.MeshStandardMaterial();
  addSupermotoRim(supermoto, false, rimFinish, metal);
  motorcycleRim(sport, true, 0.25, 0.065, rimFinish, metal);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.015, 12, 72), rimFinish);
  lip.rotation.y = Math.PI / 2;
  moped.add(lip);
  const outlines = createCartoonOutline(root);
  for (const source of [helmet.getObjectByName('motocross-peak')!, helmet.getObjectByName('motocross-goggle-frame')!,
    supermoto.getObjectByName('formed-rim-barrel')!, sport.getObjectByName('formed-rim-barrel')!, lip]) {
    expect(source.children.some((child) => child.userData.cartoonOutline)).toBe(true);
  }
  for (const source of [helmet.getObjectByName('motocross-goggle-lens')!, supermoto.getObjectByName('cross-laced-spokes')!,
    ...sport.children.filter((part) => part.name === 'cast-y-spoke')]) {
    expect(source.children.some((child) => child.userData.cartoonOutline || child.userData.cartoonContour)).toBe(false);
  }
  expect(outlines.count).toBeLessThanOrEqual(CARTOON_OUTLINE_MAX_MESHES);
  outlines.dispose();
});

it('traces only hard form edges and material borders while sharing bounded contour resources', () => {
  const root = new THREE.Group();
  // Two coplanar triangles have a material border, but their other edges are
  // only the square perimeter. Removing material-border detection loses the
  // visor opening; drawing triangle diagonals everywhere gives wireframe.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.2, -0.2, 0, 0.2, -0.2, 0, 0.2, 0.2, 0, -0.2, 0.2, 0,
  ], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  geometry.addGroup(0, 3, 0); geometry.addGroup(3, 3, 1);
  const materials = [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()];
  const sources = Array.from({ length: 15 }, () => {
    const mesh = new THREE.Mesh(geometry, materials); mesh.name = 'full-face-helmet'; return mesh;
  });
  const smooth = geometry.toNonIndexed(); smooth.clearGroups();
  const panelSource = new THREE.Mesh(smooth, materials[0]); panelSource.name = 'supermoto-side-cover';
  root.add(panelSource, ...sources);
  const sourceDisposal = vi.spyOn(geometry, 'dispose');
  const outlines = createCartoonOutline(root);
  const lines = sources.flatMap((source) => source.children.filter((child) => child.userData.cartoonContour)) as THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>[];
  expect(lines).toHaveLength(CARTOON_CONTOUR_MAX_MESHES);
  expect(new Set(lines.map((line) => line.geometry)).size).toBe(1);
  expect(new Set(lines.map((line) => line.material)).size).toBe(1);
  expect(lines[0].geometry.getAttribute('position').count).toBe(10); // 4 border edges + the material junction.
  expect(lines[0].geometry.getAttribute('position').count).toBeLessThanOrEqual(CARTOON_CONTOUR_MAX_SEGMENTS * 2);
  expect(lines[0].userData.cartoonOutline).toBeUndefined();
  expect(lines[0].material.depthWrite).toBe(false);
  expect(new THREE.Raycaster().intersectObject(lines[0], false)).toEqual([]);
  const geometryDisposal = vi.spyOn(lines[0].geometry, 'dispose'), materialDisposal = vi.spyOn(lines[0].material, 'dispose');
  outlines.dispose(); outlines.dispose();
  expect(sourceDisposal).not.toHaveBeenCalled();
  expect(geometryDisposal).toHaveBeenCalledTimes(1);
  expect(materialDisposal).toHaveBeenCalledTimes(1);
  expect(sources.every((source) => source.children.length === 0)).toBe(true);
  // A fresh root with one same-material flat form omits the diagonal.
  const flatRoot = new THREE.Group(); flatRoot.add(panelSource);
  const flatOutline = createCartoonOutline(flatRoot);
  const flatContour = panelSource.children.find((child) => child.userData.cartoonContour) as THREE.LineSegments;
  expect(flatContour.geometry.getAttribute('position').count).toBe(8);
  flatOutline.dispose();
});

it('includes the actual carried cap and bag mesh names while leaving miniature keychain hardware unoutlined', () => {
  const root = new THREE.Group();
  const cap = panel('imported-cap-shell', 0.2), bag = panel('carried-crossbody-bag', 0.2), ring = panel('keychain-ring', 0.02);
  root.add(cap, bag, ring);
  const outlines = createCartoonOutline(root);
  expect(cap.children.some((child) => child.userData.cartoonOutline)).toBe(true);
  expect(bag.children.some((child) => child.userData.cartoonOutline)).toBe(true);
  expect(ring.children).toHaveLength(0);
  outlines.dispose();
});

it('limits contour output even for a source containing thousands of disconnected hard borders', () => {
  const root = new THREE.Group();
  const positions: number[] = [];
  for (let i = 0; i < 3000; i++) {
    const x = i * 0.01;
    positions.push(x, 0, 0, x + 0.005, 0.005, 0, x, 0.005, 0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const source = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  source.name = 'full-face-helmet'; source.scale.y = 100;
  root.add(source);
  const outlines = createCartoonOutline(root);
  const contour = source.children.find((child) => child.userData.cartoonContour) as THREE.LineSegments;
  expect(contour.geometry.getAttribute('position').count).toBe(CARTOON_CONTOUR_MAX_SEGMENTS * 2);
  outlines.dispose();
});
