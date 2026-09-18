import * as THREE from 'three';

/** A rim has a dished barrel; spokes terminate in its inner bed, not in the tire. */
export function motorcycleRim(
  wheel: THREE.Group,
  sport: boolean,
  radius: number,
  halfWidth: number,
  finish: THREE.Material,
  metal: THREE.Material,
) {
  // The side faces are part of the SAME lathed rim body.  This intentionally
  // replaces the temporary extra Torus "bed ring" from V47.
  //
  // From the side the painted surface now runs continuously from the tire bead
  // to the inner rim edge where the spoke nipples disappear behind the rim.
  const barrel = new THREE.LatheGeometry(
    [
      new THREE.Vector2(radius - 0.028, -halfWidth),
      new THREE.Vector2(radius + 0.001, -halfWidth),
      new THREE.Vector2(radius + 0.003, -halfWidth * 0.86),
      new THREE.Vector2(radius - 0.010, -halfWidth * 0.58),
      new THREE.Vector2(radius - 0.026, -halfWidth * 0.28),
      new THREE.Vector2(radius - 0.034, 0),
      new THREE.Vector2(radius - 0.026, halfWidth * 0.28),
      new THREE.Vector2(radius - 0.010, halfWidth * 0.58),
      new THREE.Vector2(radius + 0.003, halfWidth * 0.86),
      new THREE.Vector2(radius + 0.001, halfWidth),
      new THREE.Vector2(radius - 0.028, halfWidth),
    ],
    72,
  );
  barrel.rotateZ(Math.PI / 2);

  // Rim body is always the selected rim colour.
  const rim = new THREE.Mesh(barrel, finish);
  rim.name = 'formed-rim-barrel';
  rim.castShadow = rim.receiveShadow = true;
  wheel.add(rim);

  if (sport) {
    const shape = new THREE.Shape();
    const outline = [
      [0.043, -0.016],
      [0.105, -0.016],
      [radius - 0.026, -0.049],
      [radius - 0.008, -0.042],
      [radius - 0.012, -0.027],
      [0.139, 0],
      [radius - 0.012, 0.027],
      [radius - 0.008, 0.043],
      [radius - 0.026, 0.049],
      [0.105, 0.016],
      [0.043, 0.016],
    ];
    outline.forEach(([r, t], i) =>
      i ? shape.lineTo(r, t) : shape.moveTo(r, t),
    );
    shape.closePath();
    const cast = new THREE.ExtrudeGeometry(shape, {
      depth: 0.018,
      bevelEnabled: true,
      bevelThickness: 0.003,
      bevelSize: 0.003,
      bevelSegments: 2,
      steps: 1,
    });
    const positions = cast.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      const r = positions.getX(i),
        t = positions.getY(i),
        depth = positions.getZ(i);
      positions.setXYZ(i, depth - 0.009 + 0.012 * (r / radius) ** 2, r, t);
    }
    cast.computeVertexNormals();
    for (let i = 0; i < 5; i++) {
      const spoke = new THREE.Mesh(cast, finish);
      spoke.rotation.x = (i * Math.PI * 2) / 5;
      spoke.name = 'cast-y-spoke';
      spoke.castShadow = spoke.receiveShadow = true;
      wheel.add(spoke);
    }
  } else {
    // Supermoto: ONLY the spokes stay silver/metal.
    const count = 36;
    const spokes = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1, 1, 1, 6),
      metal,
      count,
    );
    const up = new THREE.Vector3(0, 1, 0),
      direction = new THREE.Vector3();
    const matrix = new THREE.Matrix4(),
      quaternion = new THREE.Quaternion();
    for (let i = 0; i < count; i++) {
      const a = (i * Math.PI * 2) / count,
        side = i % 2 ? 1 : -1;
      const crossing = Math.floor(i / 2) % 2 ? 0.62 : -0.62;
      const hub = new THREE.Vector3(
        side * 0.043,
        Math.cos(a + crossing) * 0.047,
        Math.sin(a + crossing) * 0.047,
      );
      const bed = new THREE.Vector3(
        side * halfWidth * 0.34,
        Math.cos(a) * (radius - 0.011),
        Math.sin(a) * (radius - 0.011),
      );
      direction.copy(bed).sub(hub);
      quaternion.setFromUnitVectors(up, direction.clone().normalize());
      matrix.compose(
        hub.add(bed).multiplyScalar(0.5),
        quaternion,
        new THREE.Vector3(0.0018, direction.length(), 0.0018),
      );
      spokes.setMatrixAt(i, matrix);
    }
    spokes.name = 'cross-laced-spokes';
    spokes.castShadow = true;
    spokes.instanceMatrix.needsUpdate = true;
    wheel.add(spokes);
  }
}
