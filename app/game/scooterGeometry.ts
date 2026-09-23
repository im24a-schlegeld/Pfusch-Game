import * as THREE from 'three';
import type { Player, Product } from '../domain/types';
import { POSES, type RiderPose } from './riderSkeleton';
import type { RiderMotion } from './riderMotion';
import type { RagdollPose } from './ragdoll';
import { activeSuspensionPose, createRearSuspension } from './activeSuspension';
import { brakeRotorGeometry } from './driveGeometry';
import type { CarriedCapMotionInput } from './carriedCapMotion';
import { rimBarrelGeometry } from './wheelDetails';

type Point = [number, number, number];
type Section = [number, number, number, number]; // z, half width, half height, center y
type RiderFactory = (
  parent: THREE.Object3D,
  pose: RiderPose,
  player: Player,
  products: Product[],
) => {
  group: THREE.Group;
  animate: (motion: RiderMotion, dt: number) => void;
  captureRagdollPose: () => RagdollPose;
  applyRagdollPose: (pose: RagdollPose) => void;
  animateAccessories: (input: CarriedCapMotionInput, dt: number) => void;
};

/** Independent small-wheel chassis. Metres; negative Z is the front. */
export const SCOOTER_GEOMETRY = Object.freeze({
  frontAxle: -0.65,
  rearAxle: 0.64,
  frontRadius: 0.224,
  rearRadius: 0.231,
  frontTireWidth: 0.1,
  rearTireWidth: 0.12,
  rimRadius: 0.1524,
  floorHeight: 0.3,
});

const v = (p: Point) => new THREE.Vector3(...p);
const finish = (color: string, metalness = 0, roughness = 0.62) =>
  new THREE.MeshStandardMaterial({ color, metalness, roughness });

function mesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
  name: string,
) {
  geometry.computeVertexNormals();
  const result = new THREE.Mesh(geometry, material);
  result.name = name;
  result.castShadow = result.receiveShadow = true;
  parent.add(result);
  return result;
}

function rod(
  parent: THREE.Object3D,
  a: Point,
  b: Point,
  radius: number,
  material: THREE.Material,
  name: string,
) {
  const direction = v(b).sub(v(a));
  const result = mesh(
    parent,
    new THREE.CylinderGeometry(radius, radius, direction.length(), 12),
    material,
    name,
  );
  result.position.copy(v(a).add(v(b)).multiplyScalar(0.5));
  result.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
  return result;
}

function tube(
  parent: THREE.Object3D,
  points: Point[],
  radius: number,
  material: THREE.Material,
  name: string,
) {
  return mesh(
    parent,
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(points.map(v)),
      20,
      radius,
      8,
      false,
    ),
    material,
    name,
  );
}

/** Rounded sections produce one continuous fairing, with finite closed ends. */
function shell(
  parent: THREE.Object3D,
  sections: Section[],
  material: THREE.Material,
  name: string,
  centerX = 0,
  exponent = 0.82,
) {
  const profile = new THREE.CatmullRomCurve3(
    sections.map(([z, w, h]) => new THREE.Vector3(z, w, h)),
    false,
    'catmullrom',
    0.18,
  );
  const centers = new THREE.CatmullRomCurve3(
    sections.map(([z, , , y]) => new THREE.Vector3(z, y, 0)),
    false,
    'catmullrom',
    0.18,
  );
  const vertices: number[] = [],
    indices: number[] = [];
  const steps = (sections.length - 1) * 3,
    sides = 20;
  for (let i = 0; i <= steps; i++) {
    const p = profile.getPoint(i / steps),
      c = centers.getPoint(i / steps);
    for (let j = 0; j <= sides; j++) {
      const angle = (j / sides) * Math.PI * 2;
      const sin = Math.sin(angle),
        cos = Math.cos(angle);
      vertices.push(
        centerX +
          Math.sign(sin) * Math.abs(sin) ** exponent * Math.max(0.002, p.y),
        c.y + Math.sign(cos) * Math.abs(cos) ** exponent * Math.max(0.002, p.z),
        p.x,
      );
    }
  }
  for (let i = 0; i < steps; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j,
        b = a + sides + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  for (const end of [0, steps]) {
    const first = end * (sides + 1);
    for (let j = 1; j < sides - 1; j++) {
      if (end === 0) indices.push(first, first + j, first + j + 1);
      else indices.push(first, first + j + 1, first + j);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  return mesh(parent, geometry, material, name);
}

/** A formed panel with separately oriented inner and outer surfaces and closed edges. */
function panel(
  parent: THREE.Object3D,
  points: Point[],
  axis: 'x' | 'z',
  material: THREE.Material,
  name: string,
  thickness = 0.008,
) {
  const normal =
    axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const triangles = THREE.ShapeUtils.triangulateShape(
    points.map((p) => new THREE.Vector2(axis === 'x' ? p[2] : p[0], p[1])),
    [],
  );
  const vertices: number[] = [],
    indices: number[] = [],
    n = points.length;
  for (const side of [-1, 1])
    for (const p of points)
      vertices.push(
        ...v(p)
          .addScaledVector(normal, (side * thickness) / 2)
          .toArray(),
      );
  for (const triangle of triangles) {
    const a = triangle[0];
    let [, b, c] = triangle;
    if (
      v(points[b])
        .sub(v(points[a]))
        .cross(v(points[c]).sub(v(points[a])))
        .dot(normal) < 0
    )
      [b, c] = [c, b];
    indices.push(a, c, b, a + n, b + n, c + n);
  }
  // Triangulation accepts both outline windings; normalize the side-wall winding too.
  const clockwise = THREE.ShapeUtils.isClockWise(
    points.map((p) => new THREE.Vector2(axis === 'x' ? p[2] : p[0], p[1])),
  );
  const flip = axis === 'x' ? !clockwise : clockwise;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (flip) indices.push(i, j + n, j, i, i + n, j + n);
    else indices.push(i, j, j + n, i, j + n, i + n);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  return mesh(parent, geometry, material, name);
}

/** Actual 12-inch bead, rounded tread and sidewall; not a scaled 17-inch motorcycle tire. */
function tireGeometry(radius: number, width: number) {
  const bead = SCOOTER_GEOMETRY.rimRadius,
    h = width / 2;
  const section = [
    [bead, -h * 0.72],
    [bead + 0.012, -h * 0.94],
    [radius - 0.034, -h],
    [radius - 0.014, -h * 0.85],
    [radius - 0.003, -h * 0.46],
    [radius, 0],
    [radius - 0.003, h * 0.46],
    [radius - 0.014, h * 0.85],
    [radius - 0.034, h],
    [bead + 0.012, h * 0.94],
    [bead, h * 0.72],
    [bead, -h * 0.72],
  ];
  const geometry = new THREE.LatheGeometry(
    section.map(([r, x]) => new THREE.Vector2(r, x)),
    64,
  );
  geometry.rotateZ(Math.PI / 2);
  return geometry;
}

function castWheel(
  wheel: THREE.Group,
  width: number,
  rim: THREE.Material,
  _alloy: THREE.Material,
) {
  const radius = SCOOTER_GEOMETRY.rimRadius,
    half = width * 0.36;
  const barrel = rimBarrelGeometry(radius, half);
  mesh(wheel, barrel, rim, 'formed-rim-barrel');
  for (const side of [-1, 1]) {
    const lip = mesh(
      wheel,
      new THREE.TorusGeometry(radius - 0.002, 0.009, 10, 56),
      rim,
      'rim-lip',
    );
    lip.rotation.y = Math.PI / 2;
    lip.position.x = side * half;
  }
  rod(wheel, [-half, 0, 0], [half, 0, 0], 0.04, rim, 'wheel-hub');
  const shape = new THREE.Shape();
  shape.moveTo(0.025, -0.017);
  shape.quadraticCurveTo(0.077, -0.005, radius - 0.013, -0.027);
  shape.lineTo(radius - 0.012, -0.002);
  shape.quadraticCurveTo(0.092, 0.028, 0.026, 0.019);
  shape.closePath();
  const spoke = new THREE.ExtrudeGeometry(shape, {
    depth: 0.025,
    bevelEnabled: true,
    bevelSize: 0.003,
    bevelThickness: 0.003,
    bevelSegments: 2,
    steps: 1,
    curveSegments: 7,
  });
  const positions = spoke.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const r = positions.getX(i),
      t = positions.getY(i),
      depth = positions.getZ(i);
    positions.setXYZ(i, depth - 0.0125, r, t);
  }
  for (let i = 0; i < 3; i++)
    mesh(wheel, spoke, rim, 'scooter-cast-spoke').rotation.x =
      (i * Math.PI * 2) / 3;
}

/** Concentric finite-thickness mudguard; its fork brackets share the axle assembly. */
function fender(
  parent: THREE.Object3D,
  axleY: number,
  axleZ: number,
  radius: number,
  halfWidth: number,
  material: THREE.Material,
  name: string,
  rear = false,
) {
  const vertices: number[] = [],
    indices: number[] = [];
  const rows = 22,
    columns = 8,
    count = (rows + 1) * (columns + 1);
  for (const layer of [0, 1])
    for (let i = 0; i <= rows; i++) {
      const baseAngle = THREE.MathUtils.lerp(
        rear ? -0.85 : -1.15,
        rear ? 1.64 : 1.22,
        i / rows,
      );
      for (let j = 0; j <= columns; j++) {
        const u = (j / columns) * 2 - 1;
        // The front guard rolls down around the tire shoulders. Its side edges
        // sit outside the tire, while the center retains 27 mm radial clearance.
        const r =
          radius +
          0.027 -
          (rear ? 0.009 : 0.038) * Math.abs(u) ** 1.8 +
          layer * 0.005;
        const angle =
          baseAngle + (rear ? 0 : 0.19 * u * u * (1 - i / rows) ** 3);
        const width =
          halfWidth * (rear ? 1 : 0.86 + 0.14 * Math.sin((Math.PI * i) / rows));
        vertices.push(
          u * width,
          axleY + Math.cos(angle) * r,
          axleZ + Math.sin(angle) * r,
        );
      }
    }
  for (let layer = 0; layer < 2; layer++)
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < columns; j++) {
        const a = layer * count + i * (columns + 1) + j,
          b = a + columns + 1;
        if (layer) indices.push(a, b, a + 1, b, b + 1, a + 1);
        else indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
  const boundary: number[] = [];
  for (let j = 0; j <= columns; j++) boundary.push(j);
  for (let i = 1; i <= rows; i++) boundary.push(i * (columns + 1) + columns);
  for (let j = columns - 1; j >= 0; j--)
    boundary.push(rows * (columns + 1) + j);
  for (let i = rows - 1; i > 0; i--) boundary.push(i * (columns + 1));
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i],
      b = boundary[(i + 1) % boundary.length];
    indices.push(a, b, a + count, b, b + count, a + count);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  return mesh(parent, geometry, material, name);
}

/** A proud faceted lens or cover with a closed rear housing. */
function facetedCover(
  parent: THREE.Object3D,
  outline: Point[],
  crown: Point,
  material: THREE.Material,
  name: string,
  depth: number,
) {
  const border = [...outline];
  if (
    THREE.ShapeUtils.isClockWise(
      border.map(([x, y]) => new THREE.Vector2(x, y)),
    )
  )
    border.reverse();
  const vertices = [...crown],
    indices: number[] = [],
    count = border.length;
  for (const p of border) vertices.push(...p);
  vertices.push(crown[0], crown[1], crown[2] + depth);
  for (const [x, y, z] of border) vertices.push(x, y, z + depth);
  const back = count + 1;
  for (let i = 0; i < count; i++) {
    const a = i + 1,
      b = ((i + 1) % count) + 1;
    indices.push(0, b, a, back, a + back, b + back);
    indices.push(a, b, a + back, b, b + back, a + back);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  return mesh(parent, geometry, material, name);
}

function legShield(
  parent: THREE.Group,
  paint: THREE.Material,
  inner: THREE.Material,
  intake: THREE.Material,
) {
  // Reference 09: a recessed inner shell, converging molded cheeks and a low prow.
  const sections = [
    [0.285, 0.232, -0.312, -0.28, -0.245],
    [0.36, 0.246, -0.375, -0.32, -0.275],
    [0.455, 0.242, -0.466, -0.42, -0.345],
    [0.525, 0.224, -0.59, -0.5, -0.415],
    [0.6, 0.223, -0.727, -0.578, -0.44],
    [0.69, 0.23, -0.665, -0.548, -0.446],
    [0.8, 0.21, -0.565, -0.5, -0.427],
    [0.9, 0.185, -0.482, -0.452, -0.408],
    [0.971, 0.117, -0.439, -0.4, -0.385],
  ];
  const rows = (sections.length - 1) * 3,
    columns = 16,
    count = (rows + 1) * (columns + 1);
  const vertices: number[] = [],
    indices: number[] = [];
  for (let face = 0; face < 2; face++)
    for (let i = 0; i <= rows; i++) {
      const at = (i / rows) * (sections.length - 1),
        index = Math.min(sections.length - 2, Math.floor(at));
      const [y, width, front, rear, edge] = sections[index].map((n, j) =>
        THREE.MathUtils.lerp(n, sections[index + 1][j], at - index),
      );
      for (let j = 0; j <= columns; j++) {
        const u = (j / columns) * 2 - 1;
        vertices.push(
          u * width,
          y,
          THREE.MathUtils.lerp(
            face ? rear : front,
            edge - (face ? 0 : 0.012),
            Math.abs(u) ** 1.55,
          ),
        );
      }
    }
  const geometry = new THREE.BufferGeometry();
  for (let face = 0; face < 2; face++)
    for (let i = 0; i < rows; i++) {
      const start = indices.length;
      for (let j = 0; j < columns; j++) {
        const a = face * count + i * (columns + 1) + j,
          b = a + columns + 1;
        if (face) indices.push(a, a + 1, b, b, a + 1, b + 1);
        else indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
      geometry.addGroup(
        start,
        indices.length - start,
        face || (i >= 9 && i < 21) ? 1 : 0,
      );
    }
  const edge: number[] = [];
  for (let j = 0; j <= columns; j++) edge.push(j);
  for (let i = 1; i <= rows; i++) edge.push(i * (columns + 1) + columns);
  for (let j = columns - 1; j >= 0; j--) edge.push(rows * (columns + 1) + j);
  for (let i = rows - 1; i > 0; i--) edge.push(i * (columns + 1));
  const start = indices.length;
  for (let i = 0; i < edge.length; i++) {
    const a = edge[i],
      b = edge[(i + 1) % edge.length];
    indices.push(a, b, a + count, b, b + count, a + count);
  }
  geometry.addGroup(start, indices.length - start, 1);
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  mesh(parent, geometry, [paint, inner], 'scooter-leg-shield');

  // One molded face carries three inset slots. Shared edges replace the old
  // overlapping cheeks, grille ribs and crown that produced doubled highlights.
  const profile = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(0.53, 0.22, -0.746),
      new THREE.Vector3(0.6, 0.238, -0.75),
      new THREE.Vector3(0.69, 0.249, -0.725),
      new THREE.Vector3(0.77, 0.242, -0.658),
      new THREE.Vector3(0.845, 0.22, -0.585),
      new THREE.Vector3(0.915, 0.18, -0.521),
      new THREE.Vector3(0.973, 0.121, -0.459),
    ],
    false,
    'catmullrom',
    0.15,
  );
  const sampleCount = 56,
    crossCount = 24;
  const surface: Point[] = [];
  const materialIndices: number[][] = [[], [], []];
  const face = new THREE.BufferGeometry();
  const rowPoints = profile.getPoints(sampleCount);
  for (let row = 0; row <= sampleCount; row++) {
    const p = rowPoints[row];
    const edgeZ = THREE.MathUtils.lerp(-0.425, -0.371, (p.x - 0.53) / 0.443);
    for (let column = 0; column <= crossCount; column++) {
      const u = (column / crossCount) * 2 - 1;
      surface.push([
        u * p.y,
        p.x + 0.006 * u * u,
        THREE.MathUtils.lerp(p.z, edgeZ, Math.abs(u) ** 2.25),
      ]);
    }
  }
  const ventCell = (row: number, column: number) => {
    if (row < 0 || row >= sampleCount || column < 0 || column >= crossCount)
      return false;
    const y = (rowPoints[row].x + rowPoints[row + 1].x) / 2;
    return (
      Math.abs(((column + 0.5) / crossCount) * 2 - 1) < 0.43 &&
      ((y > 0.73 && y < 0.746) ||
        (y > 0.785 && y < 0.801) ||
        (y > 0.838 && y < 0.854))
    );
  };
  const frontCount = surface.length;
  for (const point of surface.slice())
    surface.push([point[0], point[1], point[2] + 0.027]);
  const add = (indices: number[], material = 0) => {
    materialIndices[material].push(...indices);
  };
  for (let row = 0; row < sampleCount; row++)
    for (let column = 0; column < crossCount; column++) {
      const a = row * (crossCount + 1) + column,
        b = a + crossCount + 1;
      if (ventCell(row, column)) {
        // The cavity is real depth; its dark floor stays behind the painted rim.
        const first = surface.length;
        for (const index of [a, b, b + 1, a + 1]) {
          const point = surface[index];
          surface.push([point[0], point[1], point[2] + 0.018]);
        }
        add([first, first + 1, first + 3, first + 1, first + 2, first + 3], 1);
        for (const [edge, neighbor] of [
          [
            [a, b],
            [row, column - 1],
          ],
          [
            [b, b + 1],
            [row + 1, column],
          ],
          [
            [b + 1, a + 1],
            [row, column + 1],
          ],
          [
            [a + 1, a],
            [row - 1, column],
          ],
        ]) {
          if (ventCell(neighbor[0], neighbor[1])) continue;
          const offset = [a, b, b + 1, a + 1].indexOf(edge[0]);
          const n = first + offset,
            next = first + ((offset + 1) % 4);
          add([edge[0], next, edge[1], edge[0], n, next]);
        }
      } else add([a, b, a + 1, b, b + 1, a + 1]);
      add(
        [
          a + frontCount,
          a + 1 + frontCount,
          b + frontCount,
          b + frontCount,
          a + 1 + frontCount,
          b + 1 + frontCount,
        ],
        2,
      );
    }
  const border: number[] = [];
  for (let column = 0; column <= crossCount; column++) border.push(column);
  for (let row = 1; row <= sampleCount; row++)
    border.push(row * (crossCount + 1) + crossCount);
  for (let column = crossCount - 1; column >= 0; column--)
    border.push(sampleCount * (crossCount + 1) + column);
  for (let row = sampleCount - 1; row > 0; row--)
    border.push(row * (crossCount + 1));
  for (let i = 0; i < border.length; i++) {
    const a = border[i],
      b = border[(i + 1) % border.length];
    add([a, b, a + frontCount, b, b + frontCount, a + frontCount]);
  }
  face.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(surface.flat(), 3),
  );
  const surfaceIndices: number[] = [];
  materialIndices.forEach((indices, material) => {
    face.addGroup(surfaceIndices.length, indices.length, material);
    surfaceIndices.push(...indices);
  });
  face.setIndex(surfaceIndices);
  mesh(parent, face, [paint, intake, inner], 'scooter-continuous-front-apron');
}

export function makeScooter(
  player: Player,
  products: Product[],
  riderFactory: RiderFactory,
) {
  const root = new THREE.Group();
  root.scale.setScalar(1.45);
  const body = new THREE.Group();
  body.name = 'scooter-chassis';
  root.add(body);
  const frontAssembly = new THREE.Group();
  frontAssembly.name = 'front-suspension-axle';
  body.add(frontAssembly);
  const {
    frontAxle: front,
    rearAxle: rear,
    frontRadius,
    rearRadius,
  } = SCOOTER_GEOMETRY;
  const paint = finish(player.paint, 0.2, 0.32),
    rim = finish(player.rims, 0.7, 0.34);
  const dark = finish('#20262a', 0.22, 0.58),
    rubber = finish('#121619', 0, 0.92);
  const alloy = finish('#a4acaf', 0.82, 0.3),
    engine = finish('#535d63', 0.66, 0.49);
  const saddle = finish('#1a2024', 0, 0.94),
    black = finish('#080c10', 0.08, 0.54);
  const lens = finish('#dcecf2', 0.2, 0.15);
  lens.emissive.set('#b6d7ee');
  lens.emissiveIntensity = 0.3;
  lens.flatShading = false;
  const indicatorLens = finish('#bcc8ca', 0.32, 0.2);
  indicatorLens.flatShading = false;
  const tailLamp = finish('#a61d24', 0.05, 0.3);
  tailLamp.emissive.set('#e12d2d');
  tailLamp.emissiveIntensity = 0.42;
  const amber = finish('#e59b34', 0.04, 0.33);
  const wheels: THREE.Group[] = [];
  for (let i = 0; i < 2; i++) {
    const wheel = new THREE.Group(),
      radius = i ? rearRadius : frontRadius;
    const z = i ? rear : front,
      width = i
        ? SCOOTER_GEOMETRY.rearTireWidth
        : SCOOTER_GEOMETRY.frontTireWidth;
    wheel.name = i ? 'rear-wheel' : 'front-wheel';
    wheel.position.set(0, radius, z);
    (i ? body : frontAssembly).add(wheel);
    wheels.push(wheel);
    mesh(wheel, tireGeometry(radius, width), rubber, 'tire');
    castWheel(wheel, width, rim, alloy);
    if (i === 0) {
      const disc = mesh(wheel, brakeRotorGeometry(0.103), alloy, 'brake-rotor');
      disc.position.x = -0.068;
      for (let j = 0; j < 5; j++) {
        const a = (j * Math.PI * 2) / 5;
        rod(
          wheel,
          [-0.068, Math.cos(a) * 0.03, Math.sin(a) * 0.03],
          [-0.068, Math.cos(a + 0.18) * 0.075, Math.sin(a + 0.18) * 0.075],
          0.007,
          dark,
          'rotor-carrier',
        );
      }
      shell(
        frontAssembly,
        [
          [front + 0.054, 0.014, 0.033, frontRadius + 0.04],
          [front + 0.082, 0.024, 0.044, frontRadius + 0.04],
          [front + 0.106, 0.018, 0.026, frontRadius + 0.04],
        ],
        dark,
        'brake-caliper',
        -0.076,
      );
      panel(
        frontAssembly,
        [
          [-0.083, frontRadius - 0.018, front - 0.01],
          [-0.083, frontRadius + 0.06, front + 0.065],
          [-0.083, frontRadius + 0.075, front + 0.092],
          [-0.083, frontRadius + 0.004, front + 0.105],
        ],
        'x',
        engine,
        'brake-caliper-carrier',
      );
    }
  }

  // Low perimeter rails and a broad, genuinely open floor support both boot soles.
  for (const s of [-1, 1])
    tube(
      body,
      [
        [s * 0.18, 0.252, -0.3],
        [s * 0.208, 0.234, -0.14],
        [s * 0.202, 0.256, 0.22],
        [s * 0.144, 0.52, 0.4],
      ],
      0.022,
      dark,
      'scooter-frame-rail',
    );
  shell(
    body,
    [
      [-0.34, 0.22, 0.022, 0.276],
      [-0.25, 0.255, 0.024, 0.276],
      [-0.07, 0.266, 0.024, 0.276],
      [0.15, 0.239, 0.024, 0.276],
      [0.31, 0.183, 0.045, 0.302],
    ],
    dark,
    'scooter-floorboard',
    0,
    0.5,
  );
  // Recessed, ribbed rubber foot pads sit flush in the floor, not on pegs.
  for (const s of [-1, 1]) {
    shell(
      body,
      [
        [-0.294, 0.068, 0.004, 0.299],
        [-0.22, 0.083, 0.004, 0.299],
        [0.03, 0.084, 0.004, 0.299],
        [0.16, 0.059, 0.004, 0.3],
      ],
      rubber,
      'scooter-foot-mat',
      s * 0.157,
      0.5,
    );
    for (let i = 0; i < 6; i++)
      rod(
        body,
        [s * 0.103, 0.304, -0.235 + i * 0.065],
        [s * 0.208, 0.304, -0.235 + i * 0.065],
        0.002,
        dark,
        'floorboard-grip-rib',
      );
    panel(
      body,
      [
        [s * 0.237, 0.279, -0.245],
        [s * 0.252, 0.278, 0.026],
        [s * 0.229, 0.321, 0.235],
        [s * 0.212, 0.212, 0.284],
        [s * 0.222, 0.201, -0.175],
      ],
      'x',
      paint,
      'scooter-lower-side-skirt',
      0.014,
    );
  }
  legShield(body, paint, dark, black);
  // This formed neck overlaps the apron and nacelle around the same steerer.
  // It closes the previously exposed gap without moving the hands or controls.
  shell(
    body,
    [
      [-0.482, 0.044, 0.022, 1.001],
      [-0.451, 0.083, 0.06, 1.026],
      [-0.397, 0.091, 0.057, 1.032],
      [-0.369, 0.064, 0.024, 1.037],
    ],
    dark,
    'scooter-steering-collar',
    0,
    0.68,
  );
  // Reference 09 has a substantial clear pointed lamp at the apron prow.
  // The bezel wraps its facets; there is no thin lower smile or upper hexagon.
  const lampOutline: Point[] = [
    [0, 0.674, -0.751],
    [0.113, 0.64, -0.714],
    [0.082, 0.58, -0.749],
    [0, 0.537, -0.777],
    [-0.082, 0.58, -0.749],
    [-0.113, 0.64, -0.714],
  ];
  facetedCover(
    body,
    lampOutline.map(
      ([x, y, z]) =>
        [x * 1.105, 0.609 + (y - 0.609) * 1.105, z + 0.009] as Point,
    ),
    [0, 0.61, -0.772],
    black,
    'scooter-front-lamp-pocket',
    0.032,
  );
  facetedCover(
    body,
    lampOutline,
    [0, 0.611, -0.785],
    lens,
    'scooter-headlight',
    0.022,
  );

  // Under-seat storage tub and side shells rise around the rear tire clearance.
  shell(
    body,
    [
      [0.105, 0.095, 0.115, 0.452],
      [0.22, 0.173, 0.192, 0.558],
      [0.41, 0.224, 0.16, 0.637],
      [0.64, 0.213, 0.129, 0.677],
      [0.84, 0.156, 0.085, 0.723],
      [0.951, 0.055, 0.029, 0.765],
    ],
    dark,
    'scooter-underseat-body',
  );
  for (const s of [-1, 1]) {
    panel(
      body,
      [
        [s * 0.148, 0.73, 0.18],
        [s * 0.224, 0.759, 0.37],
        [s * 0.221, 0.765, 0.63],
        [s * 0.142, 0.816, 0.874],
        [s * 0.08, 0.767, 0.936],
        [s * 0.195, 0.65, 0.71],
        [s * 0.225, 0.567, 0.401],
        [s * 0.182, 0.595, 0.276],
      ],
      'x',
      paint,
      'scooter-tail-side-panel',
      0.015,
    );
    panel(
      body,
      [
        [s * 0.227, 0.697, 0.369],
        [s * 0.232, 0.711, 0.56],
        [s * 0.226, 0.666, 0.616],
        [s * 0.23, 0.626, 0.416],
      ],
      'x',
      black,
      'scooter-side-vent',
    );
    tube(
      body,
      [
        [s * 0.147, 0.831, 0.69],
        [s * 0.175, 0.869, 0.83],
        [s * 0.102, 0.87, 0.932],
        [0, 0.861, 0.954],
      ],
      0.013,
      dark,
      'scooter-passenger-grab-rail',
    );
  }
  shell(
    body,
    [
      [0.055, 0.061, 0.018, 0.75],
      [0.13, 0.138, 0.031, 0.774],
      [0.29, 0.176, 0.034, 0.776],
      [0.46, 0.188, 0.037, 0.786],
      [0.615, 0.174, 0.038, 0.813],
      [0.798, 0.145, 0.033, 0.831],
      [0.878, 0.079, 0.018, 0.824],
    ],
    saddle,
    'scooter-saddle',
    0,
    0.68,
  );
  for (const s of [-1, 1])
    tube(
      body,
      [
        [s * 0.13, 0.783, 0.13],
        [s * 0.169, 0.785, 0.29],
        [s * 0.179, 0.797, 0.46],
        [s * 0.161, 0.825, 0.64],
        [s * 0.118, 0.843, 0.824],
      ],
      0.0018,
      dark,
      'saddle-seam',
    );
  panel(
    body,
    [
      [-0.119, 0.773, 0.906],
      [0.119, 0.773, 0.906],
      [0.083, 0.725, 0.911],
      [-0.083, 0.725, 0.911],
    ],
    'z',
    tailLamp,
    'rear-tail-light',
    0.012,
  );
  for (const s of [-1, 1])
    panel(
      body,
      [
        [s * 0.125, 0.768, 0.897],
        [s * 0.154, 0.773, 0.875],
        [s * 0.139, 0.739, 0.888],
        [s * 0.118, 0.74, 0.906],
      ],
      'z',
      amber,
      'rear-indicator',
      0.012,
    );
  fender(
    body,
    rearRadius,
    rear,
    rearRadius,
    0.078,
    rubber,
    'scooter-rear-fender',
    true,
  );
  panel(
    body,
    [
      [-0.058, 0.638, 0.817],
      [0.058, 0.638, 0.817],
      [0.065, 0.304, 0.966],
      [-0.065, 0.304, 0.966],
    ],
    'z',
    dark,
    'scooter-rear-mudflap',
    0.009,
  );
  rod(
    body,
    [-0.07, 0.596, 0.733],
    [-0.06, 0.55, 0.849],
    0.009,
    dark,
    'rear-mudguard-mount',
  );
  rod(
    body,
    [0.07, 0.596, 0.733],
    [0.06, 0.55, 0.849],
    0.009,
    dark,
    'rear-mudguard-mount',
  );

  // Scooter power unit pivots ahead of the rear axle; the belt stays enclosed.
  rod(
    body,
    [-0.152, 0.322, 0.184],
    [0.152, 0.322, 0.184],
    0.035,
    engine,
    'scooter-engine-pivot',
  );
  shell(
    body,
    [
      [0.125, 0.107, 0.057, 0.312],
      [0.226, 0.135, 0.095, 0.307],
      [0.348, 0.129, 0.088, 0.287],
      [0.394, 0.07, 0.041, 0.276],
    ],
    engine,
    'scooter-engine',
  );
  shell(
    body,
    [
      [0.176, 0.034, 0.056, 0.291],
      [0.259, 0.052, 0.099, 0.28],
      [0.405, 0.044, 0.081, 0.261],
      [0.602, 0.049, 0.087, 0.241],
      [0.7, 0.043, 0.068, 0.233],
      [0.736, 0.022, 0.038, 0.233],
    ],
    dark,
    'scooter-drive-case',
    -0.129,
  );
  shell(
    body,
    [
      [0.212, 0.006, 0.034, 0.288],
      [0.29, 0.008, 0.072, 0.279],
      [0.45, 0.007, 0.056, 0.258],
      [0.641, 0.007, 0.064, 0.242],
      [0.7, 0.005, 0.029, 0.237],
    ],
    engine,
    'scooter-transmission-cover',
    -0.176,
  );
  for (const [y, z] of [
    [0.34, 0.27],
    [0.222, 0.27],
    [0.31, 0.46],
    [0.198, 0.51],
    [0.282, 0.662],
    [0.208, 0.674],
  ])
    rod(
      body,
      [-0.184, y, z],
      [-0.19, y, z],
      0.0045,
      alloy,
      'transmission-cover-bolt',
    );
  rod(
    body,
    [0.107, 0.295, 0.293],
    [0.154, 0.295, 0.293],
    0.086,
    alloy,
    'scooter-cooling-fan-housing',
  );
  rod(
    body,
    [0.155, 0.295, 0.293],
    [0.158, 0.295, 0.293],
    0.055,
    dark,
    'scooter-cooling-fan-grille',
  );
  for (let i = 0; i < 7; i++) {
    const a = (i * Math.PI * 2) / 7;
    rod(
      body,
      [0.16, 0.295 + Math.cos(a) * 0.018, 0.293 + Math.sin(a) * 0.018],
      [
        0.16,
        0.295 + Math.cos(a + 0.18) * 0.049,
        0.293 + Math.sin(a + 0.18) * 0.049,
      ],
      0.004,
      engine,
      'fan-grille-rib',
    );
  }
  // Right torque arm, axle and shock have explicit, touching mounts.
  tube(
    body,
    [
      [0.103, 0.3, 0.286],
      [0.114, 0.249, 0.44],
      [0.106, rearRadius, rear],
    ],
    0.023,
    dark,
    'scooter-right-engine-arm',
  );
  rod(
    body,
    [-0.148, rearRadius, rear],
    [0.127, rearRadius, rear],
    0.021,
    alloy,
    'rear-axle',
  );
  const shockBottom: Point = [-0.135, 0.27, 0.563],
    shockTop: Point = [-0.147, 0.619, 0.467];
  rod(body, shockBottom, shockTop, 0.015, alloy, 'scooter-rear-damper');
  const shockCurve: THREE.Vector3[] = [],
    shockAxis = v(shockTop).sub(v(shockBottom));
  const radial = new THREE.Vector3(1, 0, 0),
    tangent = shockAxis.clone().normalize();
  const binormal = new THREE.Vector3()
    .crossVectors(tangent, radial)
    .normalize();
  for (let i = 0; i <= 120; i++) {
    const t = i / 120,
      a = t * Math.PI * 16;
    shockCurve.push(
      v(shockBottom)
        .addScaledVector(shockAxis, 0.16 + t * 0.67)
        .addScaledVector(radial, Math.cos(a) * 0.024)
        .addScaledVector(binormal, Math.sin(a) * 0.024),
    );
  }
  mesh(
    body,
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(shockCurve),
      120,
      0.004,
      6,
      false,
    ),
    dark,
    'scooter-rear-spring',
  );
  rod(
    body,
    [-0.169, 0.619, 0.467],
    [-0.102, 0.619, 0.467],
    0.019,
    dark,
    'rear-shock-upper-mount',
  );
  rod(
    body,
    [-0.158, 0.27, 0.563],
    [-0.105, 0.27, 0.563],
    0.017,
    engine,
    'rear-shock-lower-mount',
  );
  tube(
    body,
    [
      [0.113, 0.276, 0.206],
      [0.18, 0.212, 0.252],
      [0.214, 0.203, 0.346],
      [0.197, 0.293, 0.431],
    ],
    0.018,
    engine,
    'scooter-exhaust-header',
  );
  const exhaust = shell(
    body,
    [
      [0.406, 0.026, 0.031, 0.291],
      [0.45, 0.055, 0.054, 0.307],
      [0.71, 0.056, 0.055, 0.383],
      [0.803, 0.038, 0.037, 0.406],
    ],
    dark,
    'single-exhaust',
    0.207,
  );
  exhaust.userData.side = 'right';
  panel(
    body,
    [
      [0.263, 0.337, 0.445],
      [0.267, 0.409, 0.715],
      [0.255, 0.391, 0.755],
      [0.269, 0.299, 0.464],
    ],
    'x',
    engine,
    'scooter-exhaust-heat-shield',
    0.012,
  );
  tube(
    body,
    [
      [0.172, 0.525, 0.615],
      [0.233, 0.441, 0.657],
      [0.24, 0.382, 0.633],
    ],
    0.011,
    dark,
    'exhaust-hanger',
  );
  rod(
    body,
    [0.123, 0.286, 0.364],
    [0.201, 0.297, 0.426],
    0.012,
    engine,
    'exhaust-front-mount',
  );
  const outletGeometry = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.027, -0.006),
      new THREE.Vector2(0.028, 0.009),
      new THREE.Vector2(0.018, 0.01),
      new THREE.Vector2(0.017, -0.035),
    ],
    20,
  );
  const outlet = mesh(body, outletGeometry, black, 'open-silencer-outlet');
  outlet.position.set(0.207, 0.407, 0.805);
  outlet.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0.28, 1).normalize(),
  );

  // A shared raked steering stem supports the fork crowns, apron and nacelle.
  rod(
    body,
    [0, 0.658, -0.53],
    [0, 1.104, -0.404],
    0.026,
    dark,
    'scooter-steering-stem',
  );
  rod(
    body,
    [0, 0.649, -0.533],
    [0, 0.84, -0.479],
    0.043,
    dark,
    'scooter-headstock',
  );
  tube(
    body,
    [
      [0, 0.291, -0.254],
      [0, 0.445, -0.344],
      [0, 0.659, -0.52],
    ],
    0.028,
    dark,
    'scooter-front-frame',
  );
  const forkSliders: {
    mesh: THREE.Mesh;
    lower: THREE.Vector3;
    upper: THREE.Vector3;
    length: number;
  }[] = [];
  for (const s of [-1, 1]) {
    const lower: Point = [s * 0.09, 0.425, -0.59],
      upper: Point = [s * 0.09, 0.772, -0.489];
    rod(
      frontAssembly,
      [s * 0.09, frontRadius, front],
      [s * 0.09, 0.46, -0.58],
      0.023,
      alloy,
      'scooter-fork-slider',
    );
    const stanchion = rod(body, lower, upper, 0.015, alloy, 'fork-stanchion');
    forkSliders.push({
      mesh: stanchion,
      lower: v(lower),
      upper: v(upper),
      length: v(upper).distanceTo(v(lower)),
    });
    rod(
      frontAssembly,
      [s * 0.09, 0.433, -0.587],
      [s * 0.09, 0.46, -0.58],
      0.026,
      dark,
      'fork-dust-seal',
    );
    rod(
      frontAssembly,
      [s * 0.09, frontRadius, front],
      [s * 0.116, frontRadius, front],
      0.018,
      engine,
      'front-axle-bolt',
    );
    rod(
      frontAssembly,
      [s * 0.089, 0.402, -0.597],
      [s * 0.068, 0.434, -0.601],
      0.008,
      dark,
      'front-fender-bracket',
    );
    rod(
      body,
      [0, 0.706, -0.507],
      [s * 0.09, 0.706, -0.507],
      0.024,
      dark,
      'lower-fork-yoke',
    );
    rod(
      body,
      [0, 0.772, -0.489],
      [s * 0.09, 0.772, -0.489],
      0.025,
      engine,
      'upper-fork-yoke',
    );
  }
  rod(
    frontAssembly,
    [-0.112, frontRadius, front],
    [0.112, frontRadius, front],
    0.014,
    alloy,
    'front-axle',
  );
  fender(
    frontAssembly,
    frontRadius,
    front,
    frontRadius,
    0.071,
    paint,
    'scooter-front-fender',
  );

  shell(
    body,
    [
      [-0.584, 0.059, 0.025, 1.083],
      [-0.537, 0.195, 0.052, 1.092],
      [-0.445, 0.23, 0.062, 1.108],
      [-0.352, 0.183, 0.043, 1.11],
      [-0.326, 0.09, 0.019, 1.102],
    ],
    dark,
    'scooter-handlebar-nacelle',
    0,
    0.76,
  );
  shell(
    body,
    [
      [-0.597, 0.022, 0.015, 1.083],
      [-0.555, 0.073, 0.038, 1.111],
      [-0.48, 0.116, 0.063, 1.132],
      [-0.395, 0.139, 0.048, 1.134],
      [-0.34, 0.101, 0.023, 1.132],
    ],
    paint,
    'scooter-nacelle-center-cover',
    0,
    0.68,
  );
  // The small instrument pod faces the rider and touches the nacelle crown.
  const instruments = shell(
    body,
    [
      [-0.41, 0.084, 0.018, 1.174],
      [-0.374, 0.093, 0.018, 1.167],
      [-0.34, 0.065, 0.012, 1.152],
    ],
    black,
    'scooter-instrument-pod',
    0,
    0.64,
  );
  instruments.receiveShadow = false;
  for (const s of [-1, 1]) {
    tube(
      body,
      [
        [s * 0.042, 1.114, -0.408],
        [s * 0.184, 1.127, -0.42],
        [s * 0.365, 1.12, -0.4],
      ],
      0.012,
      alloy,
      'scooter-handlebar',
    );
    rod(
      body,
      [s * 0.255, 1.12, -0.4],
      [s * 0.365, 1.12, -0.4],
      0.022,
      rubber,
      'rider-handgrip',
    );
    rod(
      body,
      [s * 0.369, 1.12, -0.4],
      [s * 0.382, 1.12, -0.4],
      0.021,
      dark,
      'handlebar-end-weight',
    );
    rod(
      body,
      [s * 0.226, 1.12, -0.403],
      [s * 0.252, 1.12, -0.402],
      0.026,
      dark,
      'scooter-control-pod',
    );
    tube(
      body,
      [
        [s * 0.239, 1.115, -0.42],
        [s * 0.278, 1.1, -0.459],
        [s * 0.355, 1.105, -0.451],
      ],
      0.006,
      alloy,
      'scooter-brake-lever',
    );
    facetedCover(
      body,
      [
        [s * 0.113, 1.121, -0.568],
        [s * 0.176, 1.131, -0.545],
        [s * 0.214, 1.106, -0.49],
        [s * 0.2, 1.081, -0.518],
        [s * 0.126, 1.074, -0.561],
      ],
      [s * 0.165, 1.103, -0.566],
      indicatorLens,
      'scooter-front-indicator',
      0.018,
    );
  }
  // Cable enters the fork-mounted caliper from the protected apron cavity.
  tube(
    body,
    [
      [-0.234, 1.117, -0.404],
      [-0.1, 1.033, -0.435],
      [-0.063, 0.82, -0.489],
      [-0.089, 0.491, -0.563],
    ],
    0.0032,
    rubber,
    'front-brake-hose',
  );
  tube(
    frontAssembly,
    [
      [-0.089, 0.491, -0.563],
      [-0.101, 0.37, -0.569],
      [-0.094, 0.282, -0.568],
    ],
    0.0032,
    rubber,
    'front-brake-hose-flex',
  );

  const rider = riderFactory(body, POSES.scooter, player, products);
  const rearSuspension = createRearSuspension(body, 'scooter');
  const movedLower = new THREE.Vector3(),
    direction = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0),
    xAxis = new THREE.Vector3(1, 0, 0);
  const animateSuspension = (pitch: number, travel: number, wheelieLoad = 0) => {
    const pose = activeSuspensionPose('scooter', pitch, travel, rear, front, rearRadius, wheelieLoad);
    body.rotation.x = pose.pitch;
    body.position.copy(pose.position);
    frontAssembly.rotation.x = pose.axleAngle;
    frontAssembly.position.copy(pose.axlePosition);
    rearSuspension.update(pose.rearAngle, pose.rearPosition);
    for (const fork of forkSliders) {
      movedLower
        .copy(fork.lower)
        .applyAxisAngle(xAxis, pose.axleAngle)
        .add(pose.axlePosition);
      direction.copy(fork.upper).sub(movedLower);
      fork.mesh.position.copy(movedLower).add(fork.upper).multiplyScalar(0.5);
      fork.mesh.scale.y = direction.length() / fork.length;
      fork.mesh.quaternion.setFromUnitVectors(up, direction.normalize());
    }
  };
  return {
    root,
    body,
    wheels,
    rider: rider.group,
    animateRider: rider.animate,
    captureRagdollPose: rider.captureRagdollPose,
    applyRagdollPose: rider.applyRagdollPose,
    animateAccessories: rider.animateAccessories,
    animateSuspension,
    wheelRadius: rearRadius,
    rearAxle: rear,
  };
}
