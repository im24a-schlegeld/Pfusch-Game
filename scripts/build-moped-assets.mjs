/** Offline: node scripts/build-moped-assets.mjs ciao <PiaggioCiao.fbx>
 *          node scripts/build-moped-assets.mjs moped <moped.3ds>
 * No source scripts are executed. All original bitmap lettering is omitted.
 */
import { buildMotorcycleAsset } from './build-motorcycle-asset.mjs';
import { loadPortableMotorcycleSource, roundSourceAirbox, THREE } from './portable-motorcycle-source.mjs';

const id = process.argv[2], filename = process.argv[3];
if (!['ciao', 'moped'].includes(id) || !filename) throw new Error('Pass ciao <FBX> or moped <3DS>.');
const isCiao = id === 'ciao';
let sourcePositions;
const material = (name, color, metalness, roughness) => ({ name: `${id}_${name}`, color, metalness, roughness });
const materials = {
  livery: material('livery', '#e5e5e5', .08, .44),
  tyre: material('tyre', '#171717', 0, .95),
  rim: material('rim', '#bababa', .78, .31),
  spokes: material('spokes', '#c6cbd0', .85, .26),
  chrome: material('chrome', '#c9cdd0', .88, .23),
  mechanics: material('mechanics', isCiao ? '#999999' : '#aeb3b8', isCiao ? .64 : .72, isCiao ? .43 : .34),
  dark: material('dark', '#303030', .08, .73),
  gaiters: material('gaiters', '#181a1c', 0, .88),
  seat: material('seat', '#222222', 0, .88),
  light: material('light', isCiao ? '#ededed' : '#edf3ec', isCiao ? .20 : .10, isCiao ? .24 : .19),
  indicator: material('indicator', '#e68a16', .08, .24),
  tail_light: material('tail_light', '#701d1d', .10, .38),
};
const ciaoFrontWheel = new Set(['wheels_front_and_back003', 'Circle013', 'Circle014', 'Circle015', 'Circle016', 'Circle017', 'Circle025']);
const ciaoRearWheel = new Set(['wheels_front_and_back004', 'Circle018', 'Circle019', 'Circle020', 'Circle021', 'Circle022']);
const ciaoSteering = new Set(['Cylinder014', 'Cylinder013', 'Cylinder015', 'Cylinder017', 'Cylinder018', 'Cylinder019', 'cable008', 'cable009', 'cable010', 'Cylinder023']);
const ciaoFork = new Set(['Circle023', 'Cube012', 'Bolts008', 'Bolts012']);
const mopedFrontWheel = new Set(['Donut1', 'felnapr', 'zicenp', 'dobos', 'sraftock', 'Duplica2']);
const mopedRearWheel = new Set(['gumanaza', 'felnanaz', 'zicenz', 'Duplica1', 'sraftoc0', 'ventZad']);
const mopedSteering = new Set(['far', 'Cylinde0', 'Regroup1', 'levaRuck', 'Duplica0', 'Cylinde1', 'Box01', 'migavcin', 'nosacVol', 'volan', 'rucke', 'nosacFar', 'sajlaPrK', 'sajlakv']);
const mopedFork = new Set(['Regroup0', 'Duplicat', 'nosbbran', 'nosbrani', 'prbranik', 'polugaKo']);
const mopedSwingarm = new Set(['7', '8', '9', 'oslonac', 'stitnikL', 'Duplica3', 'Regroup6']);

function reshapeSourceMesh(source, name, scale, pivot) {
  const mesh = source.meshes.find(item => item.name === name);
  if (!mesh) throw new Error('Restyle source missing: ' + name);
  mesh.geometry.translate(-pivot[0], -pivot[1], -pivot[2])
    .scale(scale[0], scale[1], scale[2]).translate(...pivot);
}

/** Modest changes to supplied shells; wheel/seat/handlebar geometry is untouched. */
function restyle(source) {
  if (isCiao) {
    reshapeSourceMesh(source, 'Cylinder012', [1.18, 1, .985], [0, 95, 265]);
    reshapeSourceMesh(source, 'Cube010', [1.10, .96, 1], [0, 80, 240]);
    reshapeSourceMesh(source, 'Rear_Fender001', [1.12, 1, 1], [0, 88, 217]);
    reshapeSourceMesh(source, 'Circle023', [1.14, 1, .94], [0, 94, 288]);
    reshapeSourceMesh(source, 'Cube013', [1.15, 1, .94], [0, 100, 216]);
    for (const name of ['Cylinder017', 'Cylinder019'])
      reshapeSourceMesh(source, name, [1.20, .80, 1], [0, 117.5, 272.2]);
  } else {
    reshapeSourceMesh(source, 'rezervoa', [.91, 1.12, 1], [-9.6, 0, 41.3]);
    reshapeSourceMesh(source, 'Regroup2', [.95, 1.12, 1], [20, 0, 30.8]);
    reshapeSourceMesh(source, 'kutija', [1.05, 1.10, 1], [2.74, -1.05, 29.93]);
    reshapeSourceMesh(source, 'prbranik', [.96, 1.14, 1], [-41.55, 0, 25]);
    reshapeSourceMesh(source, 'zbranik', [1, 1.18, 1], [28.2, 0, 29]);
    reshapeSourceMesh(source, 'far', [1, 1.25, .80], [-30.4, 0, 49.3]);
  }
}

function rigFor(mesh, vertex) {
  const n = mesh.name;
  if (!isCiao && ['zamortiz', 'zamorti0'].includes(n))
    return sourcePositions.get(n)[vertex * 3 + 2] >= 28.5 ? 'shockUpper' : 'shockLower';
  if (!isCiao && ['Regroup0', 'Duplicat'].includes(n))
    return sourcePositions.get(n)[vertex * 3 + 2] >= 34 ? 'steering' : 'fork';
  if ((isCiao ? ciaoFrontWheel : mopedFrontWheel).has(n)) return 'frontWheel';
  if ((isCiao ? ciaoRearWheel : mopedRearWheel).has(n)) return 'rearWheel';
  if ((isCiao ? ciaoSteering : mopedSteering).has(n)) return 'steering';
  if ((isCiao ? ciaoFork : mopedFork).has(n)) return 'fork';
  if (!isCiao && mopedSwingarm.has(n)) return 'swingarm';
  return 'body';
}
function materialFor(mesh, vertex) {
  const n = mesh.name;
  if (isCiao) {
    if (n.startsWith('wheels_front_and_back')) return materials.tyre;
    if (n === 'Cube007') return materials.seat;
    if (n === 'Cylinder019') return materials.light;
    if (ciaoFrontWheel.has(n) || ciaoRearWheel.has(n)) return materials.rim;
    if (mesh.userData.sourceMaterial === 'Red') return materials.livery;
    if (mesh.userData.sourceMaterial === 'RubberBlack') return materials.dark;
    return materials.mechanics;
  }
  if (['Donut1', 'gumanaza'].includes(n)) return materials.tyre;
  if (['felnapr', 'felnanaz'].includes(n)) return materials.rim;
  // Wire spokes retain their silver finish independently of the configurable rim hoops.
  if (['zicenp', 'zicenz'].includes(n)) return materials.spokes;
  if (['SEDEZ', 'torbe', 'kais'].includes(n)) return materials.seat;
  const positions = sourcePositions.get(n);
  const center = axis => (positions[vertex * 3 + axis] + positions[(vertex + 1) * 3 + axis] + positions[(vertex + 2) * 3 + axis]) / 3;
  // The supplied lamp is one mesh: its shallow front dome ends at X=-30.48,
  // while the outer bezel and deep housing remain polished metal.
  if (n === 'far') return center(0) < -30.47 ? materials.light : materials.chrome;
  if (n === 'migavcin' || n === 'migavciN') {
    const front = n === 'migavcin';
    if (front ? center(0) < -28.68 : center(0) > 48.86) return materials.indicator;
    return Math.abs(center(1)) < (front ? 8.0 : 6.0) ? materials.chrome : materials.dark;
  }
  if (n === 'zfar') return materials.tail_light;
  if (['Regroup0', 'Duplicat'].includes(n)) {
    // Classify along the supplied 30-degree fork axis so the material boundary
    // follows the real rib rings, rather than cutting diagonally across them.
    const alongFork = .5 * center(0) + Math.sqrt(.75) * center(2);
    return alongFork > 12.09 && alongFork < 25.15 ? materials.gaiters : materials.chrome;
  }
  if (['zamortiz', 'zamorti0', 'auspuh', 'volan', 'nosacVol', 'cep'].includes(n)) return materials.chrome;
  if (['kutija', 'zbranik', 'rezervoa', 'prbranik', 'Regroup2', '5'].includes(n)) return materials.livery;
  if (['crevo', 'sajlaPrK', 'sajlakv', 'kabl', 'rucke', 'levaRuck', 'Duplica0', 'drzacNog', 'drzNoguZ', 'sirena'].includes(n)) return materials.dark;
  return materials.mechanics;
}

await buildMotorcycleAsset({
  id, name: isCiao ? 'City Moped' : 'Classic Moped', source: filename, loadSource: loadPortableMotorcycleSource,
  includeMesh: mesh => isCiao ? !['Text001', 'Curve001', 'Plane004', 'Plane003'].includes(mesh.name) : !['torbe', 'nosacTor', 'ogledala'].includes(mesh.name),
  analyze(source) {
    const { meshBox } = source;
    sourcePositions = source.worldPositions;
    restyle(source);
    if (!isCiao) roundSourceAirbox(source, 'kutija', .85);
    if (isCiao) {
      const stand = source.meshes.find(mesh => mesh.name === 'cable012');
      const box = meshBox('cable012'), pivotZ = (box.min.z + box.max.z) / 2;
      // The supplied parked centerstand hangs to the road. Fold its original
      // U-shaped mesh rearwards about its real upper hinge for the riding asset.
      stand.geometry.translate(0, -box.max.y, -pivotZ).rotateX(1.30).translate(0, box.max.y, pivotZ);
    }
    const frontBox = meshBox(isCiao ? 'wheels_front_and_back003' : 'Donut1');
    const rearBox = meshBox(isCiao ? 'wheels_front_and_back004' : 'gumanaza');
    const toCanonical = isCiao ? ([x, y, z]) => [-x, y, -z] : ([x, y, z]) => [y, z, x];
    const front = toCanonical(frontBox.getCenter(new THREE.Vector3()).toArray());
    const rear = toCanonical(rearBox.getCenter(new THREE.Vector3()).toArray());
    const radiusAxis = isCiao ? 'y' : 'z';
    const frontRadiusSource = (frontBox.max[radiusAxis] - frontBox.min[radiusAxis]) / 2;
    const rearRadiusSource = (rearBox.max[radiusAxis] - rearBox.min[radiusAxis]) / 2;
    const dy = front[1] - rear[1], dz = rear[2] - front[2];
    const pitch = Math.atan2(dy, dz) - Math.asin((frontRadiusSource - rearRadiusSource) / Math.hypot(dy, dz));
    const c = Math.cos(pitch), s = Math.sin(pitch), wheelbase = isCiao ? 1.04 : 1.10;
    const scale = wheelbase / (dz * c + dy * s);
    const rotate = ([x, y, z]) => [x * scale, (y * c + z * s) * scale, (z * c - y * s) * scale];
    const frontRot = rotate(front), rearRot = rotate(rear);
    const midpoint = (frontRot[2] + rearRot[2]) / 2;
    const ground = frontRot[1] - frontRadiusSource * scale;
    const normalize = point => { const p = rotate(toCanonical(point)); return [p[0], p[1] - ground, p[2] - midpoint]; };
    const round = point => normalize(point).map(value => +value.toFixed(7));
    const frontAxle = round(frontBox.getCenter(new THREE.Vector3()).toArray());
    const rearAxle = round(rearBox.getCenter(new THREE.Vector3()).toArray());
    const sourceAnchors = isCiao ? {
      pivot: [0, 78, 242], shockTop: [-4, 98, 228], shockBottom: [-4, 78, 218],
      steeringPivot: [0, 112, 268], forkTop: [0, 105, 272],
      grip: [-19.2, 122.3, 262.8], peg: [-12.8, 75.3, 240.0],
      hip: [0, 115.2, 231.0], exhaust: [-6.8, 73.8, 230], tail: [0, 92, 203], headlight: [0, 117.5, 272.2],
    } : {
      pivot: [2, 0, 17], shockTop: [19.0, -3.7, 36.6], shockBottom: [22.2, -3.7, 20.2],
      steeringPivot: [-21.2, 0, 53.4], forkTop: [-26.0, 0, 47],
      grip: [-21.2, 16.6, 57.5], peg: [-3.5, 13.0, 13.2],
      hip: [8.0, 0, 48.2], exhaust: [43.5, 4.5, 11.8], tail: [49.0, 0, 27.5], headlight: [-30.4, 0, 49.3],
    };
    const anchors = Object.fromEntries(Object.entries(sourceAnchors).map(([key, value]) => [key, round(value)]));
    const steeringAxis = new THREE.Vector3().fromArray(anchors.steeringPivot).sub(new THREE.Vector3().fromArray(frontAxle)).normalize().toArray();
    return { normalize, anchors: { ...anchors, frontAxle, rearAxle, frontRadius: frontRadiusSource * scale, rearRadius: rearRadiusSource * scale,
      steeringAxis, forkBottom: frontAxle }, sourceTransform: { axisMap: isCiao ? '-X,+Y,-Z' : '+Y,+Z,+X', sourcePitch: pitch,
      scale, translateY: -ground, sourceAxleMidpointZ: midpoint, canonicalWheelbase: wheelbase } };
  },
  rigFor, materialFor,
  materialBudgets: isCiao ? {
    ciao_livery: 4000, ciao_tyre: 6000, ciao_rim: 2800, ciao_dark: 2600, ciao_seat: 900, ciao_mechanics: 4200, ciao_light: 204,
  } : { moped_livery: 1100, moped_tyre: 960, moped_rim: 640, moped_spokes: 432, moped_chrome: 1500,
    moped_gaiters: 700, moped_dark: 900, moped_seat: 160, moped_mechanics: 2500, moped_light: 144, moped_indicator: 192, moped_tail_light: 48 },
  simplification: bucket => ({ error: bucket.material.endsWith('_tyre') ? .035 : .015, weights: [.03, .03, .03, 0, 0], flags: ['Permissive'] }),
});
