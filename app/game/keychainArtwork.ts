import * as THREE from 'three';
import artwork from '../../public/catalog/keychain-artwork.json';

const images = new Map<string, Promise<HTMLImageElement>>();
/** Two real faces from the first product mockup; no recreated lettering. */
export function keychainFaceMaterial(side: 'front' | 'back') {
  const path = artwork[side].localImage;
  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.94,
  });
  material.userData.source = path;
  if (typeof Image === 'undefined') return material;
  let image = images.get(path);
  if (!image) {
    image = new Promise<HTMLImageElement>((resolve, reject) => {
      const source = new Image();
      source.onload = () => resolve(source);
      source.onerror = () => {
        images.delete(path);
        reject(new Error(`Keychain mockup could not load: ${path}`));
      };
      source.src = path;
    });
    images.set(path, image);
  }
  const map = new THREE.Texture();
  map.colorSpace = THREE.SRGBColorSpace;
  material.map = map;
  let disposed = false;
  material.addEventListener('dispose', () => {
    disposed = true;
    map.dispose();
  });
  void image.then((source) => {
    if (disposed) return;
    map.image = source;
    map.needsUpdate = true;
  }).catch((error: unknown) => {
    if (!disposed) console.error(error);
  });
  return material;
}
