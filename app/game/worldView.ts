import * as THREE from 'three';
import { LANE } from './engine';
import { WORLD_LOOK_BEHIND, type World, type WorldSegment } from './world';
import { addWorldSurfaceDetail } from './worldSurface';
import {
  makeTunnelBermGeometry,
  makeTunnelMountainGeometry,
  writeTunnelBermMatrix,
} from './worldTerrain';

export const WORLD_VIEW = Object.freeze({
  cellLength: 12,
  lookBehind: WORLD_LOOK_BEHIND,
  lookAhead: 204,
  cellCount: 22,
  instancesPerBatch: 1024,
});

const COLORS = {
  asphalt: '#30383d',
  marking: '#dbddd0',
  curb: '#a4aaa0',
  sidewalk: '#7e8985',
  grass: '#63715c',
  soil: '#6e6759',
  sand: '#96917d',
  concrete: '#929993',
  dark: '#333e42',
  steel: '#626f75',
  glass: '#36505a',
  glassLit: '#b6c3b4',
  water: '#466e7c',
  ripple: '#7b9a9d',
  city0: '#b0b2a6',
  city1: '#7f8a88',
  city2: '#747b7c',
  city3: '#b8ad96',
  shed0: '#687774',
  shed1: '#8f968b',
  shed2: '#8e7663',
  shed3: '#5f7379',
  brick: '#826b5c',
  white: '#c8cbbf',
  orange: '#c58444',
  yellow: '#c7ac5c',
  foliage: '#455d47',
  foliageLight: '#6b7b55',
  trunk: '#675e4d',
  tunnelModern: '#7f9098',
  tunnelWeathered: '#837d6b',
  tunnelPanel: '#b0b9b5',
  tunnelStain: '#655f50',
  tunnelBand: '#57798b',
  lampCool: '#d8f4ed',
  lampWarm: '#ffe0a0',
  bridgeDeck: '#818c89',
  red: '#b64f3e',
  signGreen: '#447765',
} as const;
type Finish = keyof typeof COLORS;
type Form = 'box' | 'round' | 'canopy' | 'cone' | 'arch' | 'mountain' | 'berm';
interface Batch {
  readonly mesh: THREE.InstancedMesh;
  used: number;
}

/** Hollow vaulted shell, open only at its two longitudinal ends. */
function tunnelArch() {
  const shape = new THREE.Shape();
  const count = 40;
  for (let i = 0; i <= count; i++) {
    const angle = (i / count) * Math.PI;
    const x = Math.cos(angle) * 6.9,
      y = 4 + Math.sin(angle) * 4.25;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  for (let i = count; i >= 0; i--) {
    const angle = (i / count) * Math.PI;
    shape.lineTo(Math.cos(angle) * 6.1, 4 + Math.sin(angle) * 3.55);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -0.5);
  return geometry;
}

function variation(cell: number, variant: number, salt: number) {
  return (
    (Math.imul(cell + 4096, 1664525) + variant * 1013904223 + salt * 69069) >>>
    0
  );
}

/** All GPU objects are allocated here once; update only writes pooled transforms. */
export function makeWorldView(scene: THREE.Scene, low: boolean) {
  const surfaceOrigin = { value: 0 };
  const root = new THREE.Group();
  root.name = 'streamed-world';
  scene.add(root);
  const geometries: Record<Form, THREE.BufferGeometry> = {
    box: new THREE.BoxGeometry(1, 1, 1),
    round: new THREE.CylinderGeometry(1, 1, 1, low ? 8 : 12),
    canopy: new THREE.IcosahedronGeometry(1, low ? 0 : 1),
    cone: new THREE.ConeGeometry(1, 1, low ? 7 : 10),
    arch: tunnelArch(),
    mountain: makeTunnelMountainGeometry(),
    berm: makeTunnelBermGeometry(),
  };
  const materials = {} as Record<Finish, THREE.MeshStandardMaterial>;
  const batches = new Map<string, Batch>();
  function allocate(form: Form, finish: Finish, material = materials[finish]) {
    const mesh = new THREE.InstancedMesh(
      geometries[form],
      material,
      WORLD_VIEW.instancesPerBatch,
    );
    mesh.name = `world-${form}-${finish}`;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // The fixed view interval does the culling. Recomputing aggregate instance
    // bounds every frame would add work and can leave stale recycled bounds.
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    root.add(mesh);
    batches.set(`${form}:${finish}`, { mesh, used: 0 });
  }
  for (const finish of Object.keys(COLORS) as Finish[]) {
    const light = finish === 'lampCool' || finish === 'lampWarm';
    materials[finish] = new THREE.MeshStandardMaterial({
      color: COLORS[finish],
      roughness: finish === 'water' ? 0.26 : finish === 'glass' ? 0.3 : 0.84,
      metalness: finish === 'steel' ? 0.65 : finish === 'glass' ? 0.4 : 0,
      emissive: light || finish === 'glassLit' ? COLORS[finish] : '#000000',
      emissiveIntensity: light ? 2.6 : finish === 'glassLit' ? 0.12 : 0,
    });
    if (finish === 'asphalt')
      addWorldSurfaceDetail(materials[finish], surfaceOrigin, 'asphalt', low);
    if (finish === 'grass' || finish === 'soil' || finish === 'sand')
      addWorldSurfaceDetail(materials[finish], surfaceOrigin, 'ground', low);
    allocate('box', finish);
  }
  for (const finish of ['concrete', 'steel', 'trunk', 'white', 'dark'] as const)
    allocate('round', finish);
  for (const finish of ['foliage', 'foliageLight', 'soil', 'grass'] as const)
    allocate('canopy', finish);
  allocate('cone', 'foliage');
  // Shared only by terrain: baked rock beds leave other soil batches unchanged.
  // Flat derivative normals also support the berm's pooled shear transform.
  const terrainMaterial = materials.soil.clone();
  terrainMaterial.color.set('#ffffff');
  terrainMaterial.vertexColors = true;
  terrainMaterial.flatShading = true;
  terrainMaterial.roughness = 1;
  addWorldSurfaceDetail(terrainMaterial, surfaceOrigin, 'rock', low);
  allocate('mountain', 'soil', terrainMaterial);
  allocate('berm', 'soil', terrainMaterial);
  for (const finish of [
    'tunnelModern',
    'tunnelWeathered',
    'concrete',
    'dark',
  ] as const)
    allocate('arch', finish);

  const matrix = new THREE.Matrix4(),
    quaternion = new THREE.Quaternion(),
    position = new THREE.Vector3(),
    scale = new THREE.Vector3(),
    direction = new THREE.Vector3(),
    up = new THREE.Vector3(0, 1, 0),
    euler = new THREE.Euler();
  const clearanceBox = new THREE.Box3();
  // Candidate crowns are checked after every visible cell and landmark exists,
  // including the neighboring environment at a clipped cell boundary.
  const clearances = new Float32Array(8192 * 6);
  // A 12 m cell can contain up to three spans long enough for 3.5 m details.
  const candidates = Array.from({ length: WORLD_VIEW.cellCount * 12 }, () => ({
    x: 0,
    z: 0,
    height: 0,
    pine: false,
  }));
  let clearanceCount = 0,
    treeCount = 0,
    drawingTrees = false;
  for (const geometry of Object.values(geometries))
    geometry.computeBoundingBox();
  function reserve(geometry: THREE.BufferGeometry) {
    if (drawingTrees) return;
    clearanceBox.copy(geometry.boundingBox!).applyMatrix4(matrix);
    if (clearanceBox.max.y < 0.35) return;
    if (clearanceCount >= clearances.length / 6)
      throw new RangeError('World clearance pool exhausted');
    const i = clearanceCount++ * 6;
    clearances.set(
      [
        clearanceBox.min.x,
        clearanceBox.min.y,
        clearanceBox.min.z,
        clearanceBox.max.x,
        clearanceBox.max.y,
        clearanceBox.max.z,
      ],
      i,
    );
  }
  let anchor = 0;

  function put(
    form: Form,
    finish: Finish,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    worldZ: number,
    rotateZ = 0,
  ) {
    const batch = batches.get(`${form}:${finish}`)!;
    if (batch.used === WORLD_VIEW.instancesPerBatch)
      throw new RangeError(`World instance pool exhausted: ${form}:${finish}`);
    position.set(x, y, anchor - worldZ);
    scale.set(w, h, d);
    quaternion.setFromEuler(euler.set(0, 0, rotateZ));
    matrix.compose(position, quaternion, scale);
    batch.mesh.setMatrixAt(batch.used++, matrix);
    reserve(geometries[form]);
  }
  function box(
    finish: Finish,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    tilt = 0,
  ) {
    if (d > 0) put('box', finish, w, h, d, x, y, z, tilt);
  }
  function rod(
    finish: 'steel' | 'dark',
    x: number,
    y: number,
    z: number,
    endX: number,
    endY: number,
    endZ: number,
    radius: number,
  ) {
    const batch = batches.get(`round:${finish}`)!;
    direction.set(endX - x, endY - y, z - endZ);
    const length = direction.length();
    quaternion.setFromUnitVectors(up, direction.divideScalar(length));
    position.set((x + endX) / 2, (y + endY) / 2, anchor - (z + endZ) / 2);
    scale.set(radius, length, radius);
    matrix.compose(position, quaternion, scale);
    if (batch.used === WORLD_VIEW.instancesPerBatch)
      throw new RangeError('World rod pool exhausted');
    batch.mesh.setMatrixAt(batch.used++, matrix);
    reserve(geometries.round);
  }

  function road(start: number, end: number) {
    const length = end - start,
      mid = (start + end) / 2;
    box('asphalt', 9.6, 0.18, length, 0, -0.1, mid);
    for (const side of [-1, 1])
      box('marking', 0.085, 0.009, length, side * 4.5, 0.004, mid);
    for (let tick = Math.floor(start / 7) * 7; tick < end; tick += 7) {
      const a = Math.max(start, tick),
        b = Math.min(end, tick + 3.8);
      if (b <= a) continue;
      for (const side of [-1, 1])
        box(
          'marking',
          0.09,
          0.009,
          b - a,
          (side * LANE) / 2,
          0.004,
          (a + b) / 2,
        );
    }
  }
  function sidewalk(start: number, end: number, raised = true) {
    const length = end - start,
      mid = (start + end) / 2;
    for (const side of [-1, 1]) {
      box(
        'sidewalk',
        1.45,
        0.2,
        length,
        side * 5.5,
        raised ? 0.04 : -0.05,
        mid,
      );
      box('curb', 0.18, 0.26, length, side * 4.85, raised ? 0.045 : -0.02, mid);
    }
    if (raised)
      // Grates follow the same world-space cadence across cells. They sit on
      // the sidewalk outside the asphalt, with no extra obstacle or RNG state.
      for (let z = Math.ceil((start - 6) / 24) * 24 + 6; z < end; z += 24) {
        const depth = Math.min(0.72, (z - start) * 2, (end - z) * 2);
        if (depth < 0.3) continue;
        for (const side of [-1, 1]) {
          box('dark', 0.3, 0.01, depth, side * 5.14, 0.146, z);
          for (const offset of [-0.2, 0, 0.2]) {
            if (Math.abs(offset) + 0.018 > depth / 2) continue;
            box('steel', 0.28, 0.014, 0.025, side * 5.14, 0.153, z + offset);
          }
        }
      }
  }
  function rail(x: number, start: number, end: number, height = 1.15) {
    const mid = (start + end) / 2,
      length = end - start;
    box('steel', 0.09, 0.1, length, x, height, mid);
    box('steel', 0.06, 0.08, length, x, 0.53, mid);
    for (let z = Math.ceil(start / 3) * 3; z < end; z += 3)
      box('steel', 0.07, height, 0.07, x, height / 2, z);
  }
  function streetLamp(side: number, z: number, modern = false) {
    put('round', 'dark', 0.065, 6.4, 0.065, side * 6.45, 3.2, z);
    box('dark', 1.7, 0.085, 0.1, side * 5.65, 6.35, z);
    box('lampCool', modern ? 0.9 : 0.65, 0.055, 0.25, side * 5.05, 6.28, z);
  }
  function tree(x: number, z: number, height: number, pine: boolean) {
    if (treeCount === candidates.length)
      throw new RangeError('World tree candidate pool exhausted');
    Object.assign(candidates[treeCount++], { x, z, height, pine });
  }
  function drawTree(x: number, z: number, height: number, pine: boolean) {
    put('round', 'trunk', 0.18, height * 0.7, 0.18, x, height * 0.35, z);
    if (pine) {
      put(
        'cone',
        'foliage',
        height * 0.27,
        height * 0.72,
        height * 0.27,
        x,
        height * 0.66,
        z,
      );
      put(
        'cone',
        'foliage',
        height * 0.2,
        height * 0.56,
        height * 0.2,
        x,
        height * 0.89,
        z,
      );
    } else {
      put(
        'canopy',
        'foliage',
        height * 0.36,
        height * 0.31,
        height * 0.28,
        x,
        height * 0.77,
        z,
      );
      if (!low)
        put(
          'canopy',
          'foliageLight',
          height * 0.23,
          height * 0.26,
          height * 0.23,
          x + 0.9,
          height * 0.88,
          z + 0.4,
        );
    }
  }

  function plantClearTrees() {
    drawingTrees = true;
    for (let candidate = 0; candidate < treeCount; candidate++) {
      const { x, z, height, pine } = candidates[candidate];
      const radius = height * (pine ? 0.27 : 0.36);
      const halfDepth = height * (pine ? 0.27 : 0.28);
      const minX = x - radius - 0.12;
      const maxX =
        x + Math.max(radius, pine || low ? 0 : 0.9 + height * 0.23) + 0.12;
      const minZ =
        anchor -
        z -
        Math.max(halfDepth, pine || low ? 0 : 0.4 + height * 0.23) -
        0.12;
      const maxZ = anchor - z + halfDepth + 0.12;
      const top = height * (pine ? 1.17 : 1.14);
      if (minX < 4.95 && maxX > -4.95) continue;
      let clear = true;
      for (let i = 0; i < clearanceCount * 6; i += 6) {
        if (
          maxX > clearances[i] &&
          minX < clearances[i + 3] &&
          top > clearances[i + 1] &&
          clearances[i + 4] > 0 &&
          maxZ > clearances[i + 2] &&
          minZ < clearances[i + 5]
        ) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      drawTree(x, z, height, pine);
      if (clearanceCount >= clearances.length / 6)
        throw new RangeError('World tree clearance pool exhausted');
      clearances.set([minX, 0, minZ, maxX, top, maxZ], clearanceCount++ * 6);
    }
    drawingTrees = false;
  }

  function city(
    segment: WorldSegment,
    start: number,
    end: number,
    cell: number,
  ) {
    const length = end - start,
      mid = (start + end) / 2,
      depth = Math.min(10.8, length - 0.5);
    for (const side of [-1, 1]) {
      const v = variation(cell, segment.variant, side + 3),
        height = 6 + (v % 5) * 2.8,
        width = 5.8 + (v % 3) * 0.7,
        setback = v % 3 === 0 ? 2.2 : 0,
        x = side * (8.15 + setback + width / 2),
        facade = side * (8.12 + setback);
      box(
        `city${(v >>> 3) % 4}` as Finish,
        width,
        height,
        depth,
        x,
        height / 2,
        mid,
      );
      box('concrete', width + 0.2, 0.24, depth + 0.1, x, height + 0.12, mid);
      box('dark', 0.18, 0.22, depth, facade, 2.85, mid);
      box('glass', 0.035, 1.8, depth * 0.64, facade - side * 0.05, 1.3, mid);
      box(
        segment.variant % 2 ? 'brick' : 'dark',
        1.2,
        0.13,
        depth * 0.75,
        side * (7.62 + setback),
        2.65,
        mid,
      );
      const floors = Math.min(low ? 3 : 6, Math.floor((height - 2) / 2.6));
      for (let floor = 0; floor < floors; floor++)
        for (let column = 0; column < (low ? 2 : 3); column++)
          box(
            (floor + column + v) % 4 === 0 ? 'glassLit' : 'glass',
            0.045,
            1.1,
            depth * 0.14,
            facade - side * 0.07,
            4 + floor * 2.6,
            mid + (column - (low ? 0.5 : 1)) * depth * 0.29,
          );
      if (!low) {
        box('steel', 1.3, 0.45, 1.1, x, height + 0.45, mid);
        box('dark', 0.45, 1.1, 0.65, side * 6.9, 0.55, mid - 3);
      }
      if (cell % 2 === 0) streetLamp(side, mid);
      if (v % 3 === 0) tree(side * 7.1, mid + depth * 0.3, 4.8, false);
      // A second staggered silhouette gives streets depth beyond the first facade.
      box(
        `city${v % 4}` as Finish,
        8,
        height + 4,
        depth * 0.85,
        side * (20 + setback),
        (height + 4) / 2,
        mid,
      );
    }
  }

  function industrial(
    segment: WorldSegment,
    start: number,
    end: number,
    cell: number,
  ) {
    const length = end - start,
      mid = (start + end) / 2,
      depth = Math.min(10.8, length - 0.4);
    for (const side of [-1, 1]) {
      const v = variation(cell, segment.variant, side + 5);
      box(`shed${v % 4}` as Finish, 10, 4.8, depth, side * 14, 2.4, mid);
      box('steel', 10.4, 0.3, depth + 0.1, side * 14, 4.95, mid);
      box('dark', 0.07, 3.4, depth * 0.5, side * 8.96, 1.8, mid);
      for (let rib = 0; rib < (low ? 2 : 5); rib++)
        box(
          'steel',
          0.11,
          4.6,
          0.08,
          side * 8.9,
          2.4,
          mid + (rib / (low ? 1 : 4) - 0.5) * depth * 0.9,
        );
      box('yellow', 0.1, 0.12, depth * 0.5, side * 8.88, 0.35, mid);
      rail(side * 7, start, end, 1.7);
      if (v % 3 === 0) {
        put('round', 'concrete', 1.7, 8.2, 1.7, side * 22, 4.1, mid);
        put('round', 'steel', 1.82, 0.35, 1.82, side * 22, 8.35, mid);
        rod('steel', side * 22, 6, mid, side * 14, 6, mid, 0.12);
      } else {
        box(
          `shed${(v + 2) % 4}` as Finish,
          3.2,
          2.5,
          depth * 0.7,
          side * 22,
          1.25,
          mid,
        );
        box('dark', 3.3, 0.1, depth * 0.7, side * 22, 2.55, mid);
      }
      if (cell % 3 === 0) streetLamp(side, mid, true);
    }
  }

  function construction(
    segment: WorldSegment,
    start: number,
    end: number,
    cell: number,
  ) {
    const length = end - start,
      mid = (start + end) / 2;
    for (const side of [-1, 1]) {
      box('soil', 23, 0.12, length, side * 17.8, -0.05, mid);
      box('white', 0.35, 0.9, length, side * 6.6, 0.45, mid);
      for (let z = start + 1; z < end - 0.3; z += 2.2) {
        box('orange', 0.37, 0.26, 0.95, side * 6.6, 0.6, z);
        box('lampWarm', 0.12, 0.12, 0.12, side * 6.6, 1, z);
      }
      const floorCount = 2 + ((cell + segment.variant) % 3),
        depth = Math.min(length - 0.5, 10);
      for (let floor = 0; floor < floorCount; floor++) {
        box('concrete', 9.5, 0.3, depth, side * 15, 0.2 + floor * 3, mid);
        for (const offset of [-3.5, 3.5])
          for (const z of [mid - depth * 0.38, mid + depth * 0.38])
            box(
              'concrete',
              0.4,
              2.8,
              0.4,
              side * 15 + offset,
              1.75 + floor * 3,
              z,
            );
      }
      if ((cell + segment.variant) % 4 === 0) {
        box('yellow', 0.8, 16, 0.8, side * 23, 8, mid);
        box('yellow', 15, 0.55, 0.8, side * 23, 15.2, mid);
        rod('dark', side * 23, 17, mid, side * 29, 15.4, mid, 0.04);
        rod('dark', side * 28, 15, mid, side * 28, 6, mid, 0.04);
      } else {
        put(
          'canopy',
          'soil',
          3.4,
          1.4,
          Math.min(3, length * 0.28),
          side * 24,
          0.6,
          mid,
        );
        box('brick', 2, 0.7, Math.min(2.8, length * 0.3), side * 9, 0.35, mid);
      }
    }
  }

  function open(
    segment: WorldSegment,
    start: number,
    end: number,
    cell: number,
  ) {
    const length = end - start,
      mid = (start + end) / 2;
    for (const side of [-1, 1]) {
      const v = variation(cell, segment.variant, side + 2);
      put(
        'canopy',
        segment.variant % 2 ? 'grass' : 'soil',
        18 + (v % 10),
        3 + (v % 5),
        length * 0.48,
        side * 37,
        1,
        mid,
      );
      tree(side * (9 + (v % 8)), mid, 5 + (v % 4), segment.variant % 2 === 0);
      if (!low)
        tree(
          side * (19 + (v % 6)),
          mid + Math.min(2, length * 0.12),
          4 + (v % 5),
          segment.variant % 2 === 0,
        );
      box('white', 0.13, 0.75, 0.13, side * 5.5, 0.375, mid);
      box('dark', 0.15, 0.15, 0.15, side * 5.5, 0.6, mid);
      for (const face of [-1, 1])
        box('white', 0.08, 0.055, 0.018, side * 5.5, 0.61, mid + face * 0.082);
      if (segment.variant > 1 && cell % 3 === 0) {
        put('round', 'trunk', 0.12, 7, 0.12, side * 8, 3.5, mid);
        box('dark', 1.5, 0.12, 0.1, side * 8, 6.65, mid);
      }
    }
  }

  function waterfront(
    segment: WorldSegment,
    start: number,
    end: number,
    cell: number,
  ) {
    const length = end - start,
      mid = (start + end) / 2;
    box('water', 120, 0.14, length, 67.3, -1.3, mid);
    box('concrete', 0.55, 1.55, length, 7.2, -0.62, mid);
    box('sidewalk', 2.5, 0.15, length, 6.1, 0.02, mid);
    rail(6.8, start, end);
    // Even a short clipped edge needs its continuous shore and water. Only the
    // buildings, street furniture and boats need enough room for a full detail.
    if (length < 3.5) return;
    const depth = Math.min(8.8, length - 0.5);
    const warehouseX = cell % 2 === 0 ? -14.2 : -12;
    box(
      `shed${segment.variant}` as Finish,
      7,
      4.5,
      depth,
      warehouseX,
      2.25,
      mid,
    );
    box('dark', 7.3, 0.23, depth, warehouseX, 4.65, mid);
    for (let z = start + 1; z < end; z += 4)
      box(
        'glass',
        0.035,
        1.35,
        1.8,
        warehouseX + 3.52,
        2.6,
        Math.min(end - 1, z),
      );
    if (cell % 2 === 0) {
      streetLamp(1, mid, true);
      box('trunk', 1.4, 0.14, 0.4, 5.9, 0.5, mid + 2);
      box('trunk', 1.4, 0.5, 0.09, 6.1, 0.73, mid + 2.2);
      tree(-7.3, mid, 5, false);
    }
    if ((cell + segment.variant) % 3 === 0) {
      box('trunk', 10, 0.3, Math.min(2.7, length * 0.3), 12, -0.5, mid);
      for (const x of [9, 15])
        put('round', 'trunk', 0.13, 2, 0.13, x, -1.1, mid);
      box('white', 2.4, 0.6, Math.min(6, length * 0.65), 21, -0.84, mid);
      box('dark', 1.65, 0.5, 2.5, 21, -0.38, mid);
      put('round', 'white', 0.045, 6, 0.045, 21, 2.35, mid);
    }
    if (!low)
      for (const offset of [19, 32, 53])
        box(
          'ripple',
          4 + (cell % 3),
          0.006,
          0.1,
          offset,
          -1.22,
          mid + (offset % 3) - 1,
        );
  }

  function tunnel(segment: WorldSegment, start: number, end: number) {
    const length = end - start,
      mid = (start + end) / 2,
      modern = segment.tunnel?.style === 'modern',
      finish = modern ? 'tunnelModern' : 'tunnelWeathered';
    // Mountain, roof and walls share the exact clipped interval. The mountain
    // has a genuine open mouth fitted around the existing portal exterior.
    put('mountain', 'soil', 1, 1, length, 0, 0, mid);
    put('arch', finish, 1, 1, length, 0, 0, mid);
    for (const side of [-1, 1]) {
      box(finish, 0.8, 4, length, side * 6.5, 2, mid);
      box('dark', 1.25, 0.23, length, side * 5.48, 0.025, mid);
      box(
        modern ? 'tunnelPanel' : 'tunnelStain',
        0.025,
        modern ? 2.4 : 0.8,
        length,
        side * 6.085,
        modern ? 1.65 : 0.75,
        mid,
      );
      box(
        modern ? 'tunnelBand' : 'yellow',
        0.034,
        modern ? 0.14 : 0.06,
        length,
        side * 6.063,
        modern ? 2.2 : 1.15,
        mid,
      );
      box('dark', 0.12, 0.1, length, side * 5.88, 3.6, mid);
    }
    const spacing = segment.tunnel?.lightSpacing ?? 10;
    for (
      let z =
        segment.start +
        Math.ceil((start - segment.start - spacing / 2) / spacing) * spacing +
        spacing / 2;
      z < end;
      z += spacing
    ) {
      if (z < start || z >= segment.end) continue;
      const lampLength = Math.min(
        modern ? 2.4 : 0.55,
        (z - segment.start) * 2,
        (segment.end - z) * 2,
      );
      for (const side of [-1, 1]) {
        box(
          'dark',
          modern ? 0.26 : 0.52,
          0.11,
          lampLength + 0.06,
          side * 4.6,
          6.24,
          z,
        );
        box(
          modern ? 'lampCool' : 'lampWarm',
          modern ? 0.15 : 0.4,
          0.055,
          lampLength,
          side * 4.6,
          6.17,
          z,
        );
        box('lampCool', 0.045, 0.12, 0.2, side * 5.95, 0.52, z);
      }
      if (!modern) put('arch', 'dark', 0.997, 0.997, 0.13, 0, 0, z);
    }
    for (
      let z =
        segment.start + 24 + Math.ceil((start - segment.start - 24) / 48) * 48;
      z < end;
      z += 48
    ) {
      if (z < start || z < segment.start || z >= segment.end) continue;
      box('signGreen', 0.08, 0.5, 1, 6.02, 2.7, z);
      box('lampCool', 0.085, 0.06, 0.6, 5.97, 2.7, z);
      box('red', 0.25, 0.7, 0.42, -5.96, 1.1, z);
    }
    if (!low && !modern)
      for (const side of [-1, 1]) {
        box(
          'tunnelStain',
          0.033,
          1.8,
          Math.min(1.1, length),
          side * 6.075,
          2.9,
          mid,
        );
        box(
          'tunnelStain',
          0.033,
          0.3,
          Math.min(4.1, length),
          side * 6.075,
          3.7,
          mid,
        );
      }
  }

  function bridge(segment: WorldSegment, start: number, end: number) {
    const length = end - start,
      mid = (start + end) / 2;
    box('water', 240, 0.16, length, 0, -3.3, mid);
    // A real deck slab, edge girders and cross beams, not asphalt floating on water.
    box('bridgeDeck', 12.4, 1.05, length, 0, -0.715, mid);
    sidewalk(start, end);
    for (const side of [-1, 1]) {
      box('steel', 0.32, 1.2, length, side * 5.95, -0.7, mid);
      rail(side * 6.04, start, end, 1.32);
    }
    for (
      let z = segment.start + Math.ceil((start - segment.start) / 12) * 12;
      z < end;
      z += 12
    ) {
      if (z < start) continue;
      box('steel', 11.8, 0.38, 0.28, 0, -1.13, z);
      for (const side of [-1, 1]) {
        put('round', 'concrete', 0.55, 7.2, 0.55, side * 4.5, -4.8, z);
        box('steel', 0.055, 0.65, 0.06, side * 6.05, 0.75, z + 1.5);
      }
    }
    if (!low)
      for (const side of [-1, 1])
        box('ripple', 13, 0.01, 0.1, side * 22, -3.21, mid + 2);
  }

  function transition(segment: WorldSegment, start: number, end: number) {
    const length = end - start,
      mid = (start + end) / 2,
      progress = (mid - segment.start) / (segment.end - segment.start),
      approach = segment.kind.endsWith('approach'),
      near = approach ? progress : 1 - progress;
    sidewalk(start, end);
    if (segment.kind.startsWith('tunnel')) {
      const total = segment.end - segment.start;
      const progressStart = (start - segment.start) / total;
      const progressEnd = (end - segment.start) / total;
      const nearStart = approach ? progressStart : 1 - progressStart;
      const nearEnd = approach ? progressEnd : 1 - progressEnd;
      const berm = batches.get('berm:soil')!;
      for (const side of [-1, 1] as const) {
        box(
          'concrete',
          0.6,
          1.5 + near * 3,
          length,
          side * 6.9,
          (1.5 + near * 3) / 2,
          mid,
        );
        if (berm.used === WORLD_VIEW.instancesPerBatch)
          throw new RangeError('World instance pool exhausted: berm:soil');
        writeTunnelBermMatrix(
          matrix,
          side,
          start,
          end,
          nearStart,
          nearEnd,
          anchor,
        );
        berm.mesh.setMatrixAt(berm.used++, matrix);
        reserve(geometries.berm);
        box('dark', 0.16, 0.3, Math.min(0.2, length), side * 6.56, 0.9, mid);
        box('white', 0.025, 0.1, Math.min(0.1, length), side * 6.472, 0.9, mid);
      }
    } else {
      const bank = 9 + (1 - near) * 24;
      box('grass', bank * 2, 0.2, length, 0, -0.21, mid);
      box('soil', bank * 2, 3, length, 0, -1.8, mid);
      for (const side of [-1, 1]) {
        rail(side * 6.04, start, end, 1.32);
        box(
          'water',
          110 - bank,
          0.15,
          length,
          (side * (bank + 110)) / 2,
          -3.3,
          mid,
        );
        box('concrete', 0.55, 1.9 + near * 1.1, length, side * 6.6, -0.9, mid);
      }
    }
  }

  function span(
    segment: WorldSegment,
    start: number,
    end: number,
    cell: number,
  ) {
    const length = end - start,
      mid = (start + end) / 2;
    road(start, end);
    if (segment.kind === 'tunnel') {
      tunnel(segment, start, end);
      return;
    }
    if (segment.kind === 'bridge') {
      bridge(segment, start, end);
      return;
    }
    if (segment.kind === 'waterfront') {
      box('grass', 126, 0.2, length, -56.9, -0.21, mid);
    } else if (!segment.kind.startsWith('bridge-'))
      box(
        segment.kind === 'construction' || segment.kind === 'industrial'
          ? 'soil'
          : 'grass',
        240,
        0.2,
        length,
        0,
        -0.21,
        mid,
      );
    if (segment.kind.includes('-')) {
      transition(segment, start, end);
      return;
    }
    sidewalk(start, end, segment.kind !== 'open');
    if (segment.kind === 'waterfront') {
      waterfront(segment, start, end, cell);
      return;
    }
    if (length < 3.5) return;
    if (segment.kind === 'city') city(segment, start, end, cell);
    else if (segment.kind === 'industrial')
      industrial(segment, start, end, cell);
    else if (segment.kind === 'construction')
      construction(segment, start, end, cell);
    else if (segment.kind === 'open') open(segment, start, end, cell);
  }

  function landmarks(segment: WorldSegment, start: number, end: number) {
    if (segment.kind === 'tunnel') {
      for (const boundary of [segment.start, segment.end]) {
        if (boundary < start || boundary >= end) continue;
        // The whole portal thickness belongs to the interior. Daylight therefore
        // switches at the same exact boundary as the visible tunnel mouth.
        const z = boundary + (boundary === segment.start ? 0.6 : -0.6);
        put('arch', 'concrete', 1.025, 1.025, 1.2, 0, 0, z);
        for (const side of [-1, 1]) {
          box('concrete', 1.25, 4.3, 1.2, side * 6.58, 2.15, z);
          for (let stripe = 0; stripe < 5; stripe++)
            box(
              stripe % 2 ? 'dark' : 'yellow',
              0.24,
              0.35,
              1.23,
              side * 6,
              0.3 + stripe * 0.4,
              z,
            );
        }
        box(
          'dark',
          2.7,
          0.55,
          0.08,
          0,
          7.94,
          boundary === segment.start ? boundary - 0.05 : boundary + 0.05,
        );
        for (const side of [-1, 0, 1])
          box(
            'lampCool',
            0.15,
            0.12,
            0.085,
            side * 0.65,
            7.94,
            boundary === segment.start ? boundary - 0.1 : boundary + 0.1,
          );
      }
    }
    if (segment.kind === 'bridge' && segment.variant % 2 === 1)
      for (
        let z =
          segment.start +
          38 +
          Math.ceil((start - segment.start - 38 - 32) / 76) * 76;
        z < end + 32;
        z += 76
      ) {
        if (z < segment.start + 38 || z + 34 >= segment.end) continue;
        for (const side of [-1, 1]) {
          box('concrete', 0.65, 12.4, 1.25, side * 6.3, 5.5, z);
          rod('steel', side * 6.3, 11.6, z, side * 6.3, 1.3, z - 32, 0.06);
          rod('steel', side * 6.3, 11.6, z, side * 6.3, 1.3, z + 32, 0.06);
          if (!low) {
            rod('steel', side * 6.3, 11.6, z, side * 6.3, 1.3, z - 18, 0.035);
            rod('steel', side * 6.3, 11.6, z, side * 6.3, 1.3, z + 18, 0.035);
          }
        }
        box('concrete', 13.25, 0.45, 1.25, 0, 11.48, z);
      }
  }

  let previousWorld: World | undefined,
    previousCell = Number.NaN;
  function update(world: World, distance: number) {
    if (!Number.isFinite(distance) || distance < 0) return;
    const cell = Math.floor(distance / WORLD_VIEW.cellLength);
    if (world !== previousWorld || cell !== previousCell) {
      previousWorld = world;
      previousCell = cell;
      anchor = cell * WORLD_VIEW.cellLength;
      surfaceOrigin.value = anchor;
      const start = anchor - WORLD_VIEW.lookBehind,
        end = start + WORLD_VIEW.cellCount * WORLD_VIEW.cellLength;
      for (const batch of batches.values()) batch.used = 0;
      clearanceCount = 0;
      treeCount = 0;
      for (let i = 0; i < WORLD_VIEW.cellCount; i++) {
        const a = start + i * WORLD_VIEW.cellLength,
          b = a + WORLD_VIEW.cellLength;
        // The starting grid extends behind distance zero so the chase camera
        // already has a complete road beneath it before the first metre.
        if (a < 0) {
          const initial = world.at(0);
          if (initial) span(initial, a, Math.min(0, b), cell + i - 4);
        }
        for (const segment of world.segments) {
          const clippedStart = Math.max(0, a, segment.start),
            clippedEnd = Math.min(b, segment.end);
          if (clippedEnd > clippedStart)
            span(segment, clippedStart, clippedEnd, cell + i - 4);
        }
      }
      for (const segment of world.segments) landmarks(segment, start, end);
      plantClearTrees();
      for (const batch of batches.values()) {
        batch.mesh.count = batch.used;
        batch.mesh.visible = batch.used > 0;
        batch.mesh.instanceMatrix.needsUpdate = true;
      }
      root.userData.windowStart = start;
      root.userData.windowEnd = end;
    }
    root.position.z = distance - anchor;
  }
  return { root, update };
}
