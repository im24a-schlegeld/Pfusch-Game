import * as THREE from 'three';
import { SUPERMOTO_SHOCK_BOTTOM } from './supermotoFit';
import { SUPERMOTO_SWINGARM } from './supermotoSwingarm';

const bridgeZ = 0.315;
export const SUPERMOTO_SHOCK_LOWER_MOUNT = Object.freeze({
  bridge: [0, THREE.MathUtils.lerp(SUPERMOTO_SWINGARM.pivotY, SUPERMOTO_SWINGARM.axleY,
    (bridgeZ - SUPERMOTO_SWINGARM.pivotZ) / (SUPERMOTO_SWINGARM.axleZ - SUPERMOTO_SWINGARM.pivotZ)), bridgeZ] as const,
  eye: SUPERMOTO_SHOCK_BOTTOM,
});

/** A short pair of formed ears welded to the existing arm bridge. The upper
 * eye is a real open hole; the shock pin and its clevis follow the rigid arm. */
export function addSupermotoShockMount(body: THREE.Group, alloy: THREE.Material, dark: THREE.Material) {
  const base = new THREE.Vector3(...SUPERMOTO_SHOCK_LOWER_MOUNT.bridge);
  const eye = new THREE.Vector3(...SUPERMOTO_SHOCK_LOWER_MOUNT.eye);
  const delta = eye.clone().sub(base), length = delta.length();
  const shape = new THREE.Shape();
  shape.absarc(0, 0, 0.014, Math.PI, Math.PI * 2, false);
  shape.lineTo(0.015, length);
  shape.absarc(0, length, 0.015, 0, Math.PI, false);
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, length, 0.010, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  for (const side of [-1, 1]) {
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: true,
      bevelThickness: 0.0007, bevelSize: 0.001, bevelSegments: 1, steps: 1, curveSegments: 12 });
    geometry.rotateY(Math.PI / 2);
    geometry.rotateX(Math.atan2(delta.z, delta.y));
    geometry.translate(side * 0.033 - 0.004, base.y, base.z);
    const cheek = new THREE.Mesh(geometry, alloy); cheek.name = 'shock-lower-link';
    cheek.castShadow = cheek.receiveShadow = true; body.add(cheek);
  }
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0095, 0.087, 20), dark);
  pin.rotation.z = Math.PI / 2; pin.position.copy(eye);
  pin.name = 'supermoto-shock-lower-pin';
  pin.castShadow = pin.receiveShadow = true; body.add(pin);
}
