import * as THREE from 'three';
import type { ImportedBikeId, ImportedBikePart } from './importedBikeAsset';

type Point = [number, number, number];
export interface HardwareComponent {
  triangles: number[];
  min: Point;
  max: Point;
}
const componentCache = new WeakMap<ImportedBikePart, HardwareComponent[]>();
const hardwarePartNames = new Set([
  'ciao_livery:fork', 'moped_fork_alloy:fork', 'fs450_fork_steel:steering',
  'fs450_hardware_metal:fork', 'r6_metal:steering', 'r6_metal:fork',
  'nitro_mechanics:fork', 'fs450_hardware_metal:shockLower',
  'r6_metal:shockUpper', 'nitro_mechanics:shockUpper',
]);

/** Recover connected authored shells once; UV seam duplicates share a position. */
export function hardwareComponents(part: ImportedBikePart, binary: ArrayBuffer) {
  const cached = componentCache.get(part);
  if (cached) return cached;
  const positions = new Float32Array(binary, part.position.offset, part.position.count * 3);
  const indices = new Uint16Array(binary, part.index.offset, part.index.count);
  const parents = Uint32Array.from({ length: part.position.count }, (_, i) => i);
  const root = (i: number): number => {
    while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; }
    return i;
  };
  const join = (a: number, b: number) => { parents[root(a)] = root(b); };
  const welded = new Map<string, number>();
  for (let i = 0; i < part.position.count; i++) {
    const key = [0, 1, 2].map(axis => Math.round(positions[i * 3 + axis] * 1e5)).join(',');
    const match = welded.get(key);
    if (match === undefined) welded.set(key, i); else join(i, match);
  }
  for (let i = 0; i < indices.length; i += 3) {
    join(indices[i], indices[i + 1]); join(indices[i], indices[i + 2]);
  }
  const groups = new Map<number, HardwareComponent>();
  for (let i = 0; i < indices.length; i += 3) {
    const key = root(indices[i]);
    let component = groups.get(key);
    if (!component) {
      component = { triangles: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      groups.set(key, component);
    }
    component.triangles.push(i / 3);
    for (let vertex = 0; vertex < 3; vertex++) for (let axis = 0; axis < 3; axis++) {
      const value = positions[indices[i + vertex] * 3 + axis];
      component.min[axis] = Math.min(component.min[axis], value);
      component.max[axis] = Math.max(component.max[axis], value);
    }
  }
  const result = [...groups.values()];
  componentCache.set(part, result);
  return result;
}

function blackComponent(id: ImportedBikeId, part: ImportedBikePart, c: HardwareComponent) {
  if (part.rig === 'swingarm' && !/chain|sprocket/i.test(part.name)) return true;
  const width = c.max[0] - c.min[0], height = c.max[1] - c.min[1];
  // These are connected source surfaces, not triangle cuts across a fork tube.
  // The Ciao fork and its painted fender happen to share the same source mesh.
  if (id === '125' && part.name === 'ciao_livery:fork') return width > 0.13;
  if (id === 'moped' && part.name === 'moped_fork_alloy:fork') return true;
  // Source atlas classification gave the left lever a silver material and
  // the right one dark trim. Finish both complete authored lever shells.
  if (id === '450' && /^fs450_cockpit_(metal|dark):steering$/.test(part.name))
    return width > 0.1 && height < 0.035 && c.min[1] > 1.13 && c.max[1] < 1.16 && c.max[2] < -0.28;
  if (id === '450' && part.name === 'fs450_fork_steel:steering')
    return height > 0.45 && width < 0.08;
  if (id === '450' && part.name === 'fs450_hardware_metal:fork')
    return c.max[1] < 0.34 && height > 0.06 && width > 0.045;
  if (id === '701' && part.name === 'r6_metal:steering')
    return height > 0.4 && width < 0.08;
  if (id === '701' && part.name === 'r6_metal:fork')
    return c.min[2] < -0.72 && height > 0.06 && c.max[1] < 0.42;
  if (id === 'scooter' && part.name === 'nitro_mechanics:fork')
    return height > 0.3 && width < 0.06;
  return false;
}

function springComponent(id: ImportedBikeId, part: ImportedBikePart, c: HardwareComponent) {
  const width = c.max[0] - c.min[0], height = c.max[1] - c.min[1];
  // The supplied helix is a separate connected shell from its chrome piston.
  if (id === '450' && part.name === 'fs450_hardware_metal:shockLower')
    return height > 0.2 && width > 0.07 && c.max[1] < 0.64;
  if (id === '701' && part.name === 'r6_metal:shockUpper')
    return height > 0.15 && width > 0.06 && c.min[1] > 0.39;
  // Nitro stores 41 individual winding segments, all inside this coil band.
  if (id === 'scooter' && part.name === 'nitro_mechanics:shockUpper')
    return height < 0.04 && width > 0.02 && c.min[1] > 0.45 && c.max[1] < 0.65;
  return false;
}

/** Material groups preserve the original mesh names, vertices and triangle order. */
export function createImportedHardwareFinisher(id: ImportedBikeId, binary: ArrayBuffer, paint: string) {
  const blackMaterials = new Map<THREE.MeshStandardMaterial, THREE.MeshStandardMaterial>();
  const springMaterials = new Map<THREE.MeshStandardMaterial, THREE.MeshStandardMaterial>();
  const finish = (source: THREE.MeshStandardMaterial, spring: boolean) => {
    const cache = spring ? springMaterials : blackMaterials;
    let material = cache.get(source);
    if (!material) {
      material = source.clone();
      material.color.set(spring ? paint : '#101214');
      material.map = material.normalMap = null;
      material.metalness = spring ? 0.3 : 0.16;
      material.roughness = spring ? 0.4 : 0.72;
      material.userData.rimPalette = false;
      material.userData.fixedHardwareFinish = !spring;
      material.userData.bikePaintSurface = false;
      if (spring) material.userData.appearanceColorSlot = 'paint';
      else delete material.userData.appearanceColorSlot;
      cache.set(source, material);
    }
    return material;
  };
  return (mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>, part: ImportedBikePart) => {
    if (id === '450' && /^fs450_cockpit_(metal|dark):steering$/.test(part.name)) {
      // Lever triangles are interleaved with fittings in each source bucket.
      // A static color attribute retains one draw and the original index order.
      const components = hardwareComponents(part, binary).filter(component => blackComponent(id, part, component));
      if (!components.length) return;
      const indices = new Uint16Array(binary, part.index.offset, part.index.count);
      const colors = new Float32Array(part.position.count * 3);
      for (let vertex = 0; vertex < part.position.count; vertex++) mesh.material.color.toArray(colors, vertex * 3);
      const black = new THREE.Color('#101214');
      for (const component of components) for (const triangle of component.triangles)
        for (let corner = 0; corner < 3; corner++) black.toArray(colors, indices[triangle * 3 + corner] * 3);
      const material = mesh.material.clone();
      material.color.set('#ffffff');
      material.vertexColors = true;
      material.userData.fixedHardwareFinish = true;
      delete material.userData.appearanceColorSlot;
      mesh.material = material;
      mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      mesh.userData.bikePaintSurface = false;
      mesh.userData.hardwareLeverMask = true;
      return;
    }
    if (id === '701' && part.name === 'r6_brake_caliper:fork') {
      // The source joins each axle casting to its bronze brake caliper in one
      // continuous shell. Color the forward casting only, in the source frame;
      // a static vertex mask keeps the original one draw call and index order.
      const positions = new Float32Array(binary, part.position.offset, part.position.count * 3);
      const colors = new Float32Array(part.position.count * 3);
      const bronze = mesh.material.color, black = new THREE.Color('#101214');
      for (let i = 0; i < part.position.count; i++) {
        const color = positions[i * 3 + 2] < -0.603 ? black : bronze;
        color.toArray(colors, i * 3);
      }
      const material = mesh.material.clone();
      material.color.set('#ffffff');
      material.vertexColors = true;
      material.userData.fixedHardwareFinish = true;
      delete material.userData.appearanceColorSlot;
      mesh.material = material;
      mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      mesh.userData.bikePaintSurface = false;
      mesh.userData.hardwareForkFootMask = true;
      return;
    }
    const relevant = part.rig === 'swingarm' || hardwarePartNames.has(part.name);
    if (!relevant) return;
    const roles = new Uint8Array(part.index.count / 3);
    for (const component of hardwareComponents(part, binary)) {
      const role = springComponent(id, part, component) ? 2 : blackComponent(id, part, component) ? 1 : 0;
      if (role) for (const triangle of component.triangles) roles[triangle] = role;
    }
    if (!roles.some(Boolean)) return;
    const original = mesh.material;
    const materials = [original];
    if (roles.includes(1)) materials[1] = finish(original, false);
    if (roles.includes(2)) {
      materials[1] ??= original;
      materials[2] = finish(original, true);
    }
    const geometry = mesh.geometry;
    geometry.clearGroups();
    let start = 0;
    for (let i = 1; i <= roles.length; i++) {
      if (i < roles.length && roles[i] === roles[start]) continue;
      geometry.addGroup(start * 3, (i - start) * 3, roles[start]); start = i;
    }
    // The generic Mesh type keeps array materials legal without replacing the mesh.
    (mesh as THREE.Mesh).material = materials;
    if (roles.every(role => role !== 0)) mesh.userData.bikePaintSurface = false;
    mesh.userData.hardwareFinishGroups = true;
  };
}
