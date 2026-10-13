import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeBike } from '../app/game/vehicle';
import { createCartoonOutline, CARTOON_OUTLINE_MAX_MESHES, CARTOON_CONTOUR_MAX_MESHES } from '../app/game/cartoonOutline';
import { installImportedBikeFixtures } from './importedBikeFixture';
import { getImportedBikeAsset } from '../app/game/importedBikeAsset';
import { hardwareComponents } from '../app/game/importedHardwareFinish';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new THREE.MeshStandardMaterial(),
  fabricMaterial: () => new THREE.MeshStandardMaterial(),
  sleeveMaterial: () => new THREE.MeshStandardMaterial(),
  accessoryMaterial: () => new THREE.MeshStandardMaterial(),
}));
installImportedBikeFixtures();

function vertexKey(positions: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, vertex: number) {
  return [positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex)]
    .map(value => Math.round(value * 100000)).join(',');
}

it.each(['125', 'moped', '450', '701', 'scooter'])(
  'traces the real rigid painted bodywork of imported %s while keeping its optics clear', id => {
    const bike = makeBike({ ...newPlayer(), bike: id }, []);
    const paints: THREE.Mesh[] = [], optics: THREE.Mesh[] = [], hoops: THREE.Mesh[] = [], spokes: THREE.Mesh[] = [];
    bike.body.traverse(object => {
      if (!(object instanceof THREE.Mesh) || !object.userData.importedPart) return;
      if (object.userData.bikePaintSurface === true) paints.push(object);
      if (/glass|reflector|lens/.test(object.name)) optics.push(object);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.some(material => material.userData.rimPalette === true) &&
          (id !== '450' || /rim_hoop/.test(object.name))) hoops.push(object);
      if (/spoke/.test(object.name)) spokes.push(object);
    });
    expect(paints.length).toBeGreaterThan(0);
    const sources = paints.map(mesh => ({ geometry: mesh.geometry, material: mesh.material }));
    const outlines = createCartoonOutline(bike.root);
    paints.forEach((paint, i) => {
      const contour = paint.children.find(child => child.userData.cartoonContour) as THREE.LineSegments;
      expect(contour).toBeDefined();
      expect(contour.geometry.attributes.position.count).toBeGreaterThan(0);
      expect(paint.geometry).toBe(sources[i].geometry);
      expect(paint.material).toBe(sources[i].material);
    });
    expect(hoops).toHaveLength(2);
    for (const hoop of hoops)
      expect(hoop.children.some(child => child.userData.cartoonContour &&
        (child as THREE.LineSegments).geometry.attributes.position.count > 0)).toBe(true);
    for (const spoke of spokes)
      expect(spoke.children.some(child => child.userData.cartoonContour || child.userData.cartoonOutline)).toBe(false);
    for (const optic of optics)
      expect(optic.children.some(child => child.userData.cartoonContour || child.userData.cartoonOutline)).toBe(false);
    expect(outlines.count).toBeLessThanOrEqual(CARTOON_OUTLINE_MAX_MESHES);
    expect(outlines.contourCount).toBeLessThanOrEqual(CARTOON_CONTOUR_MAX_MESHES);
    outlines.dispose();
  },
);

it.each(['450', 'scooter'] as const)(
  'preserves real component seams across the shared painted panels of %s', id => {
    const bike = makeBike({ ...newPlayer(), bike: id }, []);
    const asset = getImportedBikeAsset(id);
    const paints: THREE.Mesh[] = [];
    bike.body.traverse(object => {
      if (object instanceof THREE.Mesh && object.userData.bikePaintSurface === true) paints.push(object);
    });
    const outlines = createCartoonOutline(bike.root);
    let coveredPanels = 0;
    for (const paint of paints) {
      const part = asset.manifest.parts.find(part => part.name === paint.userData.importedPart)!;
      const contour = paint.children.find(child => child.userData.cartoonContour) as THREE.LineSegments;
      expect(contour).toBeDefined();
      const lines = contour.geometry.getAttribute('position');
      const positions = paint.geometry.getAttribute('position');
      const index = paint.geometry.index!;
      // Connected authored shells identify actual panels even when the USD
      // batches them into one paint material. UV duplicates are welded first.
      for (const component of hardwareComponents(part, asset.binary)) {
        const extents = component.min.map((min, axis) => component.max[axis] - min).sort((a, b) => b - a);
        if (extents[0] < 0.15 || extents[1] < 0.06 || component.triangles.length < 20) continue;
        const panelVertices = new Set(component.triangles.flatMap(triangle =>
          [0, 1, 2].map(corner => vertexKey(positions, index.getX(triangle * 3 + corner)))));
        let physicalEdges = 0;
        for (let i = 0; i < lines.count; i += 2)
          if (panelVertices.has(vertexKey(lines, i)) && panelVertices.has(vertexKey(lines, i + 1))) physicalEdges++;
        expect(physicalEdges).toBeGreaterThan(8);
        coveredPanels++;
      }
    }
    expect(coveredPanels).toBe(id === '450' ? 13 : 4);
    outlines.dispose();
  },
);

it('keeps the real FS450 headlight mask ahead of incidental fairing meshes and attached to steering', () => {
  const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
  const mask = bike.body.getObjectByName('fs450_bodywork_paint:steering') as THREE.Mesh;
  expect(mask.userData.bikePaintSurface).toBe(true);
  expect(mask.userData.importedRig).toBe('steering');
  // Extra incidental bodywork must not consume the mask's shell/contour slot.
  for (let i = 0; i < 40; i++) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.2), new THREE.MeshStandardMaterial());
    panel.name = 'sport-fairing'; bike.root.add(panel);
  }
  const outlines = createCartoonOutline(bike.root);
  const shell = mask.children.find(child => child.userData.cartoonOutline) as THREE.Mesh;
  const contour = mask.children.find(child => child.userData.cartoonContour) as THREE.LineSegments;
  expect(shell).toBeDefined();
  expect(contour).toBeDefined();
  expect(contour.geometry.attributes.position.count).toBeGreaterThan(0);
  const original = contour.geometry;
  bike.animateRider({ wheelie: 0.2, steer: 0.8, landing: 0, handlebarSteer: 0.7 }, 1);
  bike.root.updateMatrixWorld(true);
  expect(contour.matrixWorld.elements).toEqual(mask.matrixWorld.elements);
  expect(shell.matrixWorld.elements).toEqual(mask.matrixWorld.elements);
  expect(contour.geometry).toBe(original);
  expect(outlines.count).toBe(CARTOON_OUTLINE_MAX_MESHES);
  expect(outlines.contourCount).toBeLessThanOrEqual(CARTOON_CONTOUR_MAX_MESHES);
  outlines.dispose();
});

it('adds only the perimeter of a tagged flat painted panel, without cloth seams or triangulation', () => {
  const root = new THREE.Group();
  const geometry = new THREE.PlaneGeometry(0.5, 0.5);
  const panel = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  panel.name = 'imported_plain_paint:body'; panel.userData.bikePaintSurface = true;
  const cloth = new THREE.SkinnedMesh(geometry.clone(), new THREE.MeshStandardMaterial());
  cloth.name = 'garment-sleeve'; cloth.userData.bikePaintSurface = true;
  const bone = new THREE.Bone();
  root.add(panel, cloth, bone);
  root.updateMatrixWorld(true);
  cloth.bind(new THREE.Skeleton([bone]));
  const outlines = createCartoonOutline(root);
  const contour = panel.children.find(child => child.userData.cartoonContour) as THREE.LineSegments;
  expect(contour).toBeDefined();
  expect(contour.geometry.attributes.position.count).toBe(8);
  expect(cloth.children.some(child => child.userData.cartoonContour)).toBe(false);
  outlines.dispose();
});
