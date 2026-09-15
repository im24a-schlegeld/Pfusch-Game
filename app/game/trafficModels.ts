import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TRAFFIC_SHAPES, TOW_RAMP, towRampHeight } from './trafficDomain';

type Point = readonly [number, number, number];
type Ring = readonly [
  z: number,
  halfWidth: number,
  bottom: number,
  top: number,
];
type Material = THREE.MeshStandardMaterial;
const PAINTS = ['#657780', '#c3c6bc', '#934d40', '#677b63'];

/** The profiles use the same metres as the domain collision/ramp contract. */
function loft(rings: readonly Ring[]) {
  const positions: number[] = [],
    indices: number[] = [];
  for (const [z, width, bottom, top] of rings) {
    const bevel = Math.min(0.105, (top - bottom) * 0.2);
    for (const [x, y] of [
      [-width * 0.9, bottom],
      [width * 0.9, bottom],
      [width, bottom + bevel],
      [width, top - bevel],
      [width * 0.9, top],
      [-width * 0.9, top],
      [-width, top - bevel],
      [-width, bottom + bevel],
    ])
      positions.push(x, y, z);
  }
  for (let row = 0; row < rings.length - 1; row++)
    for (let i = 0; i < 8; i++) {
      const a = row * 8 + i,
        b = row * 8 + ((i + 1) % 8);
      indices.push(a, b, a + 8, b, b + 8, a + 8);
    }
  for (let i = 1; i < 7; i++) {
    indices.push(0, i + 1, i);
    const last = (rings.length - 1) * 8;
    indices.push(last, last + i, last + i + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Merge static details by finish: shaped panels do not add one draw call each. */
function batchParts(parent: THREE.Group) {
  const byMaterial = new Map<Material, THREE.BufferGeometry[]>();
  // Removing merged meshes mutates parent.children; iterate its snapshot.
  const children = parent.children.slice();
  for (const child of children) {
    if (
      !(child instanceof THREE.Mesh) ||
      !(child.material instanceof THREE.MeshStandardMaterial)
    )
      continue;
    child.updateMatrix();
    const source = child.geometry.clone().applyMatrix4(child.matrix);
    const geometry = source.index ? source.toNonIndexed() : source;
    if (geometry !== source) source.dispose();
    geometry.deleteAttribute('uv');
    const group = byMaterial.get(child.material) ?? [];
    group.push(geometry);
    byMaterial.set(child.material, group);
    child.geometry.dispose();
    parent.remove(child);
  }
  for (const [material, geometries] of byMaterial) {
    const merged = mergeGeometries(geometries, false)!;
    geometries.forEach((geometry) => geometry.dispose());
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `traffic-${material.name}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
  }
}

export function makeDetailedTraffic(
  kind: 'car' | 'van' | 'towtruck' | 'construction',
  colorIndex: number,
) {
  const root = new THREE.Group();
  root.name = `traffic-${kind}`;
  const parts = new THREE.Group();
  parts.name = 'traffic-body';
  root.add(parts);
  function material(
    name: string,
    color: string,
    roughness: number,
    metalness = 0,
    emission = 0,
  ) {
    const m = new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness,
      emissive: emission ? color : '#000000',
      emissiveIntensity: emission,
    });
    m.name = name;
    return m;
  }
  const paint = material(
    'paint',
    kind === 'towtruck' ? '#ced1c8' : PAINTS[colorIndex % PAINTS.length],
    0.34,
    0.3,
  );
  const rubber = material('rubber', '#192022', 0.92);
  const trim = material('trim', '#2c3537', 0.65, 0.1);
  const glass = material('glass', '#344f5d', 0.13, 0.48);
  const silver = material('alloy', '#adb6b7', 0.3, 0.8);
  const bed = material('bed', '#8b9699', 0.54, 0.75);
  const white = material('white', '#dfebe3', 0.3, 0.18, 0.22);
  const red = material('red', '#cf4838', 0.28, 0.15, 0.2);
  const amber = material('amber', '#e3a644', 0.27, 0.1, 0.45);
  function mesh(
    geometry: THREE.BufferGeometry,
    finish: Material,
    name: string,
    parent = parts,
  ) {
    const object = new THREE.Mesh(geometry, finish);
    object.name = name;
    parent.add(object);
    return object;
  }
  function box(
    name: string,
    size: Point,
    at: Point,
    finish: Material,
    parent = parts,
  ) {
    const object = mesh(new THREE.BoxGeometry(...size), finish, name, parent);
    object.position.set(...at);
    return object;
  }
  function panel(name: string, points: readonly Point[], finish: Material) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(points.flat(), 3),
    );
    const indices: number[] = [];
    for (let i = 1; i < points.length - 1; i++) indices.push(0, i, i + 1);
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    finish.side = THREE.DoubleSide;
    return mesh(geometry, finish, name);
  }
  function rod(
    name: string,
    a: Point,
    b: Point,
    radius: number,
    finish: Material,
  ) {
    const start = new THREE.Vector3(...a),
      end = new THREE.Vector3(...b);
    const direction = end.clone().sub(start);
    const object = mesh(
      new THREE.CylinderGeometry(radius, radius, direction.length(), 8),
      finish,
      name,
    );
    object.position.copy(start.add(end).multiplyScalar(0.5));
    object.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.normalize(),
    );
  }
  function wheel(x: number, z: number, radius: number) {
    const group = new THREE.Group();
    group.name = 'traffic-wheel';
    group.position.set(x, radius, z);
    group.userData.radius = radius;
    root.add(group);
    const tire = mesh(
      new THREE.TorusGeometry(radius - 0.095, 0.095, 8, 24),
      rubber,
      'traffic-tire',
      group,
    );
    tire.rotation.y = Math.PI / 2;
    const disc = mesh(
      new THREE.CylinderGeometry(radius * 0.7, radius * 0.7, 0.145, 24),
      trim,
      'wheel-barrel',
      group,
    );
    disc.rotation.z = Math.PI / 2;
    for (const side of [-1, 1]) {
      const rim = mesh(
        new THREE.TorusGeometry(radius * 0.69, 0.025, 5, 24),
        silver,
        'rim-lip',
        group,
      );
      rim.rotation.y = Math.PI / 2;
      rim.position.x = side * 0.079;
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3;
        const spoke = box(
          'rim-spoke',
          [0.04, radius * 0.57, 0.057],
          [
            side * 0.086,
            Math.cos(angle) * radius * 0.35,
            Math.sin(angle) * radius * 0.35,
          ],
          silver,
          group,
        );
        spoke.rotation.x = angle;
      }
      const hub = mesh(
        new THREE.CylinderGeometry(0.093, 0.093, 0.032, 12),
        silver,
        'rim-hub',
        group,
      );
      hub.rotation.z = Math.PI / 2;
      hub.position.x = side * 0.103;
    }
    batchParts(group);
  }
  function wheelArch(side: number, z: number, radius: number, x: number) {
    const arch = mesh(
      new THREE.TorusGeometry(radius + 0.045, 0.026, 5, 24, Math.PI),
      trim,
      'open-wheel-arch',
    );
    arch.rotation.set(0, Math.PI / 2, 0);
    arch.position.set(side * x, radius, z);
  }
  function lamps(
    width: number,
    front: number,
    back: number,
    y: number,
    rearY = y,
  ) {
    for (const side of [-1, 1]) {
      box(
        'headlight-housing',
        [0.51, 0.23, 0.075],
        [side * width * 0.32, y, front + 0.015],
        trim,
      );
      box(
        'headlight',
        [0.44, 0.14, 0.08],
        [side * width * 0.32, y + 0.02, front + 0.01],
        white,
      );
      box(
        'rear-light',
        [0.43, 0.13, 0.055],
        [side * width * 0.33, rearY, back],
        red,
      );
    }
    box(
      'number-plate-inset',
      [0.65, 0.21, 0.045],
      [0, rearY - 0.24, back],
      trim,
    );
    box(
      'number-plate',
      [0.5, 0.13, 0.052],
      [0, rearY - 0.24, back + 0.009],
      white,
    );
  }

  if (kind === 'construction') {
    const shape = TRAFFIC_SHAPES.construction;
    for (const side of [-1, 1]) {
      box(
        'weighted-foot',
        [0.55, 0.12, shape.length],
        [side * 0.8, 0.06, 0],
        rubber,
      );
      box('barrier-post', [0.065, 1.1, 0.065], [side * 0.8, 0.65, 0], silver);
      box('warning-lamp-base', [0.14, 0.08, 0.14], [side * 0.8, 1.13, 0], trim);
      const warning = mesh(
        new THREE.SphereGeometry(0.09, 10, 6),
        amber,
        'warning-lamp',
      );
      warning.position.set(side * 0.8, 1.16, 0);
    }
    for (const y of [0.5, 0.89]) {
      box('barrier-board', [shape.width, 0.27, 0.07], [0, y, 0], white);
      for (const z of [-0.039, 0.039])
        for (let x = -0.92; x < 1; x += 0.46)
          panel(
            'red-warning-stripe',
            [
              [x - 0.15, y - 0.135, z],
              [x + 0.035, y - 0.135, z],
              [x + 0.2, y + 0.135, z],
              [x + 0.015, y + 0.135, z],
            ],
            red,
          );
    }
  } else if (kind === 'car') {
    const { width, length } = TRAFFIC_SHAPES.car;
    const half = width / 2;
    // Bumper, shoulder and roof are separate curved profiles. Wheel openings
    // stay open under the upper shoulder instead of painting circles on a box.
    mesh(
      loft([
        [-2.9, 0.9, 0.43, 0.76],
        [-2.68, 1.11, 0.43, 0.94],
        [-1.95, half, 0.94, 1.05],
        [0, half, 0.98, 1.12],
        [1.85, half, 0.94, 1.09],
        [2.62, 1.1, 0.46, 1],
        [2.9, 0.94, 0.46, 0.91],
      ]),
      paint,
      'sculpted-body',
    );
    mesh(
      loft([
        [-2.7, 0.78, 0.4, 0.87],
        [2.64, 0.8, 0.4, 0.93],
      ]),
      trim,
      'underbody',
    );
    mesh(
      loft([
        [-1.34, 1.04, 1.03, 1.19],
        [-0.59, 0.91, 1.1, 1.94],
        [0.66, 0.91, 1.1, 1.98],
        [1.5, 1.035, 1.04, 1.3],
      ]),
      paint,
      'raked-cabin',
    );
    panel(
      'windscreen',
      [
        [-0.9, 1.268, -1.28],
        [0.9, 1.268, -1.28],
        [0.79, 1.878, -0.67],
        [-0.79, 1.878, -0.67],
      ],
      glass,
    );
    panel(
      'rear-window',
      [
        [-0.79, 1.91, 0.77],
        [0.79, 1.91, 0.77],
        [0.9, 1.391, 1.41],
        [-0.9, 1.391, 1.41],
      ],
      glass,
    );
    for (const side of [-1, 1]) {
      panel(
        'front-door-glass',
        [
          [side * 1.026, 1.22, -1.23],
          [side * 0.918, 1.82, -0.52],
          [side * 0.918, 1.87, 0.16],
          [side * 1.052, 1.21, 0.16],
        ],
        glass,
      );
      panel(
        'rear-door-glass',
        [
          [side * 1.052, 1.21, 0.29],
          [side * 0.918, 1.87, 0.29],
          [side * 0.918, 1.85, 0.62],
          [side * 1.021, 1.31, 1.35],
          [side * 1.05, 1.21, 1.35],
        ],
        glass,
      );
      box(
        'door-skin',
        [0.13, 0.57, 2.75],
        [side * (half - 0.08), 0.72, 0],
        paint,
      );
      box('sill', [0.11, 0.11, 2.73], [side * 1.08, 0.41, 0], trim);
      for (const z of [0.13, 1.16]) {
        rod(
          'door-seam',
          [side * 1.18, 0.49, z],
          [side * 1.18, 1.03, z],
          0.007,
          trim,
        );
        box(
          'door-handle',
          [0.028, 0.035, 0.19],
          [side * 1.18, 1.04, z - 0.15],
          silver,
        );
      }
      for (const z of [-1.85, 1.85]) {
        wheel(side * 1.055, z, 0.46);
        wheelArch(side, z, 0.46, 1.16);
      }
    }
    lamps(width, -length / 2, length / 2, 0.76);
    box('grille', [1.17, 0.18, 0.055], [0, 0.64, -2.904], trim);
    for (const y of [0.6, 0.66, 0.72])
      box('grille-slat', [1.03, 0.018, 0.066], [0, y, -2.91], silver);
    box('rear-bumper-inset', [1.66, 0.1, 0.075], [0, 0.5, 2.85], trim);
  } else {
    const tow = kind === 'towtruck';
    const dimensions = TRAFFIC_SHAPES[kind];
    const front = dimensions.frontZ;
    const cabinBack = tow ? -1.2 : 0.15;
    const frontAxle = front + 0.91;
    const rearAxle = tow ? 1.18 : 2.09;
    const cabW = tow ? 1.18 : 1.2;
    const tireRadius = tow ? 0.43 : 0.49;
    const cabRings: Ring[] = [
      [front, 0.96, 0.51, 1.12],
      [front + 0.3, 1.12, 0.55, 1.38],
    ];
    for (const offset of [
      -0.55, -0.44, -0.3, -0.16, 0, 0.16, 0.3, 0.44, 0.55,
    ]) {
      const archRadius = tireRadius + 0.05;
      const bottom =
        Math.abs(offset) < archRadius
          ? tireRadius + Math.sqrt(archRadius ** 2 - offset ** 2)
          : 0.54;
      cabRings.push([
        frontAxle + offset,
        cabW,
        bottom,
        1.54 + 0.1 * (1 - Math.abs(offset) / 0.55),
      ]);
    }
    cabRings.push([cabinBack, cabW, 0.54, 1.5]);
    mesh(loft(cabRings), paint, 'van-cab-lower');
    mesh(
      loft([
        [front + 0.69, 1.075, 1.53, 1.62],
        [front + 1.31, 1.02, 1.56, 2.8],
        [front + 1.61, 1.04, 1.55, 2.94],
        [cabinBack, 1.09, 1.52, 2.94],
      ]),
      paint,
      'cab-roof',
    );
    panel(
      'van-windscreen',
      [
        [-0.96, 1.735, front + 0.74],
        [0.96, 1.735, front + 0.74],
        [0.88, 2.688, front + 1.24],
        [-0.88, 2.688, front + 1.24],
      ],
      glass,
    );
    for (const side of [-1, 1]) {
      panel(
        'cab-side-window',
        [
          [side * 1.086, 1.66, front + 0.82],
          [side * 1.025, 2.67, front + 1.4],
          [side * 1.078, 2.73, cabinBack - 0.2],
          [side * 1.16, 1.67, cabinBack - 0.2],
        ],
        glass,
      );
      rod(
        'cab-door-seam',
        [side * 1.19, 0.66, cabinBack - 0.13],
        [side * 1.19, 2.75, cabinBack - 0.13],
        0.009,
        trim,
      );
      box(
        'cab-handle',
        [0.042, 0.055, 0.24],
        [side * 1.2, 1.44, cabinBack - 0.32],
        trim,
      );
      box(
        'cab-step',
        [0.14, 0.12, 0.73],
        [side * 1.13, 0.48, cabinBack - 0.53],
        trim,
      );
      for (const z of [frontAxle, rearAxle]) {
        wheel(side * 1.075, z, tireRadius);
        wheelArch(side, z, tireRadius, 1.185);
      }
    }
    box('front-bumper', [2.12, 0.25, 0.16], [0, 0.52, front + 0.07], trim);
    box('front-grille', [0.93, 0.28, 0.07], [0, 0.88, front - 0.006], trim);
    for (const y of [0.79, 0.88, 0.97])
      box('grille-rail', [0.86, 0.017, 0.074], [0, y, front - 0.015], silver);
    lamps(
      dimensions.width,
      front,
      tow ? 2.34 : dimensions.length / 2 - 0.06,
      0.96,
      tow ? 0.43 : 0.96,
    );
    if (tow) {
      box('rear-chassis', [1.67, 0.16, 3.5], [0, 0.5, 0.57], trim);
      // The bare tray is open at both sides. Its rear slopes continuously down
      // to the road; crossing either edge triggers the same domain launch.
      const ramp = TOW_RAMP;
      const half = ramp.halfWidth;
      mesh(
        loft([
          [
            -1.16,
            half,
            ramp.frontHeight - ramp.deckThickness,
            ramp.frontHeight,
          ],
          [
            ramp.frontZ,
            half,
            ramp.frontHeight - ramp.deckThickness,
            ramp.frontHeight,
          ],
          [
            ramp.rearZ,
            half,
            ramp.rearHeight - ramp.deckThickness,
            ramp.rearHeight,
          ],
        ]),
        bed,
        'tow-deck-and-ramp',
      );
      for (const side of [-1, 1]) {
        box(
          'deck-front-edge',
          [0.048, 0.08, ramp.frontZ + 1.12],
          [
            side * (half - 0.028),
            ramp.frontHeight + 0.04,
            (ramp.frontZ - 1.12) / 2,
          ],
          silver,
        );
        for (const z of [-0.8, 0.2, 1.1])
          box(
            'bed-marker',
            [0.046, 0.058, 0.13],
            [side * (half - 0.01), ramp.frontHeight - 0.04, z],
            amber,
          );
        for (let z = -0.9; z < ramp.rearZ; z += 0.27) {
          const fraction = Math.max(
            0,
            (z - ramp.frontZ) / (ramp.rearZ - ramp.frontZ),
          );
          const y =
            ramp.frontHeight + (ramp.rearHeight - ramp.frontHeight) * fraction;
          box(
            'deck-traction-slot',
            [0.085, 0.012, 0.105],
            [side * 0.83, y + 0.008, z],
            trim,
          );
        }
        box(
          'rear-mudflap',
          [0.35, 0.43, 0.045],
          [side * 1.06, 0.29, rearAxle + 0.56],
          rubber,
        );
      }
      rod(
        'headboard-left',
        [-1.1, ramp.frontHeight, -1.12],
        [-1.1, 2.99, -1.12],
        0.05,
        silver,
      );
      rod(
        'headboard-right',
        [1.1, ramp.frontHeight, -1.12],
        [1.1, 2.99, -1.12],
        0.05,
        silver,
      );
      rod(
        'headboard-top',
        [-1.1, 2.99, -1.12],
        [1.1, 2.99, -1.12],
        0.05,
        silver,
      );
      box('amber-beacon-base', [0.64, 0.05, 0.15], [0, 2.92, -1.68], trim);
      box('amber-beacon', [0.59, 0.08, 0.14], [0, 2.99, -1.68], amber);
      box(
        'winch',
        [0.51, 0.24, 0.29],
        [0, ramp.frontHeight + 0.135, -0.91],
        trim,
      );
      for (const side of [-1, 1])
        panel(
          'ramp-side-chevron',
          [
            [
              side * 1.251,
              towRampHeight(ramp.rearZ - 0.15) - 0.045,
              ramp.rearZ - 0.15,
            ],
            [
              side * 1.251,
              towRampHeight(ramp.rearZ - 0.4) - 0.045,
              ramp.rearZ - 0.4,
            ],
            [
              side * 1.251,
              towRampHeight(ramp.rearZ - 0.4) - 0.02,
              ramp.rearZ - 0.4,
            ],
            [
              side * 1.251,
              towRampHeight(ramp.rearZ - 0.15) - 0.02,
              ramp.rearZ - 0.15,
            ],
          ],
          white,
        );
    } else {
      mesh(
        loft([
          [0.04, 1.19, 0.57, 2.95],
          [1.51, 1.2, 0.58, 3],
          [1.78, 1.2, 0.99, 3],
          [2.4, 1.2, 0.99, 3],
          [2.68, 1.2, 0.57, 2.98],
          [3.21, 1.1, 0.57, 2.9],
        ]),
        paint,
        'cargo-shell',
      );
      for (const side of [-1, 1]) {
        box(
          'cargo-front-sill',
          [0.04, 0.18, 1.47],
          [side * 1.205, 0.64, 0.775],
          trim,
        );
        box(
          'cargo-rear-sill',
          [0.04, 0.18, 0.54],
          [side * 1.205, 0.64, 2.94],
          trim,
        );
        box(
          'cargo-door-recess',
          [0.016, 0.035, 2.42],
          [side * 1.211, 1.47, 1.65],
          trim,
        );
        box(
          'cargo-handle',
          [0.035, 0.045, 0.22],
          [side * 1.22, 1.37, 0.3],
          trim,
        );
      }
      rod('rear-door-center', [0, 0.75, 3.24], [0, 2.8, 3.24], 0.01, trim);
      for (const side of [-1, 1])
        box(
          'rear-door-handle',
          [0.055, 0.22, 0.04],
          [side * 0.1, 1.48, 3.247],
          trim,
        );
    }
  }
  batchParts(parts);
  // One tiny alpha texture and one plane replace costly per-vehicle shadowmaps.
  // The texture tapers to zero at all edges, without a visible rectangular pad.
  const shadowPixels = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const radius = Math.hypot((x - 15.5) / 15.5, (y - 15.5) / 15.5);
      const shade = Math.round(Math.max(0, 1 - radius * radius) ** 2 * 255);
      const index = (y * 32 + x) * 4;
      shadowPixels[index] =
        shadowPixels[index + 1] =
        shadowPixels[index + 2] =
          shade;
      shadowPixels[index + 3] = 255;
    }
  const shadowMap = new THREE.DataTexture(shadowPixels, 32, 32);
  shadowMap.magFilter = THREE.LinearFilter;
  shadowMap.minFilter = THREE.LinearFilter;
  shadowMap.needsUpdate = true;
  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: '#111819',
    alphaMap: shadowMap,
    opacity: 0.31,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  shadowMaterial.addEventListener('dispose', () => shadowMap.dispose());
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(
      TRAFFIC_SHAPES[kind].width * 1.24,
      TRAFFIC_SHAPES[kind].length * 1.05,
    ),
    shadowMaterial,
  );
  shadow.name = 'traffic-contact-shadow';
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.011;
  shadow.position.z =
    (TRAFFIC_SHAPES[kind].frontZ + TRAFFIC_SHAPES[kind].rearZ) / 2;
  root.add(shadow);
  root.userData.kind = kind;
  root.userData.shape = TRAFFIC_SHAPES[kind];
  return root;
}

/** Static geometry is shared by cloned pool entries; only four wheel poses move. */
export function animateTraffic(
  group: THREE.Group,
  velocity: number,
  dt: number,
) {
  if (!velocity || dt <= 0) return;
  const model = group.children[0];
  if (!model) return;
  for (const child of model.children)
    if (child.name === 'traffic-wheel')
      child.rotation.x -= (velocity * dt) / (child.userData.radius as number);
}
