import * as THREE from 'three';

/** Clone the narrowed subtype into a new variable. Never reassign a Material parameter. */
export function darkSuspensionMaterial(source: THREE.Material): THREE.Material {
  if (!(source instanceof THREE.MeshStandardMaterial)) return source;
  const copy = source.clone();
  copy.color.set('#141414');
  copy.metalness = Math.max(copy.metalness, 0.18);
  copy.roughness = Math.min(0.92, Math.max(copy.roughness, 0.7));
  return copy;
}

/** Called at the END of chassis construction, after spring and fork meshes exist. */
export function finishSupermotoSuspension(body: THREE.Group): void {
  if (body.userData.pfuschV39SuspensionFinished) return;
  const names = new Set(['rear-shock-spring', 'fork-stanchion', 'fork-dust-seal']);
  const copies = new Map<THREE.Material, THREE.Material>();
  const tint = (source: THREE.Material) => {
    let copy = copies.get(source);
    if (!copy) { copy = darkSuspensionMaterial(source); copies.set(source, copy); }
    return copy;
  };
  body.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !names.has(object.name)) return;
    object.material = Array.isArray(object.material)
      ? object.material.map(tint) : tint(object.material);
  });
  body.userData.pfuschV39SuspensionFinished = true;
}
