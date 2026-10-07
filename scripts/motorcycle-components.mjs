/** Finds welded connected components without changing the supplied topology. */
export function connectedComponents(mesh, positions, THREE) {
  const count = positions.length / 3;
  const parent = Array.from({ length: count }, (_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const join = (a, b) => { parent[find(a)] = find(b); };
  const points = new Map();
  for (let i = 0; i < count; i++) {
    const key = [0, 1, 2].map(k => Math.round(positions[i * 3 + k] * 100000)).join(',');
    if (points.has(key)) join(i, points.get(key)); else points.set(key, i);
    if (i % 3) join(i, i - i % 3);
  }
  const groups = new Map();
  for (let i = 0; i < count; i++) {
    const id = find(i);
    if (!groups.has(id)) groups.set(id, { vertices: [], box: new THREE.Box3() });
    const component = groups.get(id);
    component.vertices.push(i);
    component.box.expandByPoint(new THREE.Vector3().fromArray(positions, i * 3));
  }
  const components = [...groups.values()].sort((a, b) => b.vertices.length - a.vertices.length);
  const byVertex = Array.from({ length: count });
  components.forEach((part, index) => {
    part.index = index;
    part.center = part.box.getCenter(new THREE.Vector3());
    part.vertices.forEach(vertex => { byVertex[vertex] = part; });
  });
  return { components, byVertex };
}
