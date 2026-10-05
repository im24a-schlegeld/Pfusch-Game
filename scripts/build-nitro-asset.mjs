/** Offline MBK Nitro conversion: node scripts/build-nitro-asset.mjs <source.usdz> */
import { buildMotorcycleAsset } from './build-motorcycle-asset.mjs';
import { connectedComponents } from './motorcycle-components.mjs';

const pieces = new Map();
let sourcePositions, sourceFront, sourceRear;
const materials = {
  livery: { name: 'nitro_livery', color: '#e7e7df', metalness: .04, roughness: .48 },
  tyre: { name: 'nitro_tyre', color: '#17191a', metalness: 0, roughness: .88 },
  rim: { name: 'nitro_rim', color: '#a6acb0', metalness: .72, roughness: .36 },
  dark: { name: 'nitro_dark', color: '#25282b', metalness: .1, roughness: .72 },
  seat: { name: 'nitro_seat', color: '#202123', metalness: 0, roughness: .92 },
  metal: { name: 'nitro_mechanics', color: '#9b9fa2', metalness: .65, roughness: .4 },
  brakeSteel: { name: 'nitro_brake_steel', color: '#a4aaaf', metalness: .88, roughness: .3 },
  brakeCarrier: { name: 'nitro_brake_carrier', color: '#30363b', metalness: .72, roughness: .43 },
  lamp: { name: 'nitro_light', color: '#e8edf0', metalness: .2, roughness: .22 },
  tailLamp: { name: 'nitro_tail_light', color: '#991c16', metalness: .05, roughness: .3 },
};

function classify(id, part) {
  const i = part.index, c = part.center;
  let rig = 'body', material = 'metal';
  if (id === 38 && i < 2) return { rig: i === 0 ? 'frontWheel' : 'rearWheel', material: 'tyre' };
  if ((id === 32 && i < 2) || (id === 33 && [0, 1, 4, 5, 6, 7, 8, 9, 10].includes(i)))
    return { rig: c.z > 0 ? 'frontWheel' : 'rearWheel', material: 'rim' };
  if (id === 34 && i < 2) return { rig: i === 0 ? 'frontWheel' : 'rearWheel', material: 'metal' };
  if (id === 38 && i === 15) return { rig: 'rearWheel', material: 'metal' };
  if (id === 1 || (id === 33 && [2, 3].includes(i))) return { rig: 'body', material: 'seat' };
  if ([0, 2, 7, 8, 37].includes(id)) return { rig: id === 37 && i === 3 ? 'fork' : 'body', material: 'livery' };
  if (id === 24 || id === 17 || (id === 33 && i === 11)) return { rig: 'body', material: 'tailLamp' };
  if (id === 21 && i < 2) return { rig: 'body', material: 'lamp' };
  if (id === 27 && i === 0) return { rig: 'body', material: 'dark' }; // inner legshield + footboard
  if (id === 27 && [52, 53].includes(i)) return { rig: 'steering', material: 'dark' };
  if ((id === 27 && (i === 1 || (i >= 11 && i <= 51) || i === 64))
    || (id === 15 && i === 1) || (id === 34 && i === 22) || (id === 32 && i === 3))
    return { rig: 'shockUpper', material: 'metal' };
  if (id === 15) return { rig: 'shockLower', material: 'metal' };
  if (id === 28) return { rig: i < 2 ? 'steering' : 'fork', material: 'metal' };
  if (c.y > .40 && c.z > .10) rig = 'steering';
  else if (c.z > .32 && c.y < .16) rig = 'fork';
  else if (c.z < -.28 && c.y < .09) rig = 'swingarm';
  if ([13, 20, 26, 30, 31, 38, 39].includes(id)) material = 'dark';
  if (id === 29 && [6, 7, 20, 21].includes(i)) material = 'dark';
  return { rig, material };
}

await buildMotorcycleAsset({
  source: process.argv[2], id: 'nitro', name: 'MBK Nitro BCD',
  analyze({ meshes, worldPositions, THREE }) {
    sourcePositions = worldPositions;
    for (const mesh of meshes) {
      const components = connectedComponents(mesh, worldPositions.get(mesh.name), THREE);
      for (const part of components.components) Object.assign(part, classify(Number(mesh.name.split('_')[1]), part));
      pieces.set(mesh.name, components);
    }
    const tyre = pieces.get('Object_38').components;
    const front = tyre[0].center, rear = tyre[1].center;
    sourceFront = front; sourceRear = rear;
    const frontRadiusSource = (tyre[0].box.max.y - tyre[0].box.min.y) / 2;
    const rearRadiusSource = (tyre[1].box.max.y - tyre[1].box.min.y) / 2;
    const dz = front.z - rear.z, dy = front.y - rear.y;
    const pitch = Math.asin((frontRadiusSource - rearRadiusSource) / Math.hypot(dz, dy)) - Math.atan2(dy, dz);
    const c = Math.cos(pitch), s = Math.sin(pitch), scale = .86;
    const rotate = ([x, y, z]) => [-x * scale, (z * s + y * c) * scale, (-z * c + y * s) * scale];
    const rearRot = rotate(rear.toArray()), frontRot = rotate(front.toArray());
    const centerZ = (rearRot[2] + frontRot[2]) / 2;
    const ground = frontRot[1] - frontRadiusSource * scale;
    const normalize = point => { const p = rotate(point); return [p[0], p[1] - ground, p[2] - centerZ]; };
    const round = p => normalize(p).map(v => +v.toFixed(7));
    const frontAxle = round(front.toArray());
    const axis = rotate([0, .90, -.43]).map(v => v / scale);
    return { normalize, sourceTransform: { rotateY: Math.PI, sourcePitch: pitch, scale, translateY: -ground, sourceAxleMidpointZ: centerZ }, anchors: {
      frontAxle, rearAxle: round(rear.toArray()), frontRadius: frontRadiusSource * scale, rearRadius: rearRadiusSource * scale,
      pivot: round([0, -.218, -.302]), shockTop: round([.128, .200, -.590]), shockBottom: round([.127, -.095, -.794]),
      steeringPivot: round([0, .438, .268]), steeringAxis: axis, forkTop: round([0, .300, .43]), forkBottom: frontAxle,
      grip: round([-.253, .603, .143]), peg: round([-.180, -.18, .045]),
      hip: round([0, .353222483, -.16]), exhaust: round([-.220, -.06, -.958]), tail: round([0, .482, -.970]),
    } };
  },
  rigFor: (mesh, vertex) => pieces.get(mesh.name).byVertex[vertex].rig,
  materialFor(mesh, vertex) {
    const part = pieces.get(mesh.name).byVertex[vertex];
    if (mesh.name === 'Object_34' && part.index < 2) {
      const p = sourcePositions.get(mesh.name), axle = part.index === 0 ? sourceFront : sourceRear;
      let distance = 0;
      for (let k = 0; k < 3; k++) distance += Math.hypot(p[(vertex + k) * 3 + 1] - axle.y, p[(vertex + k) * 3 + 2] - axle.z) / 3;
      return distance > .083 ? materials.brakeSteel : materials.brakeCarrier;
    }
    return materials[part.material];
  },
  materialBudgets: {
    nitro_livery: 5000, nitro_tyre: 800, nitro_rim: 3000,
    nitro_dark: 2900, nitro_seat: 1100, nitro_mechanics: 6500,
    nitro_light: 250, nitro_tail_light: 350,
  },
});
