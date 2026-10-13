import * as THREE from 'three';

export const CARTOON_OUTLINE_MAX_MESHES = 32;
export interface CartoonOutline {
  readonly count: number;
  /** CSS viewport dimensions, only needed when the view resizes. */
  update(width: number, height: number): void;
  dispose(): void;
}
const active = new WeakMap<THREE.Object3D, CartoonOutline>();

const vertexShader = `
  uniform vec2 cartoonViewport;
  uniform float cartoonStroke;
  #include <common>
  #include <morphtarget_pars_vertex>
  #include <skinning_pars_vertex>
  void main() {
    #include <beginnormal_vertex>
    #include <morphnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <morphtarget_vertex>
    #include <skinning_vertex>
    #include <project_vertex>
    // objectNormal still points outwards. Unlike defaultnormal_vertex this
    // deliberately does not invert normals for a BackSide material.
    vec3 outlineNormal = normalize(normalMatrix * objectNormal);
    vec2 direction = (projectionMatrix * vec4(outlineNormal, 0.0)).xy * cartoonViewport;
    direction /= max(length(direction), 0.00001);
    gl_Position.xy += direction * (2.0 * cartoonStroke / cartoonViewport) * gl_Position.w;
    // Keep the black shell behind its coloured surface, including at seams.
    gl_Position.z += 0.00001 * gl_Position.w;
  }
`;

/** A small shared-geometry backface shell on the player only. Real silhouettes
 * need geometry beyond the coloured fragments; no fullscreen pass is required.
 * Each shell follows its own steering, suspension, cloth or bone parent.
 */
export function createCartoonOutline(root: THREE.Object3D): CartoonOutline {
  const existing = active.get(root);
  if (existing) return existing;
  const viewport = new THREE.Vector2(390, 844);
  const material = new THREE.ShaderMaterial({
    name: 'cartoon-hero-outline',
    uniforms: { cartoonViewport: { value: viewport }, cartoonStroke: { value: 1.15 } },
    vertexShader,
    fragmentShader: 'void main() { gl_FragColor = vec4(0.008, 0.010, 0.014, 1.0); }',
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    toneMapped: false,
  });
  const candidates: { mesh: THREE.Mesh; priority: number; size: number }[] = [];
  const scale = new THREE.Vector3(), size = new THREE.Vector3();
  const position = new THREE.Vector3(), rotation = new THREE.Quaternion();
  root.updateWorldMatrix(true, true);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh ||
        object.userData.cartoonOutline || object.userData.bikeSticker || object.userData.helmetSticker) return;
    const name = `${object.name} ${object.userData.importedPart ?? ''}`.toLowerCase();
    if (/sticker|decal|shadow|glass|reflector|glow|goggle|lens|wire|cable|hose|spoke|spring|chain|bolt|zipper|screw|stitch|cape|flag/.test(name)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (!materials.length || materials.some((entry) => !entry.visible || entry.transparent || entry.opacity < 0.98 ||
        entry.alphaTest > 0 || (entry as THREE.MeshStandardMaterial).alphaMap)) return;
    if (!object.geometry.getAttribute('normal')) return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    object.geometry.boundingBox!.getSize(size);
    object.matrixWorld.decompose(position, rotation, scale);
    size.multiply(scale).set(Math.abs(size.x), Math.abs(size.y), Math.abs(size.z));
    const extents = [size.x, size.y, size.z].sort((a, b) => b - a);
    // Tiny hardware should not turn into a one-pixel black mass on a phone.
    if (extents[0] < 0.09 || extents[1] < 0.035) return;
    const rider = object instanceof THREE.SkinnedMesh || /garment|hood|helmet|trouser|rider-(glove|boot)/.test(name);
    const bodywork = object.userData.bikePaintSurface || /tire|tyre|seat|fairing|fender|mudguard|side-cover|bodywork|shroud|tank|swingarm|crankcase|engine|fork-guard|carried-cap/.test(name);
    if (!rider && !bodywork && !object.userData.importedPart) return;
    candidates.push({ mesh: object, priority: rider ? 2 : bodywork ? 1 : 0, size: extents[0] * extents[1] });
  });
  candidates.sort((a, b) => b.priority - a.priority || b.size - a.size);
  const outlines: THREE.Mesh[] = [];
  for (const { mesh } of candidates.slice(0, CARTOON_OUTLINE_MAX_MESHES)) {
    let outline: THREE.Mesh;
    if (mesh instanceof THREE.SkinnedMesh) {
      const skin = new THREE.SkinnedMesh(mesh.geometry, material);
      skin.bindMode = mesh.bindMode;
      skin.bind(mesh.skeleton, mesh.bindMatrix);
      skin.bindMatrixInverse.copy(mesh.bindMatrixInverse);
      outline = skin;
    } else outline = new THREE.Mesh(mesh.geometry, material);
    outline.name = 'cartoon-hero-outline';
    outline.userData.cartoonOutline = true;
    outline.morphTargetInfluences = mesh.morphTargetInfluences;
    outline.morphTargetDictionary = mesh.morphTargetDictionary;
    outline.frustumCulled = false;
    outline.castShadow = false;
    outline.receiveShadow = false;
    outline.layers.mask = mesh.layers.mask;
    outline.raycast = () => {};
    mesh.add(outline);
    outlines.push(outline);
  }
  let disposed = false;
  const result: CartoonOutline = {
    count: outlines.length,
    update(width, height) {
      if (!disposed && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)
        viewport.set(width, height);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const outline of outlines) outline.removeFromParent();
      // Source geometry and skeleton belong to the vehicle, never the shell.
      material.dispose();
      active.delete(root);
    },
  };
  active.set(root, result);
  return result;
}
