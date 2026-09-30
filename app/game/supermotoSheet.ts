import { BufferGeometry, Float32BufferAttribute } from 'three';
type Point = [number, number, number];
/** A moulded plastic sheet with a closed 4 mm edge, rather than a solid oval. */
export function formedSheet(rows: number, columns: number, pointAt: (u: number, v: number) => Point, thickness: Point, mirrorDiagonals = false) {
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  const stride = columns + 1, faceSize = (rows + 1) * stride;
  for (let layer = 0; layer < 2; layer++) for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      const u = row / rows, v = column / columns;
      const p = pointAt(u, v * 2 - 1);
      positions.push(p[0] + layer * thickness[0], p[1] + layer * thickness[1], p[2] + layer * thickness[2]);
      uv.push(v, u);
    }
  }
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const a = row * stride + column, b = a + stride;
    if (mirrorDiagonals && column >= columns / 2)
      indices.push(a, b, b + 1, a, b + 1, a + 1,
        a + faceSize, b + 1 + faceSize, b + faceSize,
        a + faceSize, a + 1 + faceSize, b + 1 + faceSize);
    else indices.push(a, b, a + 1, a + 1, b, b + 1,
        a + faceSize, a + 1 + faceSize, b + faceSize,
        a + 1 + faceSize, b + 1 + faceSize, b + faceSize);
  }
  const rim: number[] = [];
  for (let c = 0; c < columns; c++) rim.push(c);
  for (let r = 0; r < rows; r++) rim.push(r * stride + columns);
  for (let c = columns; c > 0; c--) rim.push(rows * stride + c);
  for (let r = rows; r > 0; r--) rim.push(r * stride);
  for (let i = 0; i < rim.length; i++) {
    const a = rim[i], b = rim[(i + 1) % rim.length];
    indices.push(a, b, a + faceSize, b, b + faceSize, a + faceSize);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
