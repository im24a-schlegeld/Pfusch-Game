import * as THREE from 'three';

/** Turn the actual open garment edge inward, with no second belt-shaped shell. */
export function foldGarmentHem(
  parent: THREE.Group,
  torso: THREE.Mesh,
  sides = 24,
) {
  const source = torso.geometry.getAttribute('position');
  const uv = torso.geometry.getAttribute('uv');
  const index = torso.geometry.getIndex()!;
  const open: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i),
      b = index.getX(i + 1),
      c = index.getX(i + 2);
    if (a <= sides && b <= sides && c <= sides) continue;
    open.push(a, b, c);
  }
  torso.geometry.setIndex(open);
  torso.geometry.computeVertexNormals();
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  for (const [inset, dy] of [
    [0, 0],
    [0.002, -0.002],
    [0.004, 0.009],
  ]) {
    for (let j = 0; j <= sides; j++) {
      const x = source.getX(j),
        y = source.getY(j),
        z = source.getZ(j);
      const radius = Math.hypot(x, z);
      const scale = 1 - inset / Math.max(radius, 0.001);
      positions.push(x * scale, y + dy, z * scale);
      uvs.push(uv.getX(j), uv.getY(j) + Math.max(0, dy) / 0.675);
    }
  }
  for (let row = 0; row < 2; row++)
    for (let j = 0; j < sides; j++) {
      const a = row * (sides + 1) + j,
        b = a + sides + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const hem = new THREE.Mesh(geometry, torso.material);
  hem.name = 'folded-garment-hem';
  hem.castShadow = hem.receiveShadow = true;
  parent.add(hem);
  return hem;
}

/** Sewn panels sampled directly from the draped torso, including its existing UVs. */
export function addGarmentPockets(
  parent: THREE.Group,
  torso: THREE.Mesh,
  split: boolean,
  seamMaterial: THREE.Material,
) {
  const surface = new THREE.Mesh(torso.geometry, torso.material);
  surface.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const sample = (x: number, y: number, relief = 0.002) => {
    ray.set(new THREE.Vector3(x, y, -1), new THREE.Vector3(0, 0, 1));
    const hit = ray.intersectObject(surface, false)[0];
    if (!hit?.uv) throw new Error('Pocket must remain on the garment surface');
    return {
      point: hit.point.add(new THREE.Vector3(0, 0, -relief)),
      uv: hit.uv,
    };
  };
  const seam = (points: THREE.Vector3[], opening = false) => {
    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(points),
        points.length * 3,
        opening ? 0.0005 : 0.0004,
        5,
        false,
      ),
      seamMaterial,
    );
    mesh.name = opening ? 'pocket-opening' : 'pocket-stitch';
    parent.add(mesh);
  };
  const rows = 16,
    cols = 16;
  for (const half of split ? [-1, 1] : [0]) {
    const positions: number[] = [],
      uvs: number[] = [],
      indices: number[] = [];
    const boundaries: THREE.Vector3[][] = [[], [], [], []];
    for (let row = 0; row <= rows; row++) {
      const t = row / rows,
        y = 0.03 + 0.18 * t;
      const width =
        t < 0.27 ? 0.158 + (0.012 * t) / 0.27 : 0.17 - (t - 0.27) * 0.065;
      const left = half < 0 ? -width : half > 0 ? 0.012 : -width;
      const right = half < 0 ? -0.012 : width;
      for (let col = 0; col <= cols; col++) {
        const u = col / cols;
        const relief =
          0.002 + 0.004 * Math.sin(Math.PI * u) * Math.sin(Math.PI * t);
        const hit = sample(THREE.MathUtils.lerp(left, right, u), y, relief);
        positions.push(...hit.point.toArray());
        uvs.push(...hit.uv.toArray());
        if (col === 0) boundaries[0].push(hit.point);
        if (col === cols) boundaries[1].push(hit.point);
        if (row === 0) boundaries[2].push(hit.point);
        if (row === rows) boundaries[3].push(hit.point);
      }
    }
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < cols; col++) {
        const a = row * (cols + 1) + col,
          b = a + cols + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const pocket = new THREE.Mesh(geometry, torso.material);
    pocket.name = split ? 'split-kangaroo-pocket' : 'kangaroo-pocket';
    pocket.castShadow = true;
    pocket.receiveShadow = true;
    parent.add(pocket);
    boundaries.forEach((points, edge) =>
      seam(
        points,
        edge < 2 && (half === 0 || (half < 0 ? edge === 0 : edge === 1)),
      ),
    );
  }
}

/** Construction traced from the British Racing Green windbreaker photograph. */
export function addWindbreakerDetails(
  parent: THREE.Group,
  torso: THREE.Mesh,
  seamMaterial: THREE.Material,
) {
  const surface = new THREE.Mesh(torso.geometry, torso.material);
  surface.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const sample = (x: number, y: number, relief = 0.0006) => {
    ray.set(new THREE.Vector3(x, y, -1), new THREE.Vector3(0, 0, 1));
    const hit = ray.intersectObject(surface, false)[0];
    if (!hit?.uv) throw new Error('Windbreaker detail must follow its surface');
    return {
      point: hit.point.add(new THREE.Vector3(0, 0, -relief)),
      uv: hit.uv,
    };
  };
  const stitch = (points: THREE.Vector3[], name: string) => {
    const geometry = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(points),
      points.length * 2,
      0.00045,
      5,
      false,
    );
    const mesh = new THREE.Mesh(geometry, seamMaterial);
    mesh.name = name;
    parent.add(mesh);
  };
  const panel = (
    rows: number,
    cols: number,
    at: (u: number, v: number) => ReturnType<typeof sample>,
    name: string,
  ) => {
    const positions: number[] = [],
      uvs: number[] = [],
      indices: number[] = [];
    for (let row = 0; row <= rows; row++)
      for (let col = 0; col <= cols; col++) {
        const hit = at(col / cols, row / rows);
        positions.push(...hit.point.toArray());
        uvs.push(...hit.uv.toArray());
      }
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < cols; col++) {
        const a = row * (cols + 1) + col,
          b = a + cols + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, torso.material);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
  };

  // The horizontal yoke is a thin sewn panel, split by the existing front zip.
  // Its UVs come from the torso so fabric and photographed print stay continuous.
  for (const side of [-1, 1]) {
    const left = side < 0 ? -0.232 : 0.006,
      right = side < 0 ? -0.006 : 0.232;
    panel(
      4,
      32,
      (u, v) => sample(THREE.MathUtils.lerp(left, right, u), 0.285 + v * 0.042),
      'windbreaker-midtorso-panel',
    );
    for (const y of [0.285, 0.327])
      stitch(
        Array.from(
          { length: 33 },
          (_, i) =>
            sample(THREE.MathUtils.lerp(left, right, i / 32), y, 0.0008).point,
        ),
        'windbreaker-panel-stitch',
      );

    // Slim, almost vertical welt openings at the outer lower front; no hoodie pocket.
    const pocketAt = (u: number, v: number) =>
      sample(
        side * (0.2 + 0.009 * v) + (u - 0.5) * 0.011,
        0.072 + 0.153 * v,
        0.0007 + 0.0002 * Math.sin(Math.PI * u),
      );
    panel(20, 3, pocketAt, 'windbreaker-welt-pocket');
    const inner = side < 0 ? 1 : 0;
    stitch(
      Array.from({ length: 21 }, (_, i) => pocketAt(inner, i / 20).point),
      'windbreaker-pocket-opening',
    );
    for (const end of [0, 1])
      stitch(
        Array.from({ length: 5 }, (_, i) => pocketAt(i / 4, end).point),
        'windbreaker-pocket-bartack',
      );
  }

  // The source has a drawcord hem rather than a knitted hoodie waistband.
  const positions = torso.geometry.getAttribute('position'),
    uv = torso.geometry.getAttribute('uv');
  const bottom = new THREE.Vector3(0, 0, Infinity);
  for (let i = 0; i < positions.count; i++)
    if (uv.getY(i) < 0.001 && positions.getZ(i) < bottom.z)
      bottom.fromBufferAttribute(positions, i);
  const left = sample(-0.028, bottom.y + 0.009, 0.001).point,
    right = sample(0.028, bottom.y + 0.009, 0.001).point;
  const cord = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        left,
        new THREE.Vector3(-0.012, bottom.y - 0.021, left.z - 0.006),
        new THREE.Vector3(-0.02, bottom.y - 0.058, bottom.z - 0.008),
        new THREE.Vector3(0.008, bottom.y - 0.041, right.z - 0.008),
        right,
      ]),
      32,
      0.0011,
      6,
      false,
    ),
    seamMaterial,
  );
  cord.name = 'windbreaker-hem-drawcord';
  parent.add(cord);
}

/** The stitch loops share the sleeve's deformation, not a separate rigid arm. */
export function sleeveSeams(
  sleeve: THREE.Mesh,
  rings: number,
  sides: number,
  material: THREE.Material,
) {
  const position = sleeve.geometry.getAttribute('position');
  return [0.96].map((t) => {
    const ring = Math.round(t * rings),
      points: THREE.Vector3[] = [];
    const center = new THREE.Vector3();
    for (let j = 0; j < sides; j++) {
      const p = new THREE.Vector3().fromBufferAttribute(
        position,
        ring * (sides + 1) + j,
      );
      points.push(p);
      center.add(p);
    }
    center.divideScalar(sides);
    points.forEach((p) => p.sub(center).multiplyScalar(1.006).add(center));
    const geometry = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(points, true),
      sides * 2,
      0.00045,
      5,
      true,
    );
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'sleeve-hem-stitch';
    return mesh;
  });
}
