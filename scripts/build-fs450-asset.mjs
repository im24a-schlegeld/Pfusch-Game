/** Offline FS 450 conversion: node scripts/build-fs450-asset.mjs <source.usdz> */
import { buildMotorcycleAsset, readSourceAtlas } from './build-motorcycle-asset.mjs';
import { connectedComponents } from './motorcycle-components.mjs';
import { drilledRotor } from './motorcycle-brake-rotor.mjs';
import { importHeadlightMask } from './motorcycle-headlight-mask.mjs';
import { recomputeWeldedNormals } from './motorcycle-tire-normals.mjs';
import path from 'node:path';

let liveryComponents;
const mechanicalComponents = new Map();
const rotors = new Map();
const componentPalette = new Map();
let cockpitComponents;
const paint = { name: 'fs450_bodywork_paint', color: '#e7e7df', metalness: .08, roughness: .36, paintable: true };
const seat = { name: 'fs450_seat_rubber', color: '#1d2024', metalness: 0, roughness: .92 };
const trim = { name: 'fs450_inner_trim', color: '#25292c', metalness: .08, roughness: .7 };
const friction = { name: 'fs450_brake_friction_steel', color: '#bfc4c8', metalness: .48, roughness: .4 };
const carrier = { name: 'fs450_brake_dark_carrier', color: '#293139', metalness: .65, roughness: .45 };
const engine = { name: 'fs450_engine_detail', color: '#858b8e', metalness: .5, roughness: .48 };
const engineCase = { ...engine, name: 'fs450_engine_case' };
const tire = { name: 'fs450_tire_matte_rubber', color: '#090909', metalness: 0, roughness: 1 };
const caliper = { name: 'fs450_brake_caliper', color: '#535e66', metalness: .7, roughness: .4 };
const forkSteel = { name: 'fs450_fork_steel', color: '#bfc4c7', metalness: .62, roughness: .32 };
const frame = { name: 'fs450_frame_satin_charcoal', color: '#101113', metalness: .12, roughness: .65 };
const hardware = { name: 'fs450_hardware_metal', color: '#999fa2', metalness: .55, roughness: .42 };
const darkHardware = { name: 'fs450_dark_hardware', color: '#26292b', metalness: .12, roughness: .6 };
const cockpitDark = { ...darkHardware, name: 'fs450_cockpit_dark' };
const cockpitMetal = { ...hardware, name: 'fs450_cockpit_metal' };
const muffler = { name: 'fs450_muffler_unbranded', color: '#858a8d', metalness: .5, roughness: .4 };

function smoothWeight(value, low, high) {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return [t * t * (3 - 2 * t), t > 0 && t < 1 ? 6 * t * (1 - t) / (high - low) : 0];
}

async function classifyComponents(context, meshName, components, atlasPattern) {
  const { data, info } = await readSourceAtlas(context, atlasPattern);
  const mesh = context.meshes.find(part => part.name === meshName), uv = mesh.geometry.attributes.uv;
  const positions = context.worldPositions.get(meshName);
  const a = new context.THREE.Vector3(), b = new context.THREE.Vector3(), c = new context.THREE.Vector3();
  for (const component of components.components) {
    let total = 0, blue = 0, dark = 0;
    for (let i = 0; i < component.vertices.length; i += 3) {
      const vertices = component.vertices.slice(i, i + 3);
      let u = 0, v = 0;
      for (const vertex of vertices) { u += uv.getX(vertex) / 3; v += uv.getY(vertex) / 3; }
      // Source uses tiled UV coordinates (mechanics U=4..5), as runtime RepeatWrapping does.
      const x = Math.min(info.width - 1, Math.floor((u - Math.floor(u)) * info.width));
      const y = Math.min(info.height - 1, Math.floor((1 - (v - Math.floor(v))) * info.height));
      const offset = (y * info.width + x) * info.channels;
      const r = data[offset], g = data[offset + 1], blueValue = data[offset + 2];
      a.fromArray(positions, vertices[0] * 3); b.fromArray(positions, vertices[1] * 3).sub(a); c.fromArray(positions, vertices[2] * 3).sub(a);
      const area = b.cross(c).length(); total += area;
      if (blueValue > r * 1.3 && blueValue > g * 1.05 && blueValue - r > 15) blue += area;
      if (Math.max(r, g, blueValue) < 80) dark += area;
    }
    componentPalette.set(component, blue / total > .35 ? 'frame' : dark / total > .55 ? 'dark' : 'metal');
  }
}

await buildMotorcycleAsset({
  source: process.argv[2], id: 'fs450', name: 'Supermoto',
  async analyze(context) {
const { meshes, meshBox, worldPositions, worldNormals, THREE } = context;
liveryComponents = connectedComponents(meshes.find(mesh => mesh.name === 'Object_12'), worldPositions.get('Object_12'), THREE);
// Ease the stock shroud's long leading corner and pointed lower end. The paired
// outer panels and their inset edges move together; seat/contact geometry stays.
const plastics = worldPositions.get('Object_12'), plasticNormals = worldNormals.get('Object_12');
for (const vertex of [4, 5, 15, 16].flatMap(index => liveryComponents.components[index].vertices)) {
  const offset = vertex * 3, y = plastics[offset + 1], z = plastics[offset + 2];
  const [lower, lowerSlope] = smoothWeight(.60 - y, 0, .09);
  const [front, frontSlope] = smoothWeight(z, .30, .435);
  plastics[offset + 1] = y + .013 * lower;
  plastics[offset + 2] = z - .014 * front;
  const normal = new THREE.Vector3(plasticNormals[offset],
    plasticNormals[offset + 1] / (1 - .013 * lowerSlope),
    plasticNormals[offset + 2] / (1 - .014 * frontSlope)).normalize();
  plasticNormals.set(normal.toArray(), offset);
}
// Rebuild the smooth tire normal field from its welded circular surface. The
// source's inconsistent skin normals caused alternating bright/dark patches.
for (const name of ['Object_2', 'Object_3'])
  worldNormals.set(name, recomputeWeldedNormals(worldPositions.get(name)));
for (const name of ['Object_8', 'Object_9'])
  mechanicalComponents.set(name, connectedComponents(meshes.find(mesh => mesh.name === name), worldPositions.get(name), THREE));
cockpitComponents = connectedComponents(meshes.find(mesh => mesh.name === 'Object_13'), worldPositions.get('Object_13'), THREE);
for (const [name, components] of mechanicalComponents)
  await classifyComponents(context, name, components, /mechanics.*baseColor\.jpg$/i);
await classifyComponents(context, 'Object_13', cockpitComponents, /cockpit.*baseColor\.jpg$/i);
const rearBox = meshBox('Object_3'), frontBox = meshBox('Object_2');
const rearCenter = rearBox.getCenter(new THREE.Vector3());
const frontCenter = frontBox.getCenter(new THREE.Vector3());
for (const [name, axle, rear] of [['Object_0', frontCenter, false], ['Object_1', rearCenter, true]]) {
  const mesh = meshes.find(part => part.name === name);
  const bounds = meshBox(name);
  let radius = 0;
  const vertices = worldPositions.get(name);
  for (let i = 0; i < vertices.length; i += 3)
    radius = Math.max(radius, Math.hypot(vertices[i + 1] - axle.y, vertices[i + 2] - axle.z));
  const rotor = drilledRotor(THREE, { center: [(bounds.min.x + bounds.max.x) / 2, axle.y, axle.z], radius, thickness: bounds.max.x - bounds.min.x, rear });
  mesh.geometry = rotor.geometry;
  worldPositions.set(name, rotor.geometry.attributes.position.array);
  worldNormals.set(name, rotor.geometry.attributes.normal.array);
  rotors.set(name, rotor);
}
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
const maskSource = process.argv[3] ?? path.join(path.dirname(process.argv[2]), 'KTM_450_EXC_Final.usdz');
anchors.headlight = rounded(normalize(importHeadlightMask(maskSource, context, paint)));

return { normalize, anchors, sourceTransform: { rotateY: Math.PI, sourcePitch: pitch, translateY: -groundY, sourceAxleMidpointZ: centerZ } };
  },
includeTriangle(mesh, vertex) {
  if (mesh.name === 'Object_12') return ![6, 9].includes(liveryComponents.byVertex[vertex].index);
  const component = mechanicalComponents.get(mesh.name)?.byVertex[vertex];
  if (!component || (mesh.name === 'Object_8' && component.index === 0)) return true;
  // Remove only components entirely contained by the opaque crankcase or
  // enclosed airbox. Exposed covers, suspension and frame surfaces stay.
  const { min, max } = component.box;
  const insideCase = min.x > -.04 && max.x < .04 && min.y > .36 && max.y < .5 && min.z > -.025 && max.z < .09;
  const insideAirbox = min.x > -.055 && max.x < .055 && min.y > .71 && max.y < .81 && min.z > -.4 && max.z < .015;
  return !insideCase && !insideAirbox;
},
rigFor(mesh, vertex) {
  if (mesh.name.startsWith('imported_mask_')) return 'steering';
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
  if (['Object_2', 'Object_3'].includes(mesh.name)) return tire;
  if (mesh.name === 'Object_6') return muffler;
  if (mesh.name === 'Object_13') return componentPalette.get(cockpitComponents.byVertex[vertex]) === 'metal' ? cockpitMetal : cockpitDark;
  if (mechanicalComponents.has(mesh.name)) {
    const component = mechanicalComponents.get(mesh.name).byVertex[vertex];
    if (mesh.name === 'Object_8' && component.index === 0) return engineCase;
    if (mesh.name === 'Object_8' && component.index === 1) return caliper;
    if (component.box.max.y - component.box.min.y > .3 &&
        Math.abs(component.center.x) > .04 && Math.abs(component.center.x) < .16 &&
        component.center.z > .22 && component.center.z < .60 && component.center.y > .55)
      return forkSteel;
    if (componentPalette.get(component) === 'frame') return frame;
    if (componentPalette.get(component) === 'dark') return darkHardware;
    // The main crankcase/cylinder above retains every original triangle.
    // Remaining visible fittings retain normals/UVs at a smaller budget.
    if (component.center.y > .25 && component.center.y < .65 &&
        component.center.z > -.205 && component.center.z < .245 && component.box.max.y < .72)
      return engine;
    return hardware;
  }
  if (mesh.name === 'Object_12') {
    const component = liveryComponents.byVertex[vertex];
    // These are separate authored shells, not arbitrary triangle colour masks.
    // The long narrow saddle remains rubber; the airbox/backplate remain trim.
    if (component.index === 12) return seat;
    if (component.index === 7 || component.index === 9) return trim;
    return paint;
  }
  if (rotors.has(mesh.name)) return vertex < rotors.get(mesh.name).frictionVertices ? friction : carrier;
  return undefined;
},
simplification(bucket) {
  if (bucket.material.includes('mechanics') || bucket.material === engine.name)
    return { error: .02, weights: [.35, .35, .35, .8, .8] };
  return undefined;
},
materialBudgets: {
  fs450_bodywork_paint: 7500,
  fs450_seat_rubber: 500,
  fs450_inner_trim: 900,
  fs450_engine_detail: 3200,
  fs450_tire_matte_rubber: 2200,
  fs450_cockpit_dark: 1000,
  fs450_cockpit_metal: 850,
  fs450_frame_satin_charcoal: 1400,
  fs450_hardware_metal: 2400,
  fs450_dark_hardware: 1200,
  fs450_brake_caliper: 500,
  fs450_fork_steel: 1800,
  mat_exmanifold277: 1200,
  fs450_muffler_unbranded: 900,
  mat_rim277_001: 3500,
}
});
