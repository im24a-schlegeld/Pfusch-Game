import * as THREE from 'three';

export const CARTOON_OUTLINE_MAX_MESHES = 32;
export const CARTOON_CONTOUR_MAX_MESHES = 10;
export const CARTOON_CONTOUR_MAX_SEGMENTS = 2048;
export interface CartoonOutline {
  readonly count: number;
  readonly contourCount: number;
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
    vec2 projectedNormal = (projectionMatrix * vec4(outlineNormal, 0.0)).xy;
    vec2 direction = projectedNormal * cartoonViewport;
    direction /= max(length(direction), 0.00001);
    // Face-on normals have no stable screen direction. Normalising their tiny
    // decimation noise to a full stroke made the sneaker sole grow black teeth.
    float contourWeight = smoothstep(0.025, 0.12, length(projectedNormal));
    gl_Position.xy += direction * contourWeight * (2.0 * cartoonStroke / cartoonViewport) * gl_Position.w;
    // Keep the black shell behind its coloured surface, including at seams.
    gl_Position.z += 0.00001 * gl_Position.w;
  }
`;

/** Weld UV/material duplicates before comparing adjacent faces. Only genuine
 * open borders, strong corners and material joins survive; coplanar triangle
 * diagonals and smooth tessellation never become a wireframe. Built once. */
function hardContourGeometry(source: THREE.BufferGeometry) {
  const positions = source.getAttribute('position');
  const index = source.index;
  const keys = Array.from({ length: positions.count }, (_, i) =>
    `${Math.round(positions.getX(i) * 100000)},${Math.round(positions.getY(i) * 100000)},${Math.round(positions.getZ(i) * 100000)}`);
  const edges = new Map<string, { a: number; b: number; normal: THREE.Vector3; material: number; border: boolean; uses: number }>();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const normal = new THREE.Vector3(), side = new THREE.Vector3();
  const at = (i: number) => index ? index.getX(i) : i;
  const count = index ? index.count : positions.count;
  for (let i = 0; i + 2 < count; i += 3) {
    const vertices = [at(i), at(i + 1), at(i + 2)];
    a.fromBufferAttribute(positions, vertices[0]);
    b.fromBufferAttribute(positions, vertices[1]);
    c.fromBufferAttribute(positions, vertices[2]);
    normal.subVectors(b, a).cross(side.subVectors(c, a));
    if (normal.lengthSq() < 1e-16) continue;
    normal.normalize();
    const material = source.groups.find((group) => i >= group.start && i < group.start + group.count)?.materialIndex ?? 0;
    for (let j = 0; j < 3; j++) {
      const from = vertices[j], to = vertices[(j + 1) % 3];
      if (keys[from] === keys[to]) continue;
      const key = keys[from] < keys[to] ? `${keys[from]}:${keys[to]}` : `${keys[to]}:${keys[from]}`;
      const edge = edges.get(key);
      if (edge) {
        edge.uses++;
        edge.border ||= edge.material !== material || edge.normal.dot(normal) < 0.5;
      } else edges.set(key, { a: from, b: to, normal: normal.clone(), material, border: false, uses: 1 });
    }
  }
  const points: number[] = [];
  for (const edge of edges.values()) {
    if (edge.uses !== 1 && !edge.border) continue;
    for (const vertex of [edge.a, edge.b]) points.push(positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex));
    if (points.length >= CARTOON_CONTOUR_MAX_SEGMENTS * 6) break;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return geometry;
}

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
  const candidates: { mesh: THREE.Mesh; priority: number; size: number; hardForm: boolean }[] = [];
  const scale = new THREE.Vector3(), size = new THREE.Vector3();
  const position = new THREE.Vector3(), rotation = new THREE.Quaternion();
  root.updateWorldMatrix(true, true);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh ||
        object.userData.cartoonOutline || object.userData.bikeSticker || object.userData.helmetSticker) return;
    const name = `${object.name} ${object.userData.importedPart ?? ''}`.toLowerCase();
    const goggleFrame = object.name === 'motocross-goggle-frame';
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    // Older Töffli/sport rim lips are intentionally unnamed. Their topology
    // and wheel parent identify them without promoting the thin wire spokes.
    const importedRim = materials.some(entry => entry.userData.rimPalette === true) ||
      /(^|[_\s-])rim(?=\d|$|[_\s:-])/.test(name);
    // FS450 separates its outer hoop from the remaining wheel metal. Spend
    // the fixed contour budget on that hoop rather than every rim component.
    const separateHoop = object.parent?.children.some(child => /rim[_-]hoop/.test(child.name));
    const rim = (importedRim && (!separateHoop || /rim[_-]hoop/.test(name))) ||
      (object.geometry instanceof THREE.TorusGeometry && /^(front|rear)-wheel$/.test(object.parent?.name ?? ''));
    if (/sticker|decal|shadow|glass|reflector|glow|lens|wire|cable|hose|spoke|spring|chain|bolt|zipper|screw|stitch|cape|flag/.test(name) ||
        (/goggle/.test(name) && !goggleFrame)) return;
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
    const rider = object instanceof THREE.SkinnedMesh ||
      /garment|hood|helmet|motocross-peak|trouser|rider-(glove|boot)|stand-collar|imported-cap-shell|carried-crossbody-bag/.test(name) || goggleFrame;
    const paintedBodywork = object.userData.bikePaintSurface === true;
    // Imported models batch the FS450 mask into generic painted steering
    // bodywork. Its paint/rig metadata identifies the real shell reliably.
    const headlightMask = /headlight[-_](mask|bezel|recess)/.test(name) ||
      (paintedBodywork && object.userData.importedRig === 'steering');
    const bodywork = object.userData.bikePaintSurface || rim ||
      /tire|tyre|seat|fairing|fender|mudguard|mudflap|side-cover|bodywork|shroud|tank|swingarm|crankcase|engine|fork-guard|fork-slider|stanchion|main-frame|headlight-(mask|bezel|recess)|tail-shell|rear-hugger|single-exhaust|silencer|muffler|carried-cap/.test(name);
    if (!rider && !bodywork && !object.userData.importedPart) return;
    const essential = rim || goggleFrame || /helmet|motocross-peak|garment|mudflap/.test(name);
    const hardForm = !(object instanceof THREE.SkinnedMesh) &&
      (paintedBodywork || headlightMask || rim || goggleFrame || /helmet|motocross-peak|fairing|fender|mudflap|side-cover|shroud|tank|tail-shell|rear-hugger/.test(name));
    candidates.push({ mesh: object, priority: headlightMask ? 4 : essential ? 3 : rider ? 2 : bodywork ? 1 : 0, size: extents[0] * extents[1], hardForm });
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
  const contourMaterial = new THREE.ShaderMaterial({
    name: 'cartoon-hero-contour',
    vertexShader: `void main() {
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_Position.z -= 0.00001 * gl_Position.w;
    }`,
    fragmentShader: 'void main() { gl_FragColor = vec4(0.008, 0.010, 0.014, 1.0); }',
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  });
  const contourGeometry = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  const contours: THREE.LineSegments[] = [];
  for (const { mesh, hardForm } of candidates) {
    if (!hardForm) continue;
    if (contours.length >= CARTOON_CONTOUR_MAX_MESHES) break;
    let geometry = contourGeometry.get(mesh.geometry);
    if (!geometry) {
      geometry = hardContourGeometry(mesh.geometry);
      contourGeometry.set(mesh.geometry, geometry);
    }
    if (!geometry.getAttribute('position').count) continue;
    const contour = new THREE.LineSegments(geometry, contourMaterial);
    contour.name = 'cartoon-hero-contour';
    contour.userData.cartoonContour = true;
    contour.frustumCulled = false;
    contour.layers.mask = mesh.layers.mask;
    contour.raycast = () => {};
    mesh.add(contour);
    contours.push(contour);
  }
  let disposed = false;
  const result: CartoonOutline = {
    count: outlines.length,
    contourCount: contours.length,
    update(width, height) {
      if (!disposed && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)
        viewport.set(width, height);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const outline of outlines) outline.removeFromParent();
      for (const contour of contours) contour.removeFromParent();
      // Source geometry and skeleton belong to the vehicle, never the shell.
      material.dispose();
      contourMaterial.dispose();
      for (const geometry of contourGeometry.values()) geometry.dispose();
      active.delete(root);
    },
  };
  active.set(root, result);
  return result;
}
