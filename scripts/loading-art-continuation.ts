import * as THREE from 'three';

/** Static loading composition only. Continue the street with a shuffled set of
 * complete authored city cells, including every matching facade detail.
 * New instance buffers belong to this group; source materials/geometry do not. */
export function makeLoadingWorldContinuation(source: THREE.Object3D, seed = 42) {
  const cellLength = 12, horizon = 180;
  const road = source.getObjectByName('world-box-asphalt');
  if (!(road instanceof THREE.InstancedMesh)) throw new Error('Loading continuation requires the authored street.');
  road.geometry.computeBoundingBox();
  const matrix = new THREE.Matrix4(), bounds = new THREE.Box3();
  for (let i = 0; i < road.count; i++) {
    road.getMatrixAt(i, matrix);
    bounds.union(road.geometry.boundingBox!.clone().applyMatrix4(matrix));
  }
  const seam = bounds.max.z;
  if (!Number.isFinite(seam) || seam >= horizon) throw new Error('Loading street rear edge is outside the static horizon.');
  const rows = Math.ceil((horizon - seam) / cellLength), end = seam + rows * cellLength;
  // Full-depth main houses identify complete city cells. Partial segment-end
  // facades and distant silhouettes cannot be used as complete templates.
  const cityCounts = new Map<number, number>();
  for (const object of source.children) {
    if (!(object instanceof THREE.InstancedMesh) || !/^world-box-city[0-3]$/.test(object.name)) continue;
    for (let i = 0; i < object.count; i++) {
      object.getMatrixAt(i, matrix);
      if (Math.abs(matrix.elements[12]) >= 18 || Math.abs(matrix.elements[10] - 10.8) > .001) continue;
      const center = matrix.elements[14];
      cityCounts.set(center, (cityCounts.get(center) ?? 0) + 1);
    }
  }
  const cityCells = [...cityCounts].filter(([, count]) => count === 2).map(([center]) => center).sort((a, b) => a - b);
  if (!cityCells.length) throw new Error('Loading continuation requires complete authored city cells.');
  let random = seed >>> 0 || 1, previous = seam - cellLength / 2;
  const bag: number[] = [], rowCells: number[] = [];
  for (let row = 0; row < rows; row++) {
    if (!bag.length) {
      bag.push(...cityCells);
      for (let i = bag.length - 1; i > 0; i--) {
        random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
        const j = (random >>> 0) % (i + 1);
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      if (bag.length > 1 && bag[bag.length - 1] === previous)
        [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
    }
    previous = bag.pop()!; rowCells.push(previous);
  }
  const root = new THREE.Group(); root.name = 'loading-street-continuation';
  source.updateWorldMatrix(true, true);
  root.matrix.copy(source.matrixWorld); root.matrixAutoUpdate = false;
  const batches: THREE.InstancedMesh[] = [];
  const color = new THREE.Color();
  let instances = 0;
  for (const object of source.children) {
    if (!(object instanceof THREE.InstancedMesh) ||
        !(object.name.startsWith('world-box-') || object.name === 'world-round-dark')) continue;
    const terminal: number[] = [];
    for (let i = 0; i < object.count; i++) {
      object.getMatrixAt(i, matrix);
      const z = matrix.elements[14];
      if (z > seam - cellLength + 0.0001 && z <= seam + 0.0001) terminal.push(i);
    }
    const copies: { matrix: THREE.Matrix4; index: number }[] = [];
    if (object.name === 'world-box-marking') {
      // The gameplay dashes have a seven-metre cadence, independent of its
      // twelve-metre cells. Continue a complete actual dash instead of repeating
      // the short fragments clipped at the source cell boundary.
      for (const index of terminal) {
        object.getMatrixAt(index, matrix);
        const length = matrix.elements[10];
        if (Math.abs(length - cellLength) < 0.0001) {
          for (let row = 1; row <= rows; row++) {
            const copy = matrix.clone(); copy.elements[14] += row * cellLength;
            copies.push({ matrix: copy, index });
          }
        } else if (Math.abs(length - 3.8) < 0.0001) {
          const phase = matrix.elements[14] + length / 2;
          for (let upper = phase + Math.ceil((seam - phase) / 7) * 7; upper - 3.8 < end; upper += 7) {
            const a = Math.max(seam, upper - 3.8), b = Math.min(end, upper);
            if (b <= a) continue;
            const copy = matrix.clone(); copy.elements[10] = b - a; copy.elements[14] = (a + b) / 2;
            copies.push({ matrix: copy, index });
          }
        }
      }
    } else for (let row = 1; row <= rows; row++) {
      const street = /^world-box-(asphalt|sidewalk|curb|grass)$/.test(object.name);
      const center = street ? seam - cellLength / 2 : rowCells[row - 1];
      for (let index = 0; index < object.count; index++) {
        object.getMatrixAt(index, matrix);
        const z = matrix.elements[14];
        if (z <= center - cellLength / 2 + .0001 || z > center + cellLength / 2 + .0001) continue;
        matrix.elements[14] += seam + (row - .5) * cellLength - center;
        copies.push({ matrix: matrix.clone(), index });
      }
    }
    if (!copies.length) continue;
    const batch = new THREE.InstancedMesh(object.geometry, object.material, copies.length);
    batch.name = `loading-${object.name}`;
    batch.matrix.copy(object.matrix); batch.matrixAutoUpdate = false;
    batch.castShadow = object.castShadow; batch.receiveShadow = object.receiveShadow;
    batch.layers.mask = object.layers.mask; batch.frustumCulled = false;
    let instance = 0;
    for (const { matrix: copy, index } of copies) {
      batch.setMatrixAt(instance, copy);
      if (object.instanceColor) { object.getColorAt(index, color); batch.setColorAt(instance, color); }
      instance++;
    }
    batch.instanceMatrix.needsUpdate = true;
    if (batch.instanceColor) batch.instanceColor.needsUpdate = true;
    root.add(batch); batches.push(batch); instances += instance;
  }
  let disposed = false;
  return { root, seam, end, rows, instances, dispose() {
    if (disposed) return;
    disposed = true; root.removeFromParent();
    for (const batch of batches) batch.dispose();
    root.clear();
  } };
}
