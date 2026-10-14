import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeBike } from '../app/game/vehicle';
import { applyCartoonHeroStyle } from '../app/game/cartoonStyle';
import { createCartoonOutline } from '../app/game/cartoonOutline';
import { installImportedBikeFixtures } from './importedBikeFixture';
import { getImportedBikeAsset } from '../app/game/importedBikeAsset';
import { IMPORTED_BIKE_WHEELBASE } from '../app/game/importedBikeDimensions';

vi.mock('../app/game/garmentTexture', () => ({ garmentMaterial: () => new THREE.MeshStandardMaterial(),
  fabricMaterial: () => new THREE.MeshStandardMaterial(), sleeveMaterial: () => new THREE.MeshStandardMaterial(),
  accessoryMaterial: () => new THREE.MeshStandardMaterial() }));
installImportedBikeFixtures();

function compile(material: THREE.MeshStandardMaterial) {
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms) };
  material.onBeforeCompile(shader as Parameters<THREE.Material['onBeforeCompile']>[0], {} as THREE.WebGLRenderer);
  return shader;
}

it('keeps ink on other rubber parts when a legacy tire shares their source material', () => {
  const rubber = new THREE.MeshStandardMaterial({ color: '#16181a' });
  const tire = new THREE.Mesh(new THREE.TorusGeometry(.3, .06), rubber); tire.name = 'tire';
  const hose = new THREE.Mesh(new THREE.CylinderGeometry(.01, .01, .2), rubber); hose.name = 'hydraulic-hose';
  const root = new THREE.Group(); root.add(tire, hose);
  applyCartoonHeroStyle(root);
  expect(compile(tire.material).uniforms.cartoonFacingInkStrength.value).toBe(0);
  expect(compile(hose.material).uniforms.cartoonFacingInkStrength.value).toBe(.92);
  expect(hose.material).toBe(rubber);
  expect(tire.material.color.getHexString()).toBe('16181a');
});

it.each(['125', 'moped', '450', '701', 'scooter'])('removes rubber tire ink only on %s while preserving actual rim and brake owners', id => {
  const bike = makeBike({ ...newPlayer(), bike: id }, []);
  const tires: THREE.Mesh[] = [], rims: THREE.Mesh[] = [];
  bike.body.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !object.userData.importedPart) return;
    if (/tyre|tire/.test(object.userData.importedPart)) tires.push(object);
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.some(m => m.userData.rimPalette) && (id !== '450' || /rim_hoop/.test(object.name))) rims.push(object);
  });
  expect(tires).toHaveLength(2); expect(rims).toHaveLength(2);
  const original = tires.map(t => ({ geometry: t.geometry, indices: Array.from(t.geometry.index!.array),
    color: (t.material as THREE.MeshStandardMaterial).color.getHexString() }));
  applyCartoonHeroStyle(bike.root);
  const outlines = createCartoonOutline(bike.root);
  tires.forEach((tire, i) => {
    expect(compile(tire.material as THREE.MeshStandardMaterial).uniforms.cartoonFacingInkStrength.value).toBe(0);
    expect(tire.children.some(child => child.userData.cartoonOutline || child.userData.cartoonContour)).toBe(false);
    expect(tire.userData.cartoonContourOwner).toBeUndefined();
    expect(tire.geometry).toBe(original[i].geometry);
    expect(Array.from(tire.geometry.index!.array)).toEqual(original[i].indices);
    expect((tire.material as THREE.MeshStandardMaterial).color.getHexString()).toBe(original[i].color);
  });
  for (const rim of rims) expect(rim.children.some(child => child.userData.cartoonContour)).toBe(true);
  expect(outlines.count).toBeLessThanOrEqual(32); expect(outlines.contourCount).toBeLessThanOrEqual(10);
  outlines.dispose();
});

it('clips only the Scooter semantic tire band from rim ink while retaining merged brake ranges', () => {
  const bike = makeBike({ ...newPlayer(), bike: 'scooter', rims: '#80cede' }, []);
  applyCartoonHeroStyle(bike.root);
  const outlines = createCartoonOutline(bike.root);
  const asset = getImportedBikeAsset('scooter');
  const scale = IMPORTED_BIKE_WHEELBASE.scooter / Math.abs(asset.manifest.anchors.rearAxle[2] - asset.manifest.anchors.frontAxle[2]);
  for (const side of ['frontWheel', 'rearWheel']) {
    const rim = bike.body.getObjectByName(`nitro_rim:${side}`) as THREE.Mesh;
    const shell = rim.children.find(c => c.userData.cartoonOutline) as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    expect(shell.material.fragmentShader).toContain('vCartoonOutlineTirePosition');
    const owner = rim.children.find(c => c.userData.cartoonContour) as THREE.LineSegments;
    const range = (owner.userData.cartoonContourRanges as { source: string; start: number; count: number }[]).find(r => r.source === rim.uuid)!;
    expect(range.count).toBeGreaterThan(0);
    const positions = owner.geometry.getAttribute('position');
    for (let i = range.start; i < range.start + range.count; i++)
      expect(Math.hypot(positions.getY(i), positions.getZ(i)) / scale).toBeLessThanOrEqual(.166001);
    for (const material of ['steel', 'carrier']) {
      const brake = bike.body.getObjectByName(`nitro_brake_${material}:${side}`) as THREE.Mesh;
      expect(brake.userData.cartoonContourOwner).toBe(owner.uuid);
      expect(owner.userData.cartoonContourRanges.some((r: { source: string; count: number }) => r.source === brake.uuid && r.count > 0)).toBe(true);
    }
  }
  outlines.dispose();
});
