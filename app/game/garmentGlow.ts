import * as THREE from 'three';

const keepUpIds = new Set([
  '10237102096713',
  '10237099737417',
  '10237061759305',
]);
const glowMaterials = new WeakSet<THREE.MeshStandardMaterial>();

/** The extracted ink alpha is the only emission signal; RGB never supplies fabric. */
export function inkEmissionPixels(source: Uint8ClampedArray) {
  const pixels = new Uint8ClampedArray(source.length);
  for (let i = 0; i < source.length; i += 4) {
    pixels[i] = pixels[i + 1] = pixels[i + 2] = source[i + 3];
    pixels[i + 3] = 255;
  }
  return pixels;
}

/** Separate ink mask, populated only by the same source crops as the diffuse print. */
export function createKeepUpInkGlow(
  material: THREE.MeshStandardMaterial,
  productId: string | undefined,
  size: number,
) {
  if (!productId || !keepUpIds.has(productId)) return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'keep-up-ink-emission';
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 2;
  material.emissiveMap = texture;
  material.emissive.set('#1d6bff');
  material.emissiveIntensity = 0;
  glowMaterials.add(material);
  let disposed = false;
  material.addEventListener('dispose', () => {
    disposed = true;
    glowMaterials.delete(material);
    material.emissiveIntensity = 0;
    texture.dispose();
  });
  return {
    paint(
      cropped: HTMLCanvasElement,
      x: number,
      y: number,
      width: number,
      height: number,
    ) {
      if (disposed) return;
      const ink = document.createElement('canvas');
      ink.width = cropped.width;
      ink.height = cropped.height;
      const paint = ink.getContext('2d')!;
      const pixels = cropped
        .getContext('2d')!
        .getImageData(0, 0, cropped.width, cropped.height);
      // Work on this copy so the exact selected-color diffuse ink stays intact.
      pixels.data.set(inkEmissionPixels(pixels.data));
      paint.putImageData(pixels, 0, 0);
      ctx.drawImage(ink, x, y, width, height);
      texture.needsUpdate = true;
    },
  };
}

/** Call once after bike creation; the returned darkness updater never traverses. */
export function createGarmentGlowUpdater(root: THREE.Object3D) {
  const unique = new Set<THREE.MeshStandardMaterial>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials)
      if (
        material instanceof THREE.MeshStandardMaterial &&
        glowMaterials.has(material)
      )
        unique.add(material);
  });
  const materials = [...unique];
  let previousIntensity = -1;
  return (darkAmount: number) => {
    const darkness = Number.isFinite(darkAmount)
      ? THREE.MathUtils.clamp(darkAmount, 0, 1)
      : 0;
    const intensity = THREE.MathUtils.smoothstep(darkness, 0.15, 0.85) * 2.6;
    if (intensity === previousIntensity) return;
    previousIntensity = intensity;
    for (const material of materials)
      if (glowMaterials.has(material)) material.emissiveIntensity = intensity;
  };
}
