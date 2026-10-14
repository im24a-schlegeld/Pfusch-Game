import * as THREE from 'three';
import type { ImportedBikeId, ImportedBikePart } from './importedBikeAsset';
import { hardwareComponents } from './importedHardwareFinish';

/** Refine decimated chords of the Sport's rim hoops before upload.
 * Keep its authored profile, original vertices, spokes, hub, UV seams and draw.
 * This is source-surface refinement, not a replacement wheel primitive. */
export function roundImportedRimProfile(
  id: ImportedBikeId, part: ImportedBikePart, binary: ArrayBuffer,
  axle: readonly number[], geometry: THREE.BufferGeometry,
) {
  if (id !== '701' || !/^r6_rim:(frontWheel|rearWheel)$/.test(part.name)) return;
  const source = new Float32Array(binary, part.position.offset, part.position.count * 3);
  const sourceIndex = new Uint16Array(binary, part.index.offset, part.index.count);
  const sourceRadius = (vertex: number) => Math.hypot(source[vertex * 3 + 1] - axle[1], source[vertex * 3 + 2] - axle[2]);
  const hoop = part.rig === 'frontWheel' ? new Set(hardwareComponents(part, binary).filter(component =>
    component.triangles.length > 100 && component.triangles.every(triangle => [0, 1, 2].every(corner => {
      return sourceRadius(sourceIndex[triangle * 3 + corner]) > 0.2;
    }))).flatMap(component => component.triangles)) : new Set(Array.from({ length: sourceIndex.length / 3 }, (_, triangle) => triangle)
      .filter(triangle => [0, 1, 2].every(corner => sourceRadius(sourceIndex[triangle * 3 + corner]) > 0.203)));
  if (!hoop.size) return;
  const positions = Array.from(geometry.getAttribute('position').array);
  const normals = Array.from(geometry.getAttribute('normal').array);
  const uv = geometry.getAttribute('uv');
  const uvs = uv ? Array.from(uv.array) : undefined;
  const midpoints = new Map<string, number>();
  const splitEdges = new Set<string>();
  const positionKey = (vertex: number) => positions.slice(vertex * 3, vertex * 3 + 3).map(value => Math.round(value * 1e6)).join(',');
  const edgeKey = (a: number, b: number) => [positionKey(a), positionKey(b)].sort().join(':');
  const angle = (a: number, b: number) => Math.acos(THREE.MathUtils.clamp(
    (positions[a * 3 + 1] * positions[b * 3 + 1] + positions[a * 3 + 2] * positions[b * 3 + 2]) /
      (Math.hypot(positions[a * 3 + 1], positions[a * 3 + 2]) * Math.hypot(positions[b * 3 + 1], positions[b * 3 + 2])), -1, 1));
  const midpoint = (a: number, b: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const cached = midpoints.get(key);
    if (cached !== undefined) return cached;
    const vertex = positions.length / 3;
    const ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const ar = Math.hypot(ay, az), br = Math.hypot(by, bz);
    const my = ay / ar + by / br, mz = az / ar + bz / br;
    const directionLength = Math.hypot(my, mz), y = my / directionLength, z = mz / directionLength;
    positions.push((positions[a * 3] + positions[b * 3]) / 2, y * (ar + br) / 2, z * (ar + br) / 2);
    // Interpolate the supplied axial/radial profile, rotating its radial part
    // to the new angle. Averaging world vectors alone flattens broad chords.
    const nx = (normals[a * 3] + normals[b * 3]) / 2;
    const nr = ((normals[a * 3 + 1] * ay + normals[a * 3 + 2] * az) / ar +
      (normals[b * 3 + 1] * by + normals[b * 3 + 2] * bz) / br) / 2;
    const length = Math.hypot(nx, nr);
    normals.push(nx / length, y * nr / length, z * nr / length);
    if (uvs) uvs.push((uvs[a * 2] + uvs[b * 2]) / 2, (uvs[a * 2 + 1] + uvs[b * 2 + 1]) / 2);
    midpoints.set(key, vertex);
    splitEdges.add(edgeKey(a, b));
    return vertex;
  };
  const fragments = new Map<number, number[]>();
  const pending: [number, number, number][] = [];
  // Complete hoop subdivision first, then match those same contact-edge splits
  // in adjacent spoke faces, including authored UV-seam duplicates. This keeps
  // the connected rear casting watertight without refining spoke interiors.
  for (const triangle of [...hoop, ...Array.from({ length: sourceIndex.length / 3 }, (_, i) => i).filter(i => !hoop.has(i))]) {
    const a = sourceIndex[triangle * 3], b = sourceIndex[triangle * 3 + 1], c = sourceIndex[triangle * 3 + 2];
    const result: number[] = []; fragments.set(triangle, result);
    pending.push([a, b, c]);
    while (pending.length) {
      const vertices = pending.pop()!;
      const angles = vertices.map((vertex, edge) => angle(vertex, vertices[(edge + 1) % 3]));
      const largest = Math.max(...angles);
      const edge = hoop.has(triangle) ? (largest > Math.PI / 32 + 0.000001 ? angles.indexOf(largest) : -1)
        : vertices.findIndex((vertex, side) => splitEdges.has(edgeKey(vertex, vertices[(side + 1) % 3])));
      if (edge === -1) { result.push(...vertices); continue; }
      const va = vertices[edge], vb = vertices[(edge + 1) % 3], vc = vertices[(edge + 2) % 3];
      const middle = midpoint(va, vb);
      pending.push([va, middle, vc], [middle, vb, vc]);
    }
  }
  const indices = Array.from({ length: sourceIndex.length / 3 }, (_, triangle) => fragments.get(triangle)!).flat();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  if (uvs) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
}
