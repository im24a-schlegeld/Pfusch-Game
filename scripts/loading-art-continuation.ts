import * as THREE from 'three';

/** Static loading composition only. Borrow the actual last city cell, including
 * its road finishes and facade details, past the gameplay pool's rear edge.
 * New instance buffers belong to this group; source materials/geometry do not. */
export function makeLoadingWorldContinuation(source: THREE.Object3D) {
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
    if (!terminal.length) continue;
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
    } else for (let row = 1; row <= rows; row++) for (const index of terminal) {
      object.getMatrixAt(index, matrix); matrix.elements[14] += row * cellLength;
      copies.push({ matrix: matrix.clone(), index });
    }
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
