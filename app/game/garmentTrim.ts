import * as THREE from 'three';

type TrimRegion = 'hem' | 'cuff';
const trims = new WeakMap<
  THREE.MeshStandardMaterial,
  { region: TrimRegion; texture: THREE.DataTexture }
>();

/**
 * Subtle knitted relief for the photographed hoodies and Racing zipper only.
 * The original color/artwork map remains shared, including asynchronous updates.
 * Clone a shared fabric material before applying this to a sleeve; the clone
 * owns only its new bump texture and does not dispose the shared artwork map.
 */
export function applyRibbedTrim(
  material: THREE.MeshStandardMaterial,
  region: TrimRegion,
) {
  const previous = trims.get(material);
  if (previous?.region === region) return material;
  const width = region === 'hem' ? 1024 : 512,
    height = 256,
    ribs = region === 'hem' ? 224 : 64,
    extent = region === 'hem' ? 0.045 / 0.675 : 0.06;
  const values = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    const mask = 1 - THREE.MathUtils.smoothstep(v, extent - 0.008, extent);
    for (let x = 0; x < width; x++) {
      // Fine longitudinal ribs, with a short transition into the main fabric.
      // Only height changes: no painted seam, invented color, or added print.
      const ridge = Math.cos((x / width) * Math.PI * 2 * ribs);
      const value = Math.round(128 + 46 * ridge * mask),
        i = (y * width + x) * 4;
      values[i] = values[i + 1] = values[i + 2] = value;
      values[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(
    values,
    width,
    height,
    THREE.RGBAFormat,
  );
  texture.name = `garment-${region}-ribbing`;
  texture.wrapS = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  previous?.texture.dispose();
  trims.set(material, { region, texture });
  material.bumpMap = texture;
  material.bumpScale = 0.0007;
  material.needsUpdate = true;
  if (!previous)
    material.addEventListener('dispose', () => {
      trims.get(material)?.texture.dispose();
      trims.delete(material);
    });
  return material;
}
