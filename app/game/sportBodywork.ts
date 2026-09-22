import * as THREE from 'three';
import {
  createSportDesign,
  mergeSportMeshes,
  SPORT_STYLE,
  type SportFinish,
  type SportMeshData,
} from './sportDesign';

// Authored data is immutable in practice; every Three.js geometry gets its own
// typed arrays. Recolouring/rebuilding a bike reuses the CPU-side design.
let cachedDesign: ReturnType<typeof createSportDesign> | undefined;

/** Convert our authored vertices without averaging away panel edge normals. */
function geometry(data: SportMeshData): THREE.BufferGeometry {
  const result = new THREE.BufferGeometry();
  result.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(data.positions, 3),
  );
  result.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute(data.normals, 3),
  );
  result.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
  result.setIndex(data.indices);
  result.computeBoundingBox();
  result.computeBoundingSphere();
  return result;
}

function finishes(
  paint: THREE.MeshStandardMaterial,
): Record<SportFinish, THREE.Material> {
  const lacquer = new THREE.MeshPhysicalMaterial({
    color: paint.color.clone(),
    roughness: 0.31,
    metalness: 0.1,
    clearcoat: SPORT_STYLE.clearcoat,
    clearcoatRoughness: 0.19,
    envMapIntensity: 1.0,
    side: THREE.DoubleSide,
  });
  return {
    paint: lacquer,
    carbon: new THREE.MeshStandardMaterial({
      color: '#171d22',
      roughness: 0.48,
      metalness: 0.18,
      side: THREE.DoubleSide,
    }),
    frame: new THREE.MeshStandardMaterial({
      color: '#343d43',
      roughness: 0.38,
      metalness: 0.58,
      side: THREE.DoubleSide,
    }),
    cavity: new THREE.MeshStandardMaterial({
      color: '#06090c',
      roughness: 0.94,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
    alloy: new THREE.MeshStandardMaterial({
      color: '#a4adb5',
      roughness: 0.29,
      metalness: 0.85,
      side: THREE.DoubleSide,
    }),
    titanium: new THREE.MeshStandardMaterial({
      color: '#596169',
      roughness: 0.4,
      metalness: 0.66,
      side: THREE.DoubleSide,
    }),
    rubber: new THREE.MeshStandardMaterial({
      color: '#14171a',
      roughness: 0.96,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
    light: new THREE.MeshStandardMaterial({
      color: '#eaf5ff',
      emissive: '#d9eaff',
      emissiveIntensity: 1.3,
      roughness: 0.19,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
    tailLight: new THREE.MeshStandardMaterial({
      color: '#c51d24',
      emissive: '#b91119',
      emissiveIntensity: 0.7,
      roughness: 0.24,
      metalness: 0.12,
      side: THREE.DoubleSide,
    }),
    lens: new THREE.MeshPhysicalMaterial({
      color: '#d6e4eb',
      transparent: true,
      opacity: 0.32,
      roughness: 0.08,
      metalness: 0.02,
      clearcoat: 1,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    screen: new THREE.MeshPhysicalMaterial({
      color: '#30424e',
      transparent: true,
      opacity: SPORT_STYLE.windshieldOpacity,
      roughness: 0.09,
      metalness: 0,
      clearcoat: 0.65,
      clearcoatRoughness: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  };
}

function replaceGeometry(
  mesh: THREE.Mesh,
  next: THREE.BufferGeometry,
  material: THREE.Material,
): void {
  const old = mesh.geometry;
  mesh.geometry = next;
  mesh.material = material;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  old.dispose();
}

/**
 * Drop-in replacement for the existing makeSportBodywork(body, paint, tank).
 * Only the Sport branch calls this function. No changes to the immutable
 * skeleton, grip/peg contacts, wheels, steering, suspension, physics or saves.
 * Called before tail mount construction, so mechanical mounts hit this skin.
 */
export function makeSportBodywork(
  parent: THREE.Object3D,
  paint: THREE.MeshStandardMaterial,
  tank?: THREE.Mesh,
): void {
  // A normal rebuild creates a fresh bike. This also protects accidental
  // repeated calls on the same instance from accumulating duplicate meshes.
  if (parent.children.some((child) => child.userData.pfuschSportS1 === true))
    return;

  const design = (cachedDesign ??= createSportDesign());
  const materials = finishes(paint);
  const assembly = new THREE.Group();
  assembly.name = 'sport-front-assembly';
  assembly.userData.pfuschSportS1 = true;
  assembly.userData.design = 'PFUSCH Sport 600';
  parent.add(assembly);

  // Opaque surfaces sharing a finish use one draw call, even though their
  // authored edges/normals remain independent. Keep glazing separately sorted
  // and the open intake individually addressable for clearance verification.
  const batched = new Map<
    SportFinish,
    { meshes: SportMeshData[]; names: string[] }
  >();
  for (const part of design.parts) {
    if (
      part.finish !== 'screen' &&
      part.finish !== 'lens' &&
      part.name !== 'sport-intake-throat'
    ) {
      const batch = batched.get(part.finish) ?? { meshes: [], names: [] };
      batch.meshes.push(part.geometry);
      batch.names.push(part.name);
      batched.set(part.finish, batch);
      continue;
    }
    const object = new THREE.Mesh(
      geometry(part.geometry),
      materials[part.finish],
    );
    object.name = part.name.replace(/-[LR]$/, '');
    object.userData.sportDesignPart = part.name;
    object.castShadow = part.finish !== 'screen' && part.finish !== 'light';
    object.receiveShadow = part.finish !== 'light';
    if (part.finish === 'screen' || part.finish === 'lens')
      object.renderOrder = 1;
    assembly.add(object);
  }
  for (const [finish, batch] of batched) {
    const object = new THREE.Mesh(
      geometry(mergeSportMeshes(batch.meshes)),
      materials[finish],
    );
    object.name =
      finish === 'tailLight' ? 'tail-light' : `sport-${finish}-surfaces`;
    object.userData.sportDesignParts = batch.names;
    object.castShadow = finish !== 'light' && finish !== 'tailLight';
    object.receiveShadow = finish !== 'light' && finish !== 'tailLight';
    assembly.add(object);
  }

  if (tank) replaceGeometry(tank, geometry(design.tank), materials.paint);
  else {
    const object = new THREE.Mesh(geometry(design.tank), materials.paint);
    object.name = 'sport-fuel-tank';
    object.castShadow = true;
    object.receiveShadow = true;
    assembly.add(object);
  }
  const tail = parent.getObjectByName('sport-tail-shell');
  if (tail instanceof THREE.Mesh) {
    replaceGeometry(tail, geometry(design.tail), materials.paint);
  } else {
    const object = new THREE.Mesh(geometry(design.tail), materials.paint);
    object.name = 'sport-tail-shell';
    object.castShadow = true;
    object.receiveShadow = true;
    assembly.add(object);
  }
}
