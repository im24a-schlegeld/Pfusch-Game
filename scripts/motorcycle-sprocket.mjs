/** Convert a supplied sprocket texture's cutout mask into physical metal. */
export function perforatedSprocket(THREE, mesh, positions, atlas, { maskChannel = 'dark', expectedOpenings = 19 } = {}) {
  const uv = mesh.geometry.attributes.uv;
  const { data, info } = atlas;
  if (maskChannel === 'alpha' && info.channels !== 4) throw new Error('Sprocket alpha mask requires an RGBA source atlas.');
  const width = info.width, height = info.height;
  const points = [];
  let best = 0, triangle = 0;
  for (let i = 0; i < uv.count; i += 3) {
    const det = (uv.getX(i + 1) - uv.getX(i)) * (uv.getY(i + 2) - uv.getY(i))
      - (uv.getX(i + 2) - uv.getX(i)) * (uv.getY(i + 1) - uv.getY(i));
    if (Math.abs(det) > Math.abs(best)) { best = det; triangle = i; }
    for (let j = 0; j < 3; j++) points.push([uv.getX(i + j), uv.getY(i + j)]);
  }
  if (Math.abs(best) < 1e-8) throw new Error('Sprocket has no usable source UV plane.');
  const p = triangle * 3, u0 = uv.getX(triangle), v0 = uv.getY(triangle);
  const du1 = uv.getX(triangle + 1) - u0, du2 = uv.getX(triangle + 2) - u0;
  const dv1 = uv.getY(triangle + 1) - v0, dv2 = uv.getY(triangle + 2) - v0;
  const atUV = (u, v) => [1, 2].map(axis => {
    const dp1 = positions[p + 3 + axis] - positions[p + axis];
    const dp2 = positions[p + 6 + axis] - positions[p + axis];
    return positions[p + axis] + (dp1 * dv2 - dp2 * dv1) / best * (u - u0)
      + (dp2 * du1 - dp1 * du2) / best * (v - v0);
  });
  // Keep the supplied disc footprint: the source texture continues beyond it.
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = values => {
    const out = [];
    for (const point of values) {
      while (out.length > 1 && cross(out.at(-2), out.at(-1), point) <= 1e-12) out.pop();
      out.push(point);
    }
    return out.slice(0, -1);
  };
  const hull = [...half(points), ...half([...points].reverse())];
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * info.channels;
    const sample = [(x + .5) / width, 1 - (y + .5) / height];
    const metal = maskChannel === 'alpha' ? data[offset + 3] >= 128
      : Math.max(data[offset], data[offset + 1], data[offset + 2]) < 112;
    if (metal
      && hull.every((a, i) => cross(a, hull[(i + 1) % hull.length], sample) >= 0)) mask[y * width + x] = 1;
  }
  // JPEG edge speckles are not metal. Keep only the connected sprocket body.
  const seen = new Uint8Array(mask.length);
  let largest = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const queue = [start]; seen[start] = 1;
    for (let i = 0; i < queue.length; i++) {
      const index = queue[i], x = index % width, y = Math.floor(index / width);
      for (const next of [x > 0 ? index - 1 : -1, x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1, y + 1 < height ? index + width : -1]) {
        if (next >= 0 && mask[next] && !seen[next]) { seen[next] = 1; queue.push(next); }
      }
    }
    if (queue.length > largest.length) largest = queue;
  }
  mask.fill(0); for (const index of largest) mask[index] = 1;
  const edges = new Map(), stride = width + 1;
  const edge = (a, b) => { if (!edges.has(a)) edges.set(a, []); edges.get(a).push(b); };
  for (const index of largest) {
    const x = index % width, y = Math.floor(index / width), top = y * stride + x;
    if (y === 0 || !mask[index - width]) edge(top, top + 1);
    if (x === width - 1 || !mask[index + 1]) edge(top + 1, top + stride + 1);
    if (y === height - 1 || !mask[index + width]) edge(top + stride + 1, top + stride);
    if (x === 0 || !mask[index - 1]) edge(top + stride, top);
  }
  const loops = [];
  while (edges.size) {
    const start = edges.keys().next().value, loop = [];
    let current = start;
    do {
      loop.push([current % stride, Math.floor(current / stride)]);
      const next = edges.get(current);
      if (!next?.length) throw new Error('Sprocket mask contour is open.');
      const previous = current; current = next.pop();
      if (!next.length) edges.delete(previous);
    } while (current !== start);
    loops.push(simplifyClosed(loop, 1));
  }
  const area = loop => Math.abs(loop.reduce((sum, point, i) => {
    const next = loop[(i + 1) % loop.length]; return sum + point[0] * next[1] - point[1] * next[0];
  }, 0));
  loops.sort((a, b) => area(b) - area(a));
  const useful = loops.filter(loop => area(loop) > 18);
  // FS450 default: central bore, six broad slots and twelve bolt holes.
  if (useful.length < 2 || expectedOpenings !== null && useful.length !== expectedOpenings + 1)
    throw new Error(`Unexpected sprocket opening count: ${useful.length - 1} (expected ${expectedOpenings}).`);
  const paths = useful.map((loop, index) => {
    const points = loop.map(([x, y]) => new THREE.Vector2(...atUV(x / width, 1 - y / height)));
    return index === 0 ? new THREE.Shape(points) : new THREE.Path(points);
  });
  const shape = paths[0]; shape.holes.push(...paths.slice(1));
  const bounds = new THREE.Box3().setFromArray(positions);
  const matrix = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0));
  matrix.setPosition(bounds.min.x, 0, 0);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: bounds.max.x - bounds.min.x,
    bevelEnabled: false, steps: 1, curveSegments: 1 }).applyMatrix4(matrix);
  return { geometry, openings: paths.length - 1 };
}

function simplifyClosed(points, tolerance) {
  const distance = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  const simplify = line => {
    let max = tolerance, split = -1;
    for (let i = 1; i < line.length - 1; i++) {
      const d = distance(line[i], line[0], line.at(-1));
      if (d > max) { max = d; split = i; }
    }
    return split < 0 ? [line[0], line.at(-1)] : [...simplify(line.slice(0, split + 1)).slice(0, -1), ...simplify(line.slice(split))];
  };
  let split = 1;
  for (let i = 2; i < points.length; i++)
    if (Math.hypot(...points[i].map((v, k) => v - points[0][k])) > Math.hypot(...points[split].map((v, k) => v - points[0][k]))) split = i;
  return [...simplify(points.slice(0, split + 1)).slice(0, -1), ...simplify([...points.slice(split), points[0]]).slice(0, -1)];
}
