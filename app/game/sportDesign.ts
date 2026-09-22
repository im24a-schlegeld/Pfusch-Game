/**
 * PFUSCH Sport: mid-2010s 600 cc supersport bodywork.
 * Pure geometry: metres, X = right, Y = up, negative Z = forward.
 * Deliberately independent of Three.js, browser APIs and gameplay state.
 * The cut-outs are missing surface regions with their own recessed walls;
 * no closed fairing is hidden underneath a black decal.
 */
export type SportPoint = readonly [number, number, number];
export type SportSurface = (u: number, v: number) => SportPoint;
export type SportFinish =
  | 'paint'
  | 'carbon'
  | 'frame'
  | 'cavity'
  | 'alloy'
  | 'titanium'
  | 'light'
  | 'tailLight'
  | 'lens'
  | 'screen'
  | 'rubber';
export interface SportMeshData {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}
export interface SportPart {
  name: string;
  finish: SportFinish;
  geometry: SportMeshData;
}
export interface SportDesign {
  parts: SportPart[];
  tank: SportMeshData;
  tail: SportMeshData;
}

export const SPORT_STYLE = Object.freeze({
  /** Real exterior skin thickness, not a scale multiplier on the whole nose. */
  skinThickness: 0.0035,
  ventDepth: 0.037,
  windshieldOpacity: 0.6,
  clearcoat: 0.62,
});

const PI = Math.PI;
const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix = (a: SportPoint, b: SportPoint, t: number): SportPoint => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];
const add = (a: SportPoint, b: SportPoint): SportPoint => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
const sub = (a: SportPoint, b: SportPoint): SportPoint => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
const mul = (a: SportPoint, f: number): SportPoint => [
  a[0] * f,
  a[1] * f,
  a[2] * f,
];
const cross = (a: SportPoint, b: SportPoint): SportPoint => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: SportPoint, b: SportPoint) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: SportPoint): SportPoint => {
  const length = Math.hypot(...a);
  return length > 1e-22 ? mul(a, 1 / length) : [0, 1, 0];
};

/** Bounded cubic interpolation. It cannot overshoot the authored silhouettes. */
function splineScalar(values: readonly number[], t: number): number {
  const q = clamp(t) * (values.length - 1);
  const i = Math.min(values.length - 2, Math.floor(q));
  const f = q - i;
  const a = values[i],
    b = values[i + 1];
  const before = values[Math.max(0, i - 1)];
  const after = values[Math.min(values.length - 1, i + 2)];
  const span = b - a;
  const tangent = (x: number, y: number) =>
    x * y <= 0
      ? 0
      : Math.sign(x) *
        Math.min(Math.abs(x), Math.abs(y), (Math.abs(x) + Math.abs(y)) * 0.5);
  const m0 = i === 0 ? span : tangent(a - before, span);
  const m1 = i === values.length - 2 ? span : tangent(span, after - b);
  return (
    (2 * f ** 3 - 3 * f ** 2 + 1) * a +
    (f ** 3 - 2 * f ** 2 + f) * m0 +
    (-2 * f ** 3 + 3 * f ** 2) * b +
    (f ** 3 - f ** 2) * m1
  );
}
function spline(points: readonly SportPoint[], t: number): SportPoint {
  return [0, 1, 2].map((axis) =>
    splineScalar(
      points.map((p) => p[axis]),
      t,
    ),
  ) as unknown as SportPoint;
}
const mirror = (p: SportPoint, side: number): SportPoint => [
  p[0] * side,
  p[1],
  p[2],
];

function normalAt(
  surface: SportSurface,
  u: number,
  v: number,
  sign: number,
): SportPoint {
  const h = 0.0001;
  const gradient = (uu: number, vv: number): SportPoint =>
    cross(
      sub(surface(clamp(uu + h), vv), surface(clamp(uu - h), vv)),
      sub(surface(uu, clamp(vv + h)), surface(uu, clamp(vv - h))),
    );
  let n = gradient(u, v);
  // Disc centres and pointed optical ends need their limiting surface normal,
  // not a world-up fallback that changes direction when the part is mirrored.
  if (dot(n, n) < 1e-36)
    n = gradient(clamp(u, 0.001, 0.999), clamp(v, 0.001, 0.999));
  return mul(unit(n), sign);
}

/**
 * Smooth exterior + inverted interior + independently normalled edge returns.
 * Separate edge vertices avoid the inflated, melted perimeter produced by
 * averaging a panel's outside normal with a 90-degree thickness return.
 */
export function sportSurfaceMesh(
  surface: SportSurface,
  facing: SportPoint,
  uSteps = 14,
  vSteps = 22,
  thickness: number = SPORT_STYLE.skinThickness,
): SportMeshData {
  if (
    !Number.isInteger(uSteps) ||
    !Number.isInteger(vSteps) ||
    uSteps < 1 ||
    vSteps < 1
  )
    throw new RangeError('Sport surface divisions must be positive integers');
  const g: SportMeshData = { positions: [], normals: [], uvs: [], indices: [] };
  const sign = dot(normalAt(surface, 0.47, 0.53, 1), facing) >= 0 ? 1 : -1;
  const stride = uSteps + 1;
  const count = stride * (vSteps + 1);
  const pushVertex = (p: SportPoint, n: SportPoint, u: number, v: number) => {
    if (![...p, ...n, u, v].every(Number.isFinite))
      throw new Error('Non-finite sport vertex');
    const index = g.positions.length / 3;
    g.positions.push(...p);
    g.normals.push(...n);
    g.uvs.push(u, v);
    return index;
  };
  const triangle = (a: number, b: number, c: number) => {
    const p = (i: number): SportPoint => [
      g.positions[i * 3],
      g.positions[i * 3 + 1],
      g.positions[i * 3 + 2],
    ];
    const area = cross(sub(p(b), p(a)), sub(p(c), p(a)));
    if (dot(area, area) > 1e-20) g.indices.push(a, b, c);
  };
  for (let layer = 0; layer < (thickness > 0 ? 2 : 1); layer++) {
    for (let row = 0; row <= vSteps; row++) {
      for (let col = 0; col <= uSteps; col++) {
        const u = col / uSteps,
          v = row / vSteps;
        const n = normalAt(surface, u, v, sign);
        const p = add(surface(u, v), mul(n, -layer * thickness));
        pushVertex(p, mul(n, layer ? -1 : 1), u, v);
      }
    }
    for (let row = 0; row < vSteps; row++) {
      for (let col = 0; col < uSteps; col++) {
        const a = layer * count + row * stride + col;
        const b = a + stride;
        if (sign > 0 !== (layer === 1)) {
          triangle(a, a + 1, b);
          triangle(b, a + 1, b + 1);
        } else {
          triangle(a, b, a + 1);
          triangle(b, b + 1, a + 1);
        }
      }
    }
  }
  if (thickness > 0) {
    const perimeter: number[] = [];
    for (let col = 0; col < uSteps; col++) perimeter.push(col);
    for (let row = 0; row < vSteps; row++)
      perimeter.push(row * stride + uSteps);
    for (let col = uSteps; col > 0; col--)
      perimeter.push(vSteps * stride + col);
    for (let row = vSteps; row > 0; row--) perimeter.push(row * stride);
    if (sign < 0) perimeter.reverse();
    const point = (i: number): SportPoint => [
      g.positions[i * 3],
      g.positions[i * 3 + 1],
      g.positions[i * 3 + 2],
    ];
    for (let i = 0; i < perimeter.length; i++) {
      const a = perimeter[i],
        b = perimeter[(i + 1) % perimeter.length];
      const p0 = point(a),
        p1 = point(a + count),
        p2 = point(b),
        p3 = point(b + count);
      const n = unit(cross(sub(p1, p0), sub(p2, p0)));
      const base = g.positions.length / 3;
      pushVertex(p0, n, 0, 0);
      pushVertex(p1, n, 0, 1);
      pushVertex(p2, n, 1, 0);
      pushVertex(p3, n, 1, 1);
      triangle(base, base + 1, base + 2);
      triangle(base + 2, base + 1, base + 3);
    }
  }
  return g;
}

export function mergeSportMeshes(
  meshes: readonly SportMeshData[],
): SportMeshData {
  const result: SportMeshData = {
    positions: [],
    normals: [],
    uvs: [],
    indices: [],
  };
  for (const g of meshes) {
    const offset = result.positions.length / 3;
    result.positions.push(...g.positions);
    result.normals.push(...g.normals);
    result.uvs.push(...g.uvs);
    result.indices.push(...g.indices.map((i) => i + offset));
  }
  return result;
}

// [Z, half width, half height, centre Y]. Bike contact coordinates stay stock.
type Station = readonly [number, number, number, number];
const TANK: readonly Station[] = [
  [-0.385, 0.083, 0.041, 0.922],
  [-0.3, 0.129, 0.07, 0.936],
  [-0.205, 0.176, 0.104, 0.938],
  [-0.11, 0.183, 0.109, 0.933],
  [-0.015, 0.162, 0.086, 0.921],
  [0.07, 0.135, 0.061, 0.893],
  [0.135, 0.111, 0.041, 0.867],
  [0.195, 0.098, 0.031, 0.849],
  [0.25, 0.102, 0.027, 0.842],
];
const TAIL: readonly Station[] = [
  [0.38, 0.137, 0.039, 0.825],
  [0.5, 0.153, 0.049, 0.897],
  [0.6, 0.154, 0.043, 0.978],
  [0.72, 0.125, 0.034, 1.013],
  [0.82, 0.073, 0.021, 1.035],
  [0.9, 0.022, 0.009, 1.041],
];
const PILLION: readonly Station[] = [
  [0.565, 0.075, 0.009, 1.0],
  [0.585, 0.103, 0.026, 1.018],
  [0.65, 0.115, 0.028, 1.046],
  [0.74, 0.098, 0.027, 1.065],
  [0.8, 0.052, 0.009, 1.065],
];

function stationAt(stations: readonly Station[], t: number): Station {
  return [0, 1, 2, 3].map((axis) =>
    splineScalar(
      stations.map((p) => p[axis]),
      t,
    ),
  ) as unknown as Station;
}
function stationAtZ(stations: readonly Station[], z: number): Station {
  let low = 0,
    high = 1;
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) * 0.5;
    if (stationAt(stations, middle)[0] < z) low = middle;
    else high = middle;
  }
  return stationAt(stations, (low + high) * 0.5);
}

/** Curved crown, shoulder break, near-planar flanks, narrow lower return. */
function tankSection(a: number): readonly [number, number] {
  const theta = a * PI * 2;
  const x = Math.sin(theta),
    y = Math.cos(theta);
  if (y >= 0)
    return [Math.sign(x) * Math.abs(x) ** 0.78, Math.max(0, y) ** 0.76];
  return [x * (0.92 + 0.08 * (1 + y)), y];
}
function tailSection(a: number): readonly [number, number] {
  const theta = a * PI * 2;
  const x = Math.sin(theta),
    y = Math.cos(theta);
  return [Math.sign(x) * Math.abs(x) ** 0.8, y >= 0 ? y ** 0.6 : y];
}
function bodyShell(
  stations: readonly Station[],
  section: (t: number) => readonly [number, number],
): SportMeshData {
  const surface: SportSurface = (u, v) => {
    const [z, w, h, y] = stationAt(stations, v);
    const [x, yy] = section(u);
    return [x * w, y + yy * h, z];
  };
  // Four independent quadrants: authored shoulder changes do not get averaged
  // across the entire circumference like a single squashed sphere.
  const meshes: SportMeshData[] = [];
  const faces: SportPoint[] = [
    [1, 1, 0],
    [1, -1, 0],
    [-1, -1, 0],
    [-1, 1, 0],
  ];
  for (let q = 0; q < 4; q++) {
    meshes.push(
      sportSurfaceMesh(
        (u, v) => surface((q + u) / 4, v),
        faces[q],
        12,
        (stations.length - 1) * 5,
        0,
      ),
    );
  }
  for (const end of [0, 1]) {
    const [, , , cy] = stationAt(stations, end);
    const z = stationAt(stations, end)[0];
    meshes.push(
      sportSurfaceMesh(
        (u, v) => mix([0, cy, z], surface(u, end), v),
        [0, 0, end ? 1 : -1],
        48,
        1,
        0,
      ),
    );
  }
  return mergeSportMeshes(meshes);
}

const SHOULDER: readonly SportPoint[] = [
  [0.239, 0.888, -0.701],
  [0.258, 0.916, -0.619],
  [0.247, 0.918, -0.523],
];
const FLANK_REAR: readonly SportPoint[] = [
  SHOULDER[2],
  [0.235, 0.874, -0.34],
  [0.216, 0.72, -0.085],
  [0.182, 0.548, 0.16],
  [0.148, 0.27, 0.285],
];
const FLANK_BOTTOM: readonly SportPoint[] = [
  [0.223, 0.695, -0.751],
  [0.225, 0.643, -0.563],
  [0.187, 0.305, -0.392],
  [0.169, 0.197, -0.15],
  [0.16, 0.197, 0.08],
  [0.154, 0.215, 0.202],
  [0.148, 0.232, 0.285],
];

const flankTop = (v: number): SportPoint =>
  v <= 1 / 3 ? spline(SHOULDER, v * 3) : spline(FLANK_REAR, (v - 1 / 3) * 1.5);

export const sportFlank: SportSurface = (u, v) => {
  const p = mix(flankTop(v), spline(FLANK_BOTTOM, v), u);
  // The broad, diagonal upper blade carries the main highlight. The lower
  // fairing returns inward rather than swelling into a single rounded slab.
  const bladeCenter = lerp(0.31, 0.54, v);
  const crown =
    0.023 * Math.sin(PI * u) +
    0.025 * Math.sin(PI * u) * Math.exp(-(((u - bladeCenter) / 0.105) ** 2)) -
    0.022 * u ** 3;
  return [
    p[0] + crown * Math.sin(PI * v),
    p[1],
    p[2] - 0.01 * Math.sin(PI * u) * Math.sin(PI * v),
  ];
};
const nose: SportSurface = (u, v) => {
  const x = u * 2 - 1;
  const width = lerp(0.05, 0.148, Math.sin((v * PI) / 2));
  return [
    x * width,
    0.776 + 0.137 * v + 0.01 * (1 - x * x) * (1 - 0.35 * v),
    -0.855 +
      0.116 * v +
      0.01 * x * x -
      0.012 * Math.sin(PI * v) -
      0.012 * (1 - x * x) * (1 - v) ** 1.5,
  ];
};
const screen: SportSurface = (u, v) => {
  const x = u * 2 - 1;
  // A shallow leading section rises into the bubble at the rear. The centre
  // bows forward across its width; the top remains below the rider's sightline.
  return [
    x * (0.149 - 0.019 * v + 0.02 * Math.sin(PI * v)),
    0.921 + 0.2 * (0.9 * v + 0.1 * v * v) - 0.035 * v * x * x - 0.005 * x * x,
    -0.73 + 0.184 * (v + 0.08 * Math.sin(PI * v)) + (0.023 + 0.028 * v) * x * x,
  ];
};

const opticalTop = (u: number): SportPoint => {
  const p = mix(nose(1, 0), SHOULDER[0], u);
  return [
    p[0],
    p[1] + 0.009 * Math.sin(PI * u),
    p[2] - 0.012 * Math.sin(PI * u),
  ];
};
const opticalBottom = (u: number): SportPoint =>
  spline(
    [
      [0.053, 0.726, -0.848],
      [0.165, 0.748, -0.808],
      [0.233, 0.849, -0.718],
    ],
    u,
  );
const optics: SportSurface = (u, v) => mix(opticalTop(u), opticalBottom(u), v);

/** Shared optical face centres; lighting follows the new geometry exactly. */
export const SPORT_LENS_FACES: readonly SportPoint[] = Object.freeze(
  [-1, 1].map((side): SportPoint => {
    const p = optics(0.5, 0.5);
    return [side * p[0], p[1], p[2] - 0.007];
  }),
);

/** Cylinder/washer directly in world coordinates, with correct cap normals. */
function washer(
  center: SportPoint,
  outer: number,
  inner: number,
  height: number,
): SportMeshData {
  const meshes: SportMeshData[] = [];
  for (const top of [0, 1]) {
    meshes.push(
      sportSurfaceMesh(
        (u, v) => {
          const r = lerp(inner, outer, v),
            a = u * PI * 2;
          return [
            center[0] + Math.sin(a) * r,
            center[1] + top * height,
            center[2] + Math.cos(a) * r,
          ];
        },
        [0, top ? 1 : -1, 0],
        32,
        2,
        0,
      ),
    );
  }
  for (const [r, inward] of [
    [outer, false],
    [inner, true],
  ] as const) {
    if (r <= 0) continue;
    for (let q = 0; q < 4; q++) {
      const a = ((q + 0.5) / 4) * PI * 2;
      meshes.push(
        sportSurfaceMesh(
          (u, v) => {
            const angle = ((q + u) / 4) * PI * 2;
            return [
              center[0] + Math.sin(angle) * r,
              center[1] + v * height,
              center[2] + Math.cos(angle) * r,
            ];
          },
          [Math.sin(a) * (inward ? -1 : 1), 0, Math.cos(a) * (inward ? -1 : 1)],
          8,
          1,
          0,
        ),
      );
    }
  }
  return mergeSportMeshes(meshes);
}

export function createSportDesign(): SportDesign {
  const parts: SportPart[] = [];
  const tailSections = new Map<number, Station>();
  const tailAt = (z: number): Station => {
    const found = tailSections.get(z);
    if (found) return found;
    const section = stationAtZ(TAIL, z);
    tailSections.set(z, section);
    return section;
  };
  // Surface normals sample the same cross-section repeatedly. Inverting the
  // station curves once per section avoids a long first garage-preview stall.
  const tankJoins = new Map<number, readonly [SportPoint, SportPoint]>();
  const tankJoin = (v: number): readonly [SportPoint, SportPoint] => {
    const found = tankJoins.get(v);
    if (found) return found;
    const z = lerp(-0.325, 0.105, v);
    const st = stationAtZ(TANK, z);
    const top: SportPoint = [st[1], st[3], z];
    let lo = 0,
      hi = 1;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) * 0.5;
      if (flankTop(mid)[2] < z) lo = mid;
      else hi = mid;
    }
    const section = [top, flankTop((lo + hi) * 0.5)] as const;
    tankJoins.set(v, section);
    return section;
  };
  const part = (
    name: string,
    finish: SportFinish,
    surface: SportSurface,
    facing: SportPoint,
    u = 14,
    v = 22,
    thickness: number = SPORT_STYLE.skinThickness,
  ) => {
    parts.push({
      name,
      finish,
      geometry: sportSurfaceMesh(surface, facing, u, v, thickness),
    });
  };
  const meshPart = (
    name: string,
    finish: SportFinish,
    geometry: SportMeshData,
  ) => parts.push({ name, finish, geometry });

  part('sport-ram-air-bridge', 'paint', nose, [0, 1, -1], 24, 28);

  // Trapezoidal ram-air mouth. Four actual duct walls lead into a deep throat.
  const mouth: SportPoint[] = [
    [-0.05, 0.776, -0.845],
    [0.05, 0.776, -0.845],
    [0.047, 0.72, -0.828],
    [-0.047, 0.72, -0.828],
  ];
  const throat = mouth.map(
    (p): SportPoint => [p[0] * 0.76, p[1] + 0.007, p[2] + 0.085],
  );
  for (let edge = 0; edge < 4; edge++) {
    const next = (edge + 1) % 4;
    part(
      'sport-ram-air-duct',
      'cavity',
      (u, v) =>
        mix(
          mix(mouth[edge], mouth[next], u),
          mix(throat[edge], throat[next], u),
          v,
        ),
      [0, 0, -1],
      8,
      3,
      0.002,
    );
  }
  part(
    'sport-intake-throat',
    'cavity',
    (u, v) =>
      mix(mix(throat[0], throat[1], u), mix(throat[3], throat[2], u), v),
    [0, 0, -1],
    8,
    4,
    0,
  );
  part(
    'sport-intake-lower-lip',
    'carbon',
    (u, v) => [
      (u * 2 - 1) * lerp(0.052, 0.047, v),
      0.72 - 0.013 * v,
      -0.833 + 0.031 * v + 0.009 * (u * 2 - 1) ** 2,
    ],
    [0, 0.4, -1],
    16,
    4,
    0.003,
  );
  // Close the bridge/duct leading edge instead of leaving a floating upper lip.
  part(
    'sport-intake-upper-lip',
    'paint',
    (u, v) => mix(mix(mouth[0], mouth[1], u), nose(u, 0), v),
    [0, 0, -1],
    24,
    2,
    0.002,
  );

  for (const side of [-1, 1]) {
    const s = side < 0 ? 'L' : 'R';
    const mirrored =
      (surface: SportSurface): SportSurface =>
      (u, v) =>
        mirror(surface(u, v), side);
    const outward: SportPoint = [side, 0, 0];
    part(
      `sport-shoulder-cowl-${s}`,
      'paint',
      mirrored((u, v) => {
        const p = mix(nose(1, v), spline(SHOULDER, v), u);
        return [
          p[0],
          p[1] + 0.009 * Math.sin(PI * u),
          p[2] - 0.012 * Math.sin(PI * u),
        ];
      }),
      [side * 0.3, 1, -0.3],
      16,
      28,
    );

    // Broad swept reflector lamps follow the 2008–2016 R6 nose. The complete
    // glazing shares its boundary with the fairing, rather than LED strips
    // floating ahead of a dark closed panel.
    part(
      `sport-light-pocket-${s}`,
      'cavity',
      mirrored(optics),
      [side * 0.6, 0.2, -1],
      24,
      14,
      0.003,
    );
    part(
      `sport-lamp-reflector-${s}`,
      'alloy',
      mirrored((u, v) => {
        const p = optics(0.055 + u * 0.89, 0.11 + v * 0.78);
        return [p[0], p[1], p[2] - 0.002];
      }),
      [side * 0.6, 0, -1],
      18,
      10,
      0.001,
    );
    part(
      `sport-projector-lens-${s}`,
      'lens',
      mirrored((u, v) => {
        const x = u * 2 - 1,
          y = v * 2 - 1;
        const p = optics(0.04 + u * 0.92, 0.055 + v * 0.89);
        return [p[0], p[1], p[2] - 0.003 - 0.004 * (1 - x * x) * (1 - y * y)];
      }),
      [side * 0.6, 0, -1],
      24,
      14,
      0,
    );
    // A small bright bulb and reflector crease make the lens read as glass;
    // it is still one pooled world headlight per side.
    part(
      `sport-reflector-bulb-${s}`,
      'light',
      mirrored((u, v) => {
        const angle = u * PI * 2,
          radius = v * 0.062;
        const p = optics(
          0.5 + Math.cos(angle) * radius,
          0.49 + Math.sin(angle) * radius * 1.9,
        );
        return [p[0], p[1], p[2] - 0.0025];
      }),
      [side * 0.6, 0, -1],
      20,
      3,
      0,
    );
    part(
      `sport-under-eye-cheek-${s}`,
      'paint',
      mirrored((u, v) =>
        mix(
          opticalBottom(u),
          mix([0.047, 0.72, -0.828], sportFlank(1, 0), u),
          v,
        ),
      ),
      [side * 0.6, -0.1, -1],
      24,
      6,
    );
    part(
      `sport-optical-side-return-${s}`,
      'paint',
      mirrored((u, v) => mix(optics(1, u), sportFlank(u, 0), v)),
      [side, 0, -0.2],
      14,
      3,
    );

    // Long, narrow radiator outlet with tapered ends. Its actual open surface
    // is recessed; a black rectangle is never laid across a closed panel.
    const v0 = 0.29,
      v1 = 0.72;
    const openingHalfHeight = (t: number) =>
      0.001 + 0.042 * Math.sin(PI * t) ** 0.75;
    const upper = (t: number) => lerp(0.19, 0.245, t) - openingHalfHeight(t);
    const lower = (t: number) => lerp(0.19, 0.245, t) + openingHalfHeight(t);
    const region = (
      name: string,
      va: number,
      vb: number,
      low: (t: number) => number,
      high: (t: number) => number,
      finish: SportFinish,
      rows = 18,
    ) =>
      part(
        `${name}-${s}`,
        finish,
        mirrored((u, v) =>
          sportFlank(lerp(low(v), high(v), u), lerp(va, vb, v)),
        ),
        outward,
        12,
        rows,
      );
    region(
      'sport-front-side-shell',
      0,
      v0,
      () => 0,
      () => 0.77,
      'paint',
      24,
    );
    region('sport-outlet-upper-shoulder', v0, v1, () => 0, upper, 'paint');
    region('sport-outlet-lower-blade', v0, v1, lower, () => 0.77, 'paint');
    region(
      'sport-rear-side-shell',
      v1,
      1,
      () => 0,
      () => 0.77,
      'paint',
    );
    region(
      'sport-lower-fairing-return',
      0,
      1,
      () => 0.77,
      () => 1,
      'carbon',
      44,
    );

    const rim: Array<(t: number) => SportPoint> = [
      (t) => sportFlank(upper(t), lerp(v0, v1, t)),
      (t) => sportFlank(lerp(upper(1), lower(1), t), v1),
      (t) => sportFlank(lower(1 - t), lerp(v1, v0, t)),
      (t) => sportFlank(lerp(lower(0), upper(0), t), v0),
    ];
    const recessed = (p: SportPoint): SportPoint => [
      p[0] - SPORT_STYLE.ventDepth,
      p[1] + 0.002,
      p[2] + 0.007,
    ];
    for (let edge = 0; edge < rim.length; edge++) {
      part(
        `sport-outlet-inner-wall-${s}-${edge}`,
        'carbon',
        mirrored((u, v) => mix(rim[edge](u), recessed(rim[edge](u)), v)),
        outward,
        18,
        3,
        0.002,
      );
    }
    part(
      `sport-outlet-recess-${s}`,
      'cavity',
      mirrored((u, v) =>
        recessed(sportFlank(lerp(upper(v), lower(v), u), lerp(v0, v1, v))),
      ),
      outward,
      10,
      18,
      0,
    );
    for (const t of [0.19, 0.41, 0.63]) {
      const vv = lerp(v0, v1, t);
      part(
        `sport-outlet-louvre-${s}-${t}`,
        'carbon',
        mirrored((u, v) => {
          const p = sportFlank(
            lerp(upper(t) + 0.015, lower(t) - 0.015, u),
            vv + (v - 0.5) * 0.009,
          );
          return [p[0] - 0.021, p[1], p[2] + 0.003];
        }),
        outward,
        8,
        2,
        0.002,
      );
    }

    // The exposed upper deck belongs to the Deltabox, not the painted fairing.
    // Its tank edge follows the real tank equator so no blue bridge hides the
    // diagonal frame and no artificial gap opens beneath the tank.
    part(
      `sport-frame-upper-deck-${s}`,
      'frame',
      mirrored((u, v) => {
        const [top, bottom] = tankJoin(v);
        const p = mix(top, bottom, u);
        return [p[0] + 0.002 * Math.sin(PI * u), p[1], p[2]];
      }),
      outward,
      10,
      24,
    );

    // Cockpit rim wraps around the steering head without covering the grips.
    part(
      `sport-cockpit-rim-${s}`,
      'carbon',
      mirrored((u, v) => {
        const outside = spline(
          [
            [0.247, 0.918, -0.523],
            [0.235, 0.908, -0.433],
            [0.171, 0.925, -0.324],
          ],
          v,
        );
        const inside = spline(
          [
            [0.149, 0.916, -0.707],
            [0.144, 0.942, -0.447],
            [0.134, 0.932, -0.324],
          ],
          v,
        );
        return mix(outside, inside, u);
      }),
      [side * 0.4, 1, 0],
      8,
      18,
      0.003,
    );
    // The tank-side knee infill closes the seat/frame junction without
    // increasing the immutable rider's thigh or moving the foot pegs.
    part(
      `sport-knee-infill-${s}`,
      'carbon',
      mirrored((u, v) => {
        const upperEdge = spline(
          [
            [0.163, 0.858, -0.04],
            [0.109, 0.837, 0.19],
            [0.13, 0.819, 0.35],
          ],
          v,
        );
        const lowerEdge = spline(
          [
            [0.201, 0.767, -0.04],
            [0.174, 0.643, 0.19],
            [0.145, 0.733, 0.35],
          ],
          v,
        );
        return mix(upperEdge, lowerEdge, u);
      }),
      outward,
      8,
      18,
    );
    part(
      `sport-deltabox-beam-${s}`,
      'frame',
      mirrored((u, v) => {
        const upperEdge = spline(
          [
            [0.111, 1.0, -0.427],
            [0.181, 0.923, -0.205],
            [0.202, 0.802, 0.03],
            [0.177, 0.614, 0.174],
            [0.17, 0.517, 0.19],
          ],
          v,
        );
        const lowerEdge = spline(
          [
            [0.127, 0.915, -0.416],
            [0.192, 0.819, -0.205],
            [0.209, 0.678, 0.03],
            [0.18, 0.513, 0.174],
            [0.17, 0.47, 0.19],
          ],
          v,
        );
        const p = mix(upperEdge, lowerEdge, u);
        return [p[0] + 0.003 * Math.sin(PI * u), p[1], p[2]];
      }),
      outward,
      8,
      30,
      0.035,
    );
  }

  // Inner front returns: the side shell has a finished interior rather than
  // exposing its back side around the fork/radiator opening.
  for (const side of [-1, 1]) {
    part(
      `sport-inner-front-return-${side}`,
      'carbon',
      (u, v) => {
        const edge = sportFlank(1, 0.07 + v * 0.43);
        const inside: SportPoint = [
          edge[0] * 0.76,
          edge[1] + 0.009,
          edge[2] + 0.03,
        ];
        return mirror(mix(edge, inside, u), side);
      },
      [side * 0.4, 0, -1],
      6,
      24,
      0.0025,
    );
  }
  const radiator: SportSurface = (u, v) => [
    (u * 2 - 1) * (0.172 - 0.02 * v),
    0.734 - 0.324 * v,
    -0.481 + 0.131 * v + 0.012 * (u * 2 - 1) ** 2,
  ];
  part('sport-radiator-core', 'cavity', radiator, [0, 0, -1], 14, 18, 0.018);
  for (let i = 1; i < 21; i++) {
    part(
      `sport-radiator-fin-${i}`,
      'titanium',
      (u, v) => {
        const p = radiator(0.025 + u * 0.95, i / 21 + (v - 0.5) * 0.004);
        return [p[0], p[1], p[2] - 0.0015];
      },
      [0, 0.2, -1],
      8,
      1,
      0,
    );
  }

  // One optical surface avoids four stacked alpha layers making a black slab.
  part('sport-smoked-windscreen', 'screen', screen, [0, 0.5, -1], 28, 24, 0);
  for (const side of [-1, 1]) {
    part(
      `sport-screen-binding-${side}`,
      'carbon',
      (u, v) => {
        const edge = side < 0 ? 0 : 1;
        return screen(edge + (side < 0 ? 1 : -1) * u * 0.01, v);
      },
      [0, 0.5, -1],
      1,
      24,
      0.001,
    );
  }
  part(
    'sport-screen-top-binding',
    'carbon',
    (u, v) => screen(u, 0.991 + v * 0.009),
    [0, 0.5, -1],
    28,
    1,
    0.001,
  );
  // Painted surround closes the windscreen foot to the upper nose.
  part(
    'sport-screen-lower-surround',
    'paint',
    (u, v) => mix(nose(u, 1), screen(u, 0), v),
    [0, 1, -0.2],
    24,
    3,
    0.002,
  );

  const capY = stationAtZ(TANK, -0.16)[2] + stationAtZ(TANK, -0.16)[3];
  meshPart(
    'sport-fuel-cap-ring',
    'alloy',
    washer([0, capY + 0.001, -0.16], 0.035, 0.026, 0.004),
  );
  meshPart(
    'sport-fuel-cap-centre',
    'carbon',
    washer([0, capY + 0.002, -0.16], 0.025, 0, 0.003),
  );
  for (let i = 0; i < 6; i++) {
    const a = (i * PI) / 3;
    meshPart(
      `sport-fuel-cap-bolt-${i}`,
      'titanium',
      washer(
        [Math.sin(a) * 0.0305, capY + 0.005, -0.16 + Math.cos(a) * 0.0305],
        0.0022,
        0,
        0.001,
      ),
    );
  }

  // A closed, thick pillion saddle sits on its own raised step. Its front
  // return is visible above the lower rider saddle even from a side view.
  meshPart('sport-pillion-seat', 'rubber', bodyShell(PILLION, tailSection));
  part(
    'sport-tail-undertray',
    'carbon',
    (u, v) => {
      const [z, w, h, y] = stationAt(TAIL, v);
      const x = u * 2 - 1;
      return [
        x * w * 0.62,
        y - h * Math.sqrt(Math.max(0, 1 - (x * 0.62) ** 2)) - 0.0015,
        z,
      ];
    },
    [0, -1, 0],
    10,
    20,
    0.002,
  );

  // Long, tapered lower-cowl seams and a central keel make the tail read as
  // assembled bodywork. These surfaces reuse the carbon batch; their rear
  // extent stays inside the existing tail tip and cannot move scrape contact.
  for (const side of [-1, 1]) {
    part(
      `sport-tail-side-scallop-${side}`,
      'carbon',
      (u, v) => {
        const [z, w, h, y] = tailAt(lerp(0.505, 0.862, v));
        const taper = Math.sin(PI * v) ** 0.6;
        const a = (PI / 2 + (0.1 + 0.62 * u) * taper) / (PI * 2);
        const [xx, yy] = tailSection(a);
        return [side * (xx * w + 0.0015), y + yy * h, z];
      },
      [side, -0.3, 0],
      6,
      24,
      0.001,
    );
    part(
      `sport-tail-light-${side}`,
      'tailLight',
      (u, v) => {
        const [z, w, h, y] = tailAt(lerp(0.828, 0.887, v));
        const [xx, yy] = tailSection((PI - (0.13 + u * 0.69)) / (PI * 2));
        return [side * xx * w, y + yy * h - 0.003, z];
      },
      [side * 0.15, -0.6, 1],
      8,
      12,
      0.002,
    );
  }
  part(
    'sport-tail-centre-keel',
    'carbon',
    (u, v) => {
      const [z, w, h, y] = tailAt(lerp(0.675, 0.802, v));
      const [xx, yy] = tailSection((PI + (u * 2 - 1) * 0.55) / (PI * 2));
      return [
        xx * w,
        y +
          yy * h -
          0.003 -
          0.007 * Math.sin(PI * v) * (1 - Math.abs(u * 2 - 1)),
        z,
      ];
    },
    [0, -1, 0.3],
    10,
    20,
    0.002,
  );

  return {
    parts,
    tank: bodyShell(TANK, tankSection),
    tail: bodyShell(TAIL, tailSection),
  };
}
