import { expect, it } from 'vitest';
import * as THREE from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeImportedBike } from '../app/game/importedBike';
import { getImportedBikeAsset, type ImportedBikeId } from '../app/game/importedBikeAsset';
import { applyCartoonHeroStyle } from '../app/game/cartoonStyle';
import { createPreviewColorUpdater } from '../app/game/previewAppearance';
import { installImportedBikeFixtures } from './importedBikeFixture';

installImportedBikeFixtures(['701', 'scooter']);

function bikeFixture(id: ImportedBikeId) {
  const player = { ...newPlayer(), bike: id, rims: '#80cede' };
  const bike = makeImportedBike(player, [], parent => {
    const group = new THREE.Group(); parent.add(group);
    return { group, animate() {}, animateAccessories() {}, applyRagdollPose() {},
      captureRagdollPose() { throw new Error('No rider in wheel fixture'); } };
  });
  applyCartoonHeroStyle(bike.root);
  return { bike, player };
}

function compile(material: THREE.MeshStandardMaterial) {
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms) };
  material.onBeforeCompile(shader as Parameters<THREE.Material['onBeforeCompile']>[0], {} as THREE.WebGLRenderer);
  return shader;
}

it('keeps the Sport authored perforated rotors free of grazing-angle surface fragments', () => {
  const { bike } = bikeFixture('701');
  const asset = getImportedBikeAsset('701');
  for (const name of ['r6_brake_steel:frontWheel', 'r6_brake_carrier:frontWheel', 'r6_brake_steel:rearWheel']) {
    const mesh = bike.body.getObjectByName(name) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const part = asset.manifest.parts.find(p => p.name === name)!;
    expect(Array.from(mesh.geometry.index!.array)).toEqual(Array.from(new Uint16Array(asset.binary, part.index.offset, part.index.count)));
    expect(mesh.geometry.getAttribute('position').count).toBe(part.position.count);
    expect(mesh.geometry.groups).toHaveLength(0);
    expect(compile(mesh.material).uniforms.cartoonFacingInkStrength.value).toBe(0);
    expect(mesh.material.userData.rimPalette).toBe(false);
  }
});

it('makes only the Scooter outer rim band tire-black in its existing draw while previews retain inner color', () => {
  const { bike, player } = bikeFixture('scooter');
  const asset = getImportedBikeAsset('scooter');
  const update = createPreviewColorUpdater(bike.body, bike.rider, player);
  for (const side of ['frontWheel', 'rearWheel'] as const) {
    const name = `nitro_rim:${side}`;
    const mesh = bike.body.getObjectByName(name) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const part = asset.manifest.parts.find(p => p.name === name)!;
    const positions = new Float32Array(asset.binary, part.position.offset, part.position.count * 3);
    const axle = side === 'frontWheel' ? asset.manifest.anchors.frontAxle : asset.manifest.anchors.rearAxle;
    const band = mesh.geometry.getAttribute('cartoonRimTireBand');
    expect(band).toBeDefined();
    let tire = 0, colored = 0;
    for (let i = 0; i < part.position.count; i++) {
      const radius = Math.hypot(positions[i * 3 + 1] - axle[1], positions[i * 3 + 2] - axle[2]);
      if (radius >= 0.178) { expect(band.getX(i)).toBe(1); tire++; }
      if (radius <= 0.166) { expect(band.getX(i)).toBe(0); colored++; }
    }
    expect(tire).toBeGreaterThan(300); expect(colored).toBeGreaterThan(700);
    expect(mesh.geometry.groups).toHaveLength(0);
    expect(Array.from(mesh.geometry.index!.array)).toEqual(Array.from(new Uint16Array(asset.binary, part.index.offset, part.index.count)));
    expect(compile(mesh.material).fragmentShader).toContain('vCartoonRimTireBand');
    const before = Array.from(band.array);
    for (const rims of ['#bf2633', 'carbon-dark', '#ffffff']) {
      update({ ...player, rims });
      expect(mesh.material.color.getHexString()).toBe(rims === 'carbon-dark' ? 'ffffff' : rims.slice(1));
      expect(Array.from(band.array)).toEqual(before);
      const shader = compile(mesh.material);
      expect(shader.fragmentShader).toContain('mix(diffuseColor.rgb, cartoonRimTireColor, vCartoonRimTireBand)');
      expect((shader.uniforms.cartoonRimTireColor.value as THREE.Color).getHexString()).toBe('16181a');
    }
    update(player);
  }
});
