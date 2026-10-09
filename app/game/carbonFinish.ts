import * as THREE from 'three';
import { CARBON_TEXTURE, DARK_CARBON } from '../domain/carbon';

let texture: THREE.Texture | undefined;
function carbonTexture() {
  if (!texture) {
    texture = typeof document === 'undefined' ? new THREE.Texture() : new THREE.TextureLoader().load(CARBON_TEXTURE);
    texture.name = 'shared-dark-carbon-128';
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
  }
  return texture;
}
type FinishMaterial = THREE.MeshStandardMaterial;
const originals = new WeakMap<FinishMaterial, {
  roughness: number; metalness: number; map: THREE.Texture | null; normalMap: THREE.Texture | null;
  onBeforeCompile: FinishMaterial['onBeforeCompile']; customProgramCacheKey: FinishMaterial['customProgramCacheKey'];
}>();

/** One cached 128px artwork map, projected in object space so imported unwrapped/UV-less surfaces also work. */
export function applyColorFinish(material: FinishMaterial, value: string, shade = 1) {
  const original = originals.get(material);
  if (value !== DARK_CARBON) {
    if (original) {
      Object.assign(material, original);
      originals.delete(material);
      material.needsUpdate = true;
    }
    material.color.set(value).multiplyScalar(shade);
    return;
  }
  if (original) return;
  originals.set(material, {
    roughness: material.roughness, metalness: material.metalness, map: material.map, normalMap: material.normalMap,
    onBeforeCompile: material.onBeforeCompile, customProgramCacheKey: material.customProgramCacheKey,
  });
  const before = material.onBeforeCompile;
  material.color.set('#ffffff').multiplyScalar(shade);
  material.map = material.normalMap = null;
  material.roughness = .3; material.metalness = .38;
  const map = carbonTexture();
  material.map = map;
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.uniforms.carbonWeave = { value: map };
    shader.vertexShader = `varying vec3 vCarbonPosition;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCarbonPosition = position;');
    shader.fragmentShader = `varying vec3 vCarbonPosition;\nuniform sampler2D carbonWeave;\n${shader.fragmentShader}`
      .replace('#include <map_fragment>', '')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 carbonNormal = abs(normalize(cross(dFdx(vCarbonPosition), dFdy(vCarbonPosition))));
        vec3 carbonWeight = pow(carbonNormal, vec3(4.0));
        carbonWeight /= max(dot(carbonWeight, vec3(1.0)), 0.0001);
        vec3 carbonP = vCarbonPosition * 35.0;
        vec3 carbonColor = texture2D(carbonWeave, carbonP.yz).rgb * carbonWeight.x
          + texture2D(carbonWeave, carbonP.xz).rgb * carbonWeight.y
          + texture2D(carbonWeave, carbonP.xy).rgb * carbonWeight.z;
        diffuseColor.rgb *= carbonColor;
      `);
  };
  material.customProgramCacheKey = () => `${originals.get(material)?.customProgramCacheKey.call(material) ?? ''}:dark-carbon-v2`;
  material.needsUpdate = true;
}
