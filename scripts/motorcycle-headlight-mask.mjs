import { loadMotorcycleSource } from './build-motorcycle-asset.mjs';
import { connectedComponents } from './motorcycle-components.mjs';

/** Extracts the supplied KTM lamp assembly, removing the source steering pose. */
export function importHeadlightMask(path, destination, paintMaterial) {
  const source = loadMotorcycleSource(path);
  const { THREE } = source;
  // Orthonormal lens frame measured from the supplied source's glass surface.
  const center = new THREE.Vector3(.0910053294, .704200081, .4717521621);
  const right = new THREE.Vector3(.8966477419, -.2366399062, -.3741983187);
  const up = new THREE.Vector3(.0616399881, .9036690401, -.4237720824);
  const front = new THREE.Vector3().crossVectors(right, up).normalize();
  const point = new THREE.Vector3();
  const local = values => {
    point.fromArray(values).sub(center);
    return [point.dot(right), point.dot(up), point.dot(front)];
  };
  const mount = new THREE.Vector3(0, .895, .47);
  const slope = .26, c = Math.cos(slope), s = Math.sin(slope), scale = .90;
  // Broader shoulders and a shallower lower bowl give the game lamp its own
  // contour. Shell, glass and reflector share the deformation and raised mount.
  const profile = y => {
    const t = Math.max(0, Math.min(1, (-.015 - y) / .08));
    const blend = t * t * (3 - 2 * t);
    const derivative = t > 0 && t < 1 ? -6 * t * (1 - t) / .08 : 0;
    return { width: 1.03 + .08 * blend, widthSlope: .08 * derivative,
      height: y + .014 * blend, heightSlope: 1 + .014 * derivative };
  };
  const transform = ([x, y, z]) => {
    const { width, height } = profile(y);
    return [x * width * scale + mount.x,
      (height * c + z * s) * scale + mount.y, (-height * s + z * c) * scale + mount.z];
  };
  const transformNormal = (values, location) => {
    point.fromArray(values);
    const normalX = point.dot(right), normalY = point.dot(up), z = point.dot(front);
    const { width, widthSlope, heightSlope } = profile(location[1]);
    const x = normalX / width, y = (normalY - location[0] * widthSlope * x) / heightSlope;
    return [x, y * c + z * s, -y * s + z * c];
  };
  const lensMaterial = { name: 'fs450_headlight_glass', color: '#c7d7df', metalness: .05, roughness: .12, opacity: .42, transparent: true, doubleSided: true };
  const reflectorMaterial = { name: 'fs450_headlight_reflector', color: '#c8ccd0', metalness: .65, roughness: .2 };
  const selected = [
    ['Object_1', [1], paintMaterial, true],
    ['Object_0', [0], lensMaterial, false],
    ['Object_7', [3, 6, 7], reflectorMaterial, false],
  ];
  const result = [];
  for (const [name, ids, material, clip] of selected) {
    const original = source.meshes.find(mesh => mesh.name === name);
    const positions = source.worldPositions.get(name), normals = source.worldNormals.get(name);
    const components = connectedComponents(original, positions, THREE);
    const outputPositions = [], outputNormals = [], outputUvs = [];
    for (let vertex = 0; vertex < positions.length / 3; vertex += 3) {
      if (!ids.includes(components.byVertex[vertex].index)) continue;
      const triangle = [0, 1, 2].map(corner => local(positions.subarray((vertex + corner) * 3, (vertex + corner) * 3 + 3)));
      // The source has welded the front fender to the mask. Select the lamp
      // shell above its bottom lip and behind the separate fender surface.
      if (clip && triangle.some(([x, y, z]) => y < -.091 || Math.abs(x) > .158 || z > .05 || z < -.095)) continue;
      for (let corner = 0; corner < 3; corner++) {
        outputPositions.push(...transform(triangle[corner]));
        outputNormals.push(...transformNormal(normals.subarray((vertex + corner) * 3, (vertex + corner) * 3 + 3), triangle[corner]));
        outputUvs.push(0, 0);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(outputPositions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(outputNormals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(outputUvs, 2));
    const mesh = new THREE.Mesh(geometry);
    mesh.name = 'imported_mask_' + name;
    mesh.userData.exportMaterial = material;
    destination.meshes.push(mesh);
    destination.worldPositions.set(mesh.name, geometry.attributes.position.array);
    destination.worldNormals.set(mesh.name, geometry.attributes.normal.array);
    result.push({ name: mesh.name, triangles: outputPositions.length / 9 });
  }
  console.log('Imported lamp assembly', result);
  return transform([0, -.01, .007]);
}
