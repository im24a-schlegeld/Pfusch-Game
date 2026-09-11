import * as THREE from 'three';

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
        opening ? 0.0018 : 0.00085,
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

/** The stitch loops share the sleeve's deformation, not a separate rigid arm. */
export function sleeveSeams(
  sleeve: THREE.Mesh,
  rings: number,
  sides: number,
  material: THREE.Material,
) {
  const position = sleeve.geometry.getAttribute('position');
  return [0.28, 0.96].map((t, index) => {
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
      0.00115,
      5,
      true,
    );
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = index ? 'sleeve-hem-stitch' : 'dropped-shoulder-stitch';
    return mesh;
  });
}
