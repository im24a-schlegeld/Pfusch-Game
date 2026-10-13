import type { Object3D } from 'three';

/** Snapshot transforms once at impact. Restore the same meshes and adult rig;
 * no second model, texture load or skeleton reconstruction is needed. */
export function captureRidePose(root: Object3D) {
  const poses: { object: Object3D; position: Object3D['position']; quaternion: Object3D['quaternion'];
    scale: Object3D['scale']; matrix: Object3D['matrix'] }[] = [];
  root.traverse(object => poses.push({ object, position: object.position.clone(),
    quaternion: object.quaternion.clone(), scale: object.scale.clone(), matrix: object.matrix.clone() }));
  return () => {
    for (const pose of poses) {
      pose.object.position.copy(pose.position);
      pose.object.quaternion.copy(pose.quaternion);
      pose.object.scale.copy(pose.scale);
      pose.object.matrix.copy(pose.matrix);
      pose.object.matrixWorldNeedsUpdate = true;
    }
    root.updateMatrixWorld(true);
  };
}
