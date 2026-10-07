import * as THREE from 'three';

/** Static views still redraw when asynchronously loaded artwork becomes ready. */
export function createSceneInvalidation() {
  let pending = true;
  let textures: THREE.Texture[] = [];
  let versions: number[] = [];
  let sourceVersions: number[] = [];
  return {
    invalidate() { pending = true; },
    track(root: THREE.Object3D) {
      const unique = new Set<THREE.Texture>();
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          for (const value of Object.values(material))
            if (value instanceof THREE.Texture) unique.add(value);
      });
      textures = [...unique];
      versions = textures.map((texture) => texture.version);
      sourceVersions = textures.map((texture) => texture.source.version);
      pending = true;
    },
    consume() {
      for (let index = 0; index < textures.length; index++) {
        const version = textures[index].version;
        const sourceVersion = textures[index].source.version;
        if (version !== versions[index] || sourceVersion !== sourceVersions[index]) {
          versions[index] = version;
          sourceVersions[index] = sourceVersion;
          pending = true;
        }
      }
      const changed = pending;
      pending = false;
      return changed;
    },
  };
}
