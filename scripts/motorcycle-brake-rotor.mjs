/** Offline rotor replacement with real through holes, in source world coordinates. */
export function drilledRotor(THREE, { center, radius, thickness, rear = false }) {
  const ring = new THREE.Shape();
  const segments = 96;
  for (let i = 0; i <= segments; i++) {
    const angle = i / segments * Math.PI * 2;
    const r = radius * (.988 + .012 * Math.cos(angle * 12));
    const point = [Math.cos(angle) * r, Math.sin(angle) * r];
    if (i === 0) ring.moveTo(...point); else ring.lineTo(...point);
  }
  const circle = (x, y, r) => { const hole = new THREE.Path(); hole.absarc(x, y, r, 0, Math.PI * 2, true); return hole; };
  ring.holes.push(circle(0, 0, radius * .70));
  for (const [count, distance, phase] of (rear ? [[18, .91, 0], [12, .8, .12]] : [[24, .92, 0], [18, .8, .10]])) {
    for (let i = 0; i < count; i++) {
      const a = i / count * Math.PI * 2 + phase;
      ring.holes.push(circle(Math.cos(a) * radius * distance, Math.sin(a) * radius * distance, radius * .021));
    }
  }
  const carrier = new THREE.Shape();
  carrier.absarc(0, 0, radius * .721, 0, Math.PI * 2, false);
  carrier.holes.push(circle(0, 0, radius * .145));
  for (let sector = 0; sector < 6; sector++) {
    const middle = (sector + .5) * Math.PI / 3;
    const width = .35;
    const opening = new THREE.Path();
    for (let i = 0; i <= 8; i++) {
      const a = middle - width + 2 * width * i / 8;
      const point = [Math.cos(a) * radius * .64, Math.sin(a) * radius * .64];
      if (i === 0) opening.moveTo(...point); else opening.lineTo(...point);
    }
    for (let i = 8; i >= 0; i--) {
      const a = middle - width + 2 * width * i / 8;
      opening.lineTo(Math.cos(a) * radius * .29, Math.sin(a) * radius * .29);
    }
    opening.closePath();
    carrier.holes.push(opening);
  }
  const matrix = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0));
  matrix.setPosition(center[0] - thickness / 2, center[1], center[2]);
  const make = shape => new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, steps: 1, curveSegments: 4 }).applyMatrix4(matrix);
  const steel = make(ring), dark = make(carrier);
  const geometry = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2]]) {
    const a = steel.attributes[name].array, b = dark.attributes[name].array;
    const combined = new Float32Array(a.length + b.length);
    combined.set(a); combined.set(b, a.length);
    geometry.setAttribute(name, new THREE.BufferAttribute(combined, size));
  }
  const frictionVertices = steel.attributes.position.count;
  steel.dispose(); dark.dispose();
  return { geometry, frictionVertices };
}
