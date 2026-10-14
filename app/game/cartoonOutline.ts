import * as THREE from 'three';
import { getImportedBikeAsset, isImportedBike, type ImportedBikeAsset } from './importedBikeAsset';
import { hardwareComponents } from './importedHardwareFinish';
import { IMPORTED_BIKE_WHEELBASE } from './importedBikeDimensions';

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
  attribute vec3 cartoonOutlineNormal;
  #include <common>
  #include <morphtarget_pars_vertex>
  #include <skinning_pars_vertex>
  void main() {
    #include <beginnormal_vertex>
    // Cloth lighting is faired across the shoulder overlap. Its silhouette
    // needs normals from the real faces, before the same morph/bone motion.
    if (dot(cartoonOutlineNormal, cartoonOutlineNormal) > 0.0)
      objectNormal = cartoonOutlineNormal;
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

/** The garment's lighting normals deliberately smooth the armhole overlap.
 * Keep them intact and build a separate face-derived field for shell extrusion.
 * Welding the duplicated UV circumference avoids a split at its visible seam.
 * Garment positions are fixed; their existing bones animate this attribute. */
function prepareGarmentOutlineNormals(geometry: THREE.BufferGeometry) {
  if (geometry.getAttribute('cartoonOutlineNormal')) return;
  const positions = geometry.getAttribute('position'), index = geometry.index;
  const keys = Array.from({ length: positions.count }, (_, vertex) =>
    `${Math.round(positions.getX(vertex) * 100000)},${Math.round(positions.getY(vertex) * 100000)},${Math.round(positions.getZ(vertex) * 100000)}`);
  const sums = new Map<string, THREE.Vector3>();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const at = (vertex: number) => index ? index.getX(vertex) : vertex;
  for (let face = 0; face + 2 < (index?.count ?? positions.count); face += 3) {
    const vertices = [at(face), at(face + 1), at(face + 2)];
    a.fromBufferAttribute(positions, vertices[0]);
    b.fromBufferAttribute(positions, vertices[1]).sub(a);
    c.fromBufferAttribute(positions, vertices[2]).sub(a);
    b.cross(c); // Area weighting retains the real surface's outward winding.
    for (const vertex of vertices) {
      const key = keys[vertex];
      const sum = sums.get(key);
      if (sum) sum.add(b);
      else sums.set(key, b.clone());
    }
  }
  const normal = new THREE.Vector3(), source = geometry.getAttribute('normal');
  const attribute = new THREE.Float32BufferAttribute(new Float32Array(positions.count * 3), 3);
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const sum = sums.get(keys[vertex]);
    if (sum && sum.lengthSq() > 0) normal.copy(sum).normalize();
    else normal.fromBufferAttribute(source, vertex); // Unused trimmed vertices.
    attribute.setXYZ(vertex, normal.x, normal.y, normal.z);
  }
  geometry.setAttribute('cartoonOutlineNormal', attribute);
}

/** Weld UV/material duplicates before comparing adjacent faces. Only genuine
 * open borders, strong corners and material joins survive; coplanar triangle
 * diagonals and smooth tessellation never become a wireframe. Built once. */
function hardContourGeometry(source: THREE.BufferGeometry, minimumLoopSpan = 0) {
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
  const selected = [...edges.values()].filter(edge => edge.uses === 1 || edge.border);
  const smallLoops = new Set<(typeof selected)[number]>();
  if (minimumLoopSpan > 0) {
    // Rotor perforations form disconnected tiny rings. Their real surfaces
    // already show the holes; inking each ring crowds out the disc boundaries.
    const adjacent = new Map<string, (typeof selected)[number][]>();
    for (const edge of selected) for (const vertex of [edge.a, edge.b]) {
      const list = adjacent.get(keys[vertex]);
      if (list) list.push(edge);
      else adjacent.set(keys[vertex], [edge]);
    }
    const seen = new Set<(typeof selected)[number]>();
    const bounds = new THREE.Box3(), point = new THREE.Vector3(), span = new THREE.Vector3();
    for (const first of selected) {
      if (seen.has(first)) continue;
      const component = [first]; seen.add(first); bounds.makeEmpty();
      for (let cursor = 0; cursor < component.length; cursor++) {
        const edge = component[cursor];
        for (const vertex of [edge.a, edge.b]) {
          bounds.expandByPoint(point.fromBufferAttribute(positions, vertex));
          for (const next of adjacent.get(keys[vertex])!) if (!seen.has(next)) {
            seen.add(next); component.push(next);
          }
        }
      }
      bounds.getSize(span);
      if (Math.max(span.x, span.y, span.z) < minimumLoopSpan)
        for (const edge of component) smallLoops.add(edge);
    }
  }
  const points: number[] = [];
  for (const edge of selected) {
    if (smallLoops.has(edge)) continue;
    for (const vertex of [edge.a, edge.b]) points.push(positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex));
    if (points.length >= CARTOON_CONTOUR_MAX_SEGMENTS * 6) break;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return geometry;
}

/** Small imported bikes batch their exhaust with unrelated metal. Recover
 * only connected authored shells beside the real outlet; never ink the whole
 * mechanics batch or create a replacement pipe. All work runs at construction.
 */
function bundledExhaustGeometry(mesh: THREE.Mesh, asset: ImportedBikeAsset, outletWorld: THREE.Vector3, scale: number) {
  const part = asset.manifest.parts.find(part => part.name === mesh.userData.importedPart);
  if (!part) return;
  const outlet = mesh.worldToLocal(outletWorld.clone()).divideScalar(scale);
  const positions = new Float32Array(asset.binary, part.position.offset, part.position.count * 3);
  const index = new Uint16Array(asset.binary, part.index.offset, part.index.count);
  const triangle = new THREE.Triangle(), closest = new THREE.Vector3();
  const selected: number[] = [];
  for (const component of hardwareComponents(part, asset.binary)) {
    const box = new THREE.Box3(new THREE.Vector3(...component.min), new THREE.Vector3(...component.max));
    const extents = box.getSize(new THREE.Vector3()).toArray().sort((a, b) => b - a);
    if (extents[0] < 0.09 || extents[1] < 0.035 || box.distanceToPoint(outlet) > 0.05) continue;
    let distance = Infinity;
    for (const face of component.triangles) {
      triangle.a.fromArray(positions, index[face * 3] * 3);
      triangle.b.fromArray(positions, index[face * 3 + 1] * 3);
      triangle.c.fromArray(positions, index[face * 3 + 2] * 3);
      triangle.closestPointToPoint(outlet, closest);
      distance = Math.min(distance, outlet.distanceTo(closest));
    }
    if (distance <= 0.05) selected.push(...component.triangles);
  }
  if (!selected.length) return;
  const sourcePosition = mesh.geometry.getAttribute('position'), sourceNormal = mesh.geometry.getAttribute('normal');
  const sourceIndex = mesh.geometry.index!;
  const vertices = new Map<number, number>(), points: number[] = [], normals: number[] = [], indices: number[] = [];
  for (const face of selected) for (let corner = 0; corner < 3; corner++) {
    const sourceVertex = sourceIndex.getX(face * 3 + corner);
    let vertex = vertices.get(sourceVertex);
    if (vertex === undefined) {
      vertex = vertices.size;
      vertices.set(sourceVertex, vertex);
      points.push(sourcePosition.getX(sourceVertex), sourcePosition.getY(sourceVertex), sourcePosition.getZ(sourceVertex));
      normals.push(sourceNormal.getX(sourceVertex), sourceNormal.getY(sourceVertex), sourceNormal.getZ(sourceVertex));
    }
    indices.push(vertex);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
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
    depthWrite: true,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    toneMapped: false,
  });
  Object.assign(material.defaultAttributeValues, { cartoonOutlineNormal: [0, 0, 0] });
  const candidates: { mesh: THREE.Mesh; geometry: THREE.BufferGeometry; priority: number; size: number; hardForm: boolean; exhaust: boolean }[] = [];
  const details: THREE.Mesh[] = [];
  const ownedGeometry = new Set<THREE.BufferGeometry>();
  const scale = new THREE.Vector3(), size = new THREE.Vector3();
  const position = new THREE.Vector3(), rotation = new THREE.Quaternion();
  root.updateWorldMatrix(true, true);
  const imported = root.getObjectByName('imported-motorcycle');
  const modelId: unknown = imported?.userData.importedBike;
  const asset = typeof modelId === 'string' && isImportedBike(modelId) ? getImportedBikeAsset(modelId) : undefined;
  const outlet = root.getObjectByName('open-silencer-outlet');
  const outletWorld = outlet?.getWorldPosition(new THREE.Vector3());
  const sourceScale = asset && typeof modelId === 'string' && isImportedBike(modelId)
    ? IMPORTED_BIKE_WHEELBASE[modelId] / Math.abs(asset.manifest.anchors.rearAxle[2] - asset.manifest.anchors.frontAxle[2]) : 1;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh ||
        object.userData.cartoonOutline || object.userData.bikeSticker || object.userData.helmetSticker) return;
    const name = `${object.name} ${object.userData.importedPart ?? ''}`.toLowerCase();
    // Real brake surfaces share their wheel/fork rig with an existing major
    // form. Keep their edges in that draw, never inflate thin discs as shells.
    const windscreen = object.userData.importedPart === 'r6_windscreen_glass:body';
    const brake = /brake_(friction_steel|steel|dark_carrier|carrier|caliper):/.test(name) ||
      /^moped_mechanics:(frontWheel|rearWheel)$/.test(object.userData.importedPart ?? '');
    if (brake || windscreen) {
      details.push(object);
      return;
    }
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
    const namedExhaust = /exhaust|headers?|manifold|silencer|muffler/.test(name);
    const bundled = asset && outletWorld && (modelId === '125' || modelId === 'moped' || modelId === 'scooter') &&
      /mechanics|chrome/.test(name) && (object.userData.importedRig === 'body' || object.userData.importedRig === 'swingarm')
      ? bundledExhaustGeometry(object, asset, outletWorld, sourceScale) : undefined;
    if (bundled) ownedGeometry.add(bundled);
    const exhaust = namedExhaust || !!bundled;
    // Imported models batch the FS450 mask into generic painted steering
    // bodywork. Its paint/rig metadata identifies the real shell reliably.
    const headlightMask = /headlight[-_](mask|bezel|recess)/.test(name) ||
      (paintedBodywork && object.userData.importedRig === 'steering');
    const bodywork = object.userData.bikePaintSurface || rim || exhaust ||
      /tire|tyre|seat|fairing|fender|mudguard|mudflap|side-cover|bodywork|shroud|tank|swingarm|crankcase|engine|fork-guard|fork-slider|stanchion|main-frame|headlight-(mask|bezel|recess)|tail-shell|rear-hugger|single-exhaust|silencer|muffler|carried-cap/.test(name);
    if (!rider && !bodywork && !object.userData.importedPart) return;
    const essential = rim || goggleFrame || exhaust || /helmet|motocross-peak|garment|mudflap/.test(name);
    const hardForm = !(object instanceof THREE.SkinnedMesh) &&
      (paintedBodywork || headlightMask || rim || goggleFrame || exhaust || /helmet|motocross-peak|fairing|fender|mudflap|side-cover|shroud|tank|tail-shell|rear-hugger/.test(name));
    candidates.push({ mesh: object, geometry: bundled ?? object.geometry, priority: headlightMask ? 4 : essential ? 3 : rider ? 2 : bodywork ? 1 : 0, size: extents[0] * extents[1], hardForm, exhaust });
  });
  candidates.sort((a, b) => b.priority - a.priority || b.size - a.size);
  const outlines: THREE.Mesh[] = [];
  for (const { mesh, geometry, exhaust } of candidates.slice(0, CARTOON_OUTLINE_MAX_MESHES)) {
    if (/^(tailored-garment|garment-sleeve)$/.test(mesh.name)) prepareGarmentOutlineNormals(geometry);
    let outline: THREE.Mesh;
    if (mesh instanceof THREE.SkinnedMesh) {
      const skin = new THREE.SkinnedMesh(geometry, material);
      skin.bindMode = mesh.bindMode;
      skin.bind(mesh.skeleton, mesh.bindMatrix);
      skin.bindMatrixInverse.copy(mesh.bindMatrixInverse);
      outline = skin;
    } else outline = new THREE.Mesh(geometry, material);
    outline.name = 'cartoon-hero-outline';
    outline.userData.cartoonOutline = true;
    outline.userData.cartoonExhaust = exhaust;
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
    depthWrite: true,
    depthTest: true,
    toneMapped: false,
  });
  const contourGeometry = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  const contours: THREE.LineSegments[] = [];
  const contourSources = new Set<THREE.Mesh>();
  for (const { mesh, geometry: sourceGeometry, hardForm, exhaust } of candidates) {
    if (!hardForm) continue;
    if (contours.length >= CARTOON_CONTOUR_MAX_MESHES) break;
    let geometry = contourGeometry.get(sourceGeometry);
    if (!geometry) {
      geometry = hardContourGeometry(sourceGeometry);
      contourGeometry.set(sourceGeometry, geometry);
    }
    if (!geometry.getAttribute('position').count) continue;
    const contour = new THREE.LineSegments(geometry, contourMaterial);
    contour.name = 'cartoon-hero-contour';
    contour.userData.cartoonContour = true;
    contour.userData.cartoonExhaust = exhaust;
    contour.userData.cartoonContourRanges = [{ source: mesh.uuid, start: 0, count: geometry.getAttribute('position').count }];
    mesh.userData.cartoonContourOwner = contour.uuid;
    contourSources.add(mesh);
    contour.frustumCulled = false;
    contour.layers.mask = mesh.layers.mask;
    contour.raycast = () => {};
    mesh.add(contour);
    contours.push(contour);
  }
  for (const mesh of details) {
    const rotor = /brake_(friction_steel|steel):/.test(mesh.name);
    mesh.getWorldScale(scale);
    const edges = hardContourGeometry(mesh.geometry, rotor ? 0.035 / Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)) : 0);
    const positions = edges.getAttribute('position');
    if (!positions.count) { edges.dispose(); continue; }
    // Exact shared parent means steering, suspension and wheel rotation stay
    // identical. A neighbouring rig can look aligned at rest and drift in play.
    const compatible = contours.filter(contour => contour.parent instanceof THREE.Mesh &&
      contour.parent.userData.importedPart && contour.parent.parent === mesh.parent &&
      contour.layers.mask === mesh.layers.mask);
    const owner = compatible.find(contour =>
      contour.geometry.getAttribute('position').count + positions.count <= CARTOON_CONTOUR_MAX_SEGMENTS * 2);
    if (!owner) { edges.dispose(); continue; }
    // Clone once before extending: the original edge cache may be borrowed by
    // another contour. Neither the cached edges nor any source buffer changes.
    if (!ownedGeometry.has(owner.geometry)) {
      owner.geometry = owner.geometry.clone();
      ownedGeometry.add(owner.geometry);
    }
    const original = owner.geometry.getAttribute('position');
    const combined = new Float32Array((original.count + positions.count) * 3);
    for (let vertex = 0; vertex < original.count; vertex++) {
      combined[vertex * 3] = original.getX(vertex);
      combined[vertex * 3 + 1] = original.getY(vertex);
      combined[vertex * 3 + 2] = original.getZ(vertex);
    }
    const transform = new THREE.Matrix4().copy(owner.parent!.matrixWorld).invert().multiply(mesh.matrixWorld);
    const point = new THREE.Vector3();
    for (let vertex = 0; vertex < positions.count; vertex++) {
      point.fromBufferAttribute(positions, vertex).applyMatrix4(transform);
      point.toArray(combined, (original.count + vertex) * 3);
    }
    owner.geometry.setAttribute('position', new THREE.BufferAttribute(combined, 3));
    owner.userData.cartoonContourRanges.push({ source: mesh.uuid, start: original.count, count: positions.count });
    mesh.userData.cartoonContourOwner = owner.uuid;
    contourSources.add(mesh);
    edges.dispose();
  }
  root.updateWorldMatrix(false, true);
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
      for (const source of contourSources) delete source.userData.cartoonContourOwner;
      // Source geometry and skeleton belong to the vehicle, never the shell.
      material.dispose();
      contourMaterial.dispose();
      for (const geometry of contourGeometry.values()) geometry.dispose();
      for (const geometry of ownedGeometry) geometry.dispose();
      active.delete(root);
    },
  };
  active.set(root, result);
  return result;
}
