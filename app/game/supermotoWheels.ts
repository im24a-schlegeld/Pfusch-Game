import * as THREE from 'three';
import { SUPERMOTO_WHEELS } from './supermotoWheelDimensions';
export { SUPERMOTO_WHEELS } from './supermotoWheelDimensions';

function wheelSize(rear: boolean) {
  return rear ? SUPERMOTO_WHEELS.rear : SUPERMOTO_WHEELS.front;
}

/** Revolve an explicit carcass section: narrow bead, defined sidewall and
 * shoulder, broad crowned road tread. Linear profile stations avoid spline
 * overshoot of the chosen rolling radius and section width. */
export function supermotoTireGeometry(rear: boolean) {
  const size = wheelSize(rear);
  const half = size.tireWidth / 2;
  const height = size.outerRadius - size.beadRadius;
  const beadHalf = size.rimWidth / 2;
  const halfProfile = [
    new THREE.Vector2(size.beadRadius - 0.0015, -beadHalf),
    new THREE.Vector2(size.beadRadius + 0.004, -beadHalf - 0.003),
    new THREE.Vector2(size.beadRadius + height * 0.18, -half * 0.91),
    new THREE.Vector2(size.beadRadius + height * 0.36, -half * 0.98),
    new THREE.Vector2(size.beadRadius + height * 0.51, -half),
    new THREE.Vector2(size.beadRadius + height * 0.64, -half * 0.98),
    new THREE.Vector2(size.beadRadius + height * 0.76, -half * 0.92),
    new THREE.Vector2(size.beadRadius + height * 0.85, -half * 0.82),
    new THREE.Vector2(size.beadRadius + height * 0.92, -half * 0.68),
    new THREE.Vector2(size.beadRadius + height * 0.965, -half * 0.49),
    new THREE.Vector2(size.beadRadius + height * 0.991, -half * 0.25),
  ];
  const profile = [
    ...halfProfile,
    new THREE.Vector2(size.outerRadius, 0),
    ...[...halfProfile]
      .reverse()
      .map((point) => new THREE.Vector2(point.x, -point.y)),
    halfProfile[0].clone(),
  ];
  const geometry = new THREE.LatheGeometry(profile, 80);
  geometry.rotateZ(Math.PI / 2);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Closed dished aluminium section including both thin lips. No extra torus
 * is needed; its outer edge and bead seat can be sized independently. */
export function supermotoRimGeometry(rear: boolean) {
  const size = wheelSize(rear);
  const half = size.rimWidth / 2;
  const bead = size.beadRadius;
  const edge = size.rimEdgeRadius;
  const profile = [
    [bead - 0.009, -half - 0.0035],
    [edge - 0.002, -half - 0.0035],
    [edge, -half - 0.002],
    [edge, -half],
    [bead, -half + 0.0015],
    [bead - 0.002, -half * 0.78],
    [bead - 0.01, -half * 0.45],
    [bead - 0.01, half * 0.45],
    [bead - 0.002, half * 0.78],
    [bead, half - 0.0015],
    [edge, half],
    [edge, half + 0.002],
    [edge - 0.002, half + 0.0035],
    [bead - 0.009, half + 0.0035],
    [bead - 0.012, half * 0.78],
    [bead - 0.015, half * 0.45],
    [bead - 0.015, -half * 0.45],
    [bead - 0.012, -half * 0.78],
    [bead - 0.009, -half - 0.0035],
  ];
  const geometry = new THREE.LatheGeometry(
    profile.map(([radius, x]) => new THREE.Vector2(radius, x)),
    80,
  );
  geometry.rotateZ(Math.PI / 2);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Both endpoints sit within solid metal: the hub flange and the rim well. */
export function supermotoSpokeEndpoints(rear: boolean, index: number) {
  const size = wheelSize(rear);
  const angle = (index / 36) * Math.PI * 2;
  const side = index % 2 ? 1 : -1;
  const crossing = Math.floor(index / 2) % 2 ? 0.62 : -0.62;
  return {
    hub: new THREE.Vector3(
      side * size.spokeHubX,
      Math.cos(angle + crossing) * (size.spokeHubRadius - 0.002),
      Math.sin(angle + crossing) * (size.spokeHubRadius - 0.002),
    ),
    bed: new THREE.Vector3(
      side * size.rimWidth * 0.12,
      Math.cos(angle) * size.spokeBedRadius,
      Math.sin(angle) * size.spokeBedRadius,
    ),
  };
}

/** Only the Supermoto uses this wire wheel. All parts share the spinning
 * wheel group's origin/axis; the brake caliper remains on its axle carrier. */
export function addSupermotoRim(
  wheel: THREE.Group,
  rear: boolean,
  finish: THREE.Material,
  metal: THREE.Material,
) {
  const size = wheelSize(rear);
  const barrel = new THREE.Mesh(supermotoRimGeometry(rear), finish);
  barrel.name = 'formed-rim-barrel';
  barrel.castShadow = barrel.receiveShadow = true;
  wheel.add(barrel);

  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(
      size.hubRadius,
      size.hubRadius,
      size.hubHalfWidth * 2,
      24,
    ),
    finish,
  );
  hub.rotation.z = Math.PI / 2;
  hub.name = 'supermoto-wheel-hub';
  hub.castShadow = hub.receiveShadow = true;
  wheel.add(hub);
  const flangeGeometry = new THREE.CylinderGeometry(
    size.spokeHubRadius,
    size.spokeHubRadius,
    0.008,
    32,
  );
  for (const side of [-1, 1]) {
    const flange = new THREE.Mesh(flangeGeometry, finish);
    flange.rotation.z = Math.PI / 2;
    flange.position.x = side * size.spokeHubX;
    flange.name = 'supermoto-hub-flange';
    flange.castShadow = flange.receiveShadow = true;
    wheel.add(flange);
  }

  // The six existing rotor arms begin at radius 46 mm on this outer face.
  // Join that face to the hub rather than leaving the carrier floating
  // axially beside the shorter wire-spoke flanges.
  const brakeSide = Math.sign(size.brakeMountX);
  const mountStart = brakeSide * size.spokeHubX;
  const brakeMount = new THREE.Mesh(
    new THREE.CylinderGeometry(
      0.049,
      size.hubRadius + 0.001,
      Math.abs(size.brakeMountX - mountStart),
      32,
    ),
    finish,
  );
  brakeMount.rotation.z = (-brakeSide * Math.PI) / 2;
  brakeMount.position.x = (size.brakeMountX + mountStart) / 2;
  brakeMount.name = 'supermoto-brake-hub-mount';
  brakeMount.castShadow = brakeMount.receiveShadow = true;
  wheel.add(brakeMount);

  const spokes = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(1, 1, 1, 6),
    metal,
    36,
  );
  const direction = new THREE.Vector3();
  const midpoint = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0);
  for (let index = 0; index < 36; index++) {
    const { hub: start, bed } = supermotoSpokeEndpoints(rear, index);
    direction.copy(bed).sub(start);
    const length = direction.length();
    rotation.setFromUnitVectors(up, direction.divideScalar(length));
    midpoint.copy(start).add(bed).multiplyScalar(0.5);
    scale.set(0.00165, length, 0.00165);
    matrix.compose(midpoint, rotation, scale);
    spokes.setMatrixAt(index, matrix);
  }
  spokes.name = 'cross-laced-spokes';
  spokes.castShadow = true;
  spokes.instanceMatrix.needsUpdate = true;
  spokes.computeBoundingBox();
  spokes.computeBoundingSphere();
  wheel.add(spokes);
}
