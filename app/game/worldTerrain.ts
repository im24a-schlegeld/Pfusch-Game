import {
  Color,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Matrix4,
  Shape,
  Triangle,
  Vector3,
} from 'three';

const innerEdge = 7.23;
const baseY = -0.25;
const bermSink = 16;
// Shared outer slope keeps the approach berm flush with the tunnel mountain.
const slope: readonly (readonly [number, number])[] = [
  [innerEdge, 15.6],
  [16, 13.2],
  [23, 8.8],
  [30, 3],
  [35, baseY],
];

/** Rock beds subdivide the existing surfaces only; the clearance stays exact. */
function rockLayers(geometry: ExtrudeGeometry) {
  const levels = [
    baseY,
    1.4,
    3.1,
    3.45,
    5.4,
    7.9,
    8.3,
    10.4,
    12.9,
    13.25,
    15.6,
    17.5,
  ];
  const palette = [
    '#74776c',
    '#696e64',
    '#545a53',
    '#777a70',
    '#686d64',
    '#555c54',
    '#73786d',
    '#656c62',
    '#525b52',
    '#777b70',
    '#6c7466',
  ].map((hex) => new Color(hex));
  const source = geometry.getAttribute('position');
  const positions: number[] = [],
    colors: number[] = [];
  const face = new Triangle();
  const clip = (points: Vector3[], height: number, above: boolean) => {
    const result: Vector3[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length];
      const da = (a.y - height) * (above ? 1 : -1);
      const db = (b.y - height) * (above ? 1 : -1);
      if (da >= 0) result.push(a);
      if (da < 0 !== db < 0) result.push(a.clone().lerp(b, da / (da - db)));
    }
    return result;
  };
  for (let i = 0; i < source.count; i += 3) {
    const points = [0, 1, 2].map((j) =>
      new Vector3().fromBufferAttribute(source, i + j),
    );
    for (let layer = 0; layer < levels.length - 1; layer++) {
      const polygon = clip(
        clip(points, levels[layer], true),
        levels[layer + 1],
        false,
      );
      const color = palette[layer];
      for (let j = 1; j < polygon.length - 1; j++) {
        face.set(polygon[0], polygon[j], polygon[j + 1]);
        if (face.getArea() < 1e-10) continue;
        for (const point of [face.a, face.b, face.c]) {
          // Same color at both Z ends and on the mirrored berm, so cell and
          // portal joins stay quiet. This never consumes world RNG.
          const shade =
            0.96 + 0.04 * Math.sin(Math.abs(point.x) * 0.73 + point.y * 0.41);
          positions.push(point.x, point.y, point.z);
          colors.push(color.r * shade, color.g * shade, color.b * shade);
        }
      }
    }
  }
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.deleteAttribute('normal');
  geometry.deleteAttribute('uv');
  geometry.clearGroups();
  geometry.computeVertexNormals();
}

function extrude(shape: Shape) {
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -0.5);
  rockLayers(geometry);
  return geometry;
}

/** Allocate once per world view; instance at unit XY and the clipped Z length. */
export function makeTunnelMountainGeometry() {
  const shape = new Shape();
  shape.moveTo(innerEdge, baseY);
  for (let i = slope.length - 1; i >= 0; i--) shape.lineTo(...slope[i]);
  shape.lineTo(0, 17.5);
  for (const [x, y] of slope) shape.lineTo(-x, y);
  shape.lineTo(-innerEdge, baseY);

  // A concave outline leaves the mouth open right down to the ground. The
  // opening clears the existing portal's +/-7.205 sides and 8.45625 crown.
  // Keep this profile identical in both quality modes: coarse sphere bounds
  // must never decide where the road-facing edge of terrain falls.
  const segments = 40;
  for (let i = segments; i >= 0; i--) {
    const angle = (i / segments) * Math.PI;
    shape.lineTo(Math.cos(angle) * innerEdge, 4.32 + Math.sin(angle) * 4.18);
  }
  return extrude(shape);
}

/** Positive-X side only; the instance transform also supplies the left side. */
export function makeTunnelBermGeometry() {
  const shape = new Shape();
  shape.moveTo(innerEdge, baseY);
  for (let i = slope.length - 1; i >= 0; i--) shape.lineTo(...slope[i]);
  return extrude(shape);
}

/**
 * Write a pooled berm instance without allocating or deforming shared geometry.
 * nearStart/nearEnd are normalized proximity to the portal at the exact clipped
 * span endpoints (0 at the outer transition boundary, 1 at the tunnel mouth).
 * A Z shear interpolates the vertical offset continuously across the cell.
 * The side also reverses Z, preserving positive determinant on the left.
 * Use a flatShading material for this form: Three's default instanced smooth
 * normal transform does not support shear; derivative face normals do.
 */
export function writeTunnelBermMatrix(
  target: Matrix4,
  side: -1 | 1,
  start: number,
  end: number,
  nearStart: number,
  nearEnd: number,
  anchor: number,
) {
  const startOffset = -bermSink * (1 - nearStart);
  const endOffset = -bermSink * (1 - nearEnd);
  return target.set(
    side,
    0,
    0,
    0,
    0,
    1,
    side * (startOffset - endOffset),
    (startOffset + endOffset) / 2,
    0,
    0,
    side * (end - start),
    anchor - (start + end) / 2,
    0,
    0,
    0,
    1,
  );
}
