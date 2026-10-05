/** Offline FS 450 conversion: node scripts/build-fs450-asset.mjs <source.usdz> */
import { buildMotorcycleAsset } from './build-motorcycle-asset.mjs';
import { connectedComponents } from './motorcycle-components.mjs';

let liveryComponents;
let sourcePositions;
let originalFront;
let originalRear;
const paint = { name: 'fs450_bodywork_paint', color: '#e7e7df', metalness: .08, roughness: .36, paintable: true };
const seat = { name: 'fs450_seat_rubber', color: '#1d2024', metalness: 0, roughness: .92 };
const trim = { name: 'fs450_inner_trim', color: '#25292c', metalness: .08, roughness: .7 };
const friction = { name: 'fs450_brake_friction_steel', color: '#a4adb4', metalness: .85, roughness: .36 };
const carrier = { name: 'fs450_brake_dark_carrier', color: '#293139', metalness: .65, roughness: .45 };

await buildMotorcycleAsset({
  source: process.argv[2], id: 'fs450', name: '2022 Husqvarna FS 450',
  analyze({ meshes, meshBox, worldPositions, THREE }) {
sourcePositions = worldPositions;
liveryComponents = connectedComponents(meshes.find(mesh => mesh.name === 'Object_12'), worldPositions.get('Object_12'), THREE);
const rearBox = meshBox('Object_3'), frontBox = meshBox('Object_2');
const rearCenter = rearBox.getCenter(new THREE.Vector3());
const frontCenter = frontBox.getCenter(new THREE.Vector3());
originalFront = frontCenter;
originalRear = rearCenter;
const frontRadius = (frontBox.max.y - frontBox.min.y) / 2;
const rearRadius = (rearBox.max.y - rearBox.min.y) / 2;
const dy = frontCenter.y - rearCenter.y, dz = frontCenter.z - rearCenter.z;
const pitch = Math.atan2(dy, dz) - Math.asin((frontRadius - rearRadius) / Math.hypot(dy, dz));
const c = Math.cos(pitch), s = Math.sin(pitch);
const rotate = ([x, y, z]) => [-x, y * c - z * s, -y * s - z * c];
const rearRot = rotate(rearCenter.toArray()), frontRot = rotate(frontCenter.toArray());
const centerZ = (rearRot[2] + frontRot[2]) / 2;
const groundY = frontRot[1] - frontRadius;
const normalize = point => { const p = rotate(point); return [p[0], p[1] - groundY, p[2] - centerZ]; };
const rounded = array => array.map(value => +value.toFixed(7));

const chassis = meshes.find(mesh => mesh.name === 'Object_8');
const boneSource = name => chassis.skeleton.bones.find(bone => bone.name === name).getWorldPosition(new THREE.Vector3()).toArray();
const bone = name => rounded(normalize(boneSource(name)));
const frontAxle = rounded(normalize(frontCenter.toArray()));
const rearAxle = rounded(normalize(rearCenter.toArray()));

const bodyBox = meshBox('Object_12');
const anchors = {
  frontAxle, rearAxle,
  frontRadius, rearRadius,
  pivot: bone('n84'), shockTop: bone('n91'), shockBottom: bone('n92'),
  steeringPivot: bone('n95'), steeringAxis: [0, .91, .414],
  forkTop: bone('n95'), forkBottom: frontAxle,
  grip: rounded(normalize(boneSource('n97'))),
  peg: rounded(normalize([-.215, .289, -.196])),
  hip: rounded(normalize([0, .884, -.18])),
  exhaust: rounded(normalize([-.133, .785, -.694])),
  tail: rounded(normalize([0, .916, bodyBox.min.z])),
};

return { normalize, anchors, sourceTransform: { rotateY: Math.PI, sourcePitch: pitch, translateY: -groundY, sourceAxleMidpointZ: centerZ } };
  },
rigFor(mesh, vertex) {
  const id = Number(mesh.name.split('_')[1]);
  if ([0, 2, 4].includes(id)) return 'frontWheel';
  if ([1, 3, 5, 10].includes(id)) return 'rearWheel';
  if ([6, 7].includes(id)) return 'body';
  const indices = mesh.geometry.attributes.skinIndex;
  const weights = mesh.geometry.attributes.skinWeight;
  let max = -1, chosen = 0;
  for (let k = 0; k < 4; k++) {
    const weight = weights.array[vertex * 4 + k];
    if (weight > max) { max = weight; chosen = indices.array[vertex * 4 + k]; }
  }
  const name = mesh.skeleton.bones[chosen].name;
  if (name === 'n84') return 'swingarm';
  if (name === 'n85') return 'rearWheel';
  if (name === 'n91') return 'shockUpper';
  if (name === 'n92' || name === 'n93') return 'shockLower';
  if (name === 'n100') return 'fork';
  if (['n95', 'n96', 'n97', 'n98', 'n99'].includes(name)) return 'steering';
  return 'body';
},
materialFor(mesh, vertex) {
  if (mesh.name === 'Object_12') {
    const component = liveryComponents.byVertex[vertex];
    // These are separate authored shells, not arbitrary triangle colour masks.
    // The long narrow saddle remains rubber; the airbox/backplate remain trim.
    if (component.index === 12) return seat;
    if (component.index === 7 || component.index === 9) return trim;
    return paint;
  }
  if (mesh.name === 'Object_0' || mesh.name === 'Object_1') {
    const values = sourcePositions.get(mesh.name);
    const center = mesh.name === 'Object_0' ? originalFront : originalRear;
    let radius = 0;
    for (let i = 0; i < 3; i++) {
      const offset = (vertex + i) * 3;
      radius += Math.hypot(values[offset + 1] - center.y, values[offset + 2] - center.z) / 3;
    }
    return radius > (mesh.name === 'Object_0' ? .109 : .073) ? friction : carrier;
  }
  return undefined;
},
simplification(bucket) {
  if (bucket.material.includes('mechanics')) return { error: .015, weights: [.25, .25, .25, .8, .8] };
  return undefined;
},
materialBudgets: {
  fs450_bodywork_paint: 10000,
  fs450_seat_rubber: 600,
  fs450_inner_trim: 1100,
  mat_cockpit277_001_COLOR_0: 3200,
  mat_mechanics277_001_COLOR_0: 14500,
  mat_exmanifold277: 1200,
  mat_muffler277: 900,
  mat_rim277_001: 5300,
  mat_fronttyre001_COLOR_0: 1800,
  mat_backtyre001_COLOR_0_001: 1800,
}
});
