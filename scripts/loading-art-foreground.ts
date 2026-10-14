import * as THREE from 'three';

/** Static artwork only: a lamp beside the low camera can fill an entire edge
 * of the wide crop. Keep the authored background and restore every borrowed
 * instance buffer after the shot; the running game's street is unaffected. */
export function trimLoadingForegroundLamps(root: THREE.Object3D, camera: THREE.Camera, foregroundDepth: number) {
  const direction = camera.getWorldDirection(new THREE.Vector3());
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
  const world = new THREE.Vector3();
  const snapshots: { mesh: THREE.InstancedMesh; count: number; matrices: Float32Array; colors?: Float32Array }[] = [];
  let removed = 0;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.003;
  root.updateWorldMatrix(true, true);
  root.traverse(object => {
    if (!(object instanceof THREE.InstancedMesh) || !['world-round-dark', 'world-box-dark', 'world-box-lampCool'].includes(object.name)) return;
    const count = object.count;
    let keep = 0, saved = false;
    for (let i = 0; i < count; i++) {
      object.getMatrixAt(i, matrix); matrix.decompose(position, rotation, scale);
      const lamp = object.name === 'world-round-dark'
        ? near(scale.x, 0.065) && near(scale.y, 6.4) && near(scale.z, 0.065)
        : object.name === 'world-box-dark'
          ? near(scale.x, 1.7) && near(scale.y, 0.085) && near(scale.z, 0.1)
          : (near(scale.x, 0.65) || near(scale.x, 0.9)) && near(scale.y, 0.055) && near(scale.z, 0.25);
      const depth = world.copy(position).applyMatrix4(object.matrixWorld).sub(camera.position).dot(direction);
      if (lamp && depth > -1 && depth < foregroundDepth) {
        if (!saved) {
          snapshots.push({ mesh: object, count,
            matrices: Float32Array.from(object.instanceMatrix.array.slice(0, count * 16)),
            colors: object.instanceColor ? Float32Array.from(object.instanceColor.array.slice(0, count * 3)) : undefined });
          saved = true;
        }
        removed++;
        continue;
      }
      if (keep !== i) {
        object.setMatrixAt(keep, matrix);
        if (object.instanceColor) {
          const color = object.instanceColor;
          color.setXYZ(keep, color.getX(i), color.getY(i), color.getZ(i));
        }
      }
      keep++;
    }
    if (saved) {
      object.count = keep; object.instanceMatrix.needsUpdate = true;
      if (object.instanceColor) object.instanceColor.needsUpdate = true;
    }
  });
  let restored = false;
  return { removed, restore() {
    if (restored) return;
    restored = true;
    for (const { mesh, count, matrices, colors } of snapshots) {
      mesh.instanceMatrix.array.set(matrices); mesh.instanceMatrix.needsUpdate = true; mesh.count = count;
      if (colors && mesh.instanceColor) { mesh.instanceColor.array.set(colors); mesh.instanceColor.needsUpdate = true; }
    }
  } };
}
