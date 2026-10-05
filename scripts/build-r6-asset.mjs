/** Offline Yamaha R6 conversion: node scripts/build-r6-asset.mjs <source.usdz> */
import { buildMotorcycleAsset } from './build-motorcycle-asset.mjs';
import { connectedComponents } from './motorcycle-components.mjs';

let positions;
let frontCenter, rearCenter;
const components = new Map();
const paint = { name: 'r6_plain_paint', color: '#e7e7df', metalness: .04, roughness: .42, paintable: true };
const trim = { name: 'r6_trim', color: '#24272a', metalness: .1, roughness: .6 };
const seat = { name: 'r6_seat', color: '#17191c', metalness: 0, roughness: .88 };
const steel = { name: 'r6_brake_steel', color: '#a4aaaf', metalness: .88, roughness: .3 };
const carrier = { name: 'r6_brake_carrier', color: '#30363b', metalness: .72, roughness: .43 };
const caliper = { name: 'r6_brake_caliper', color: '#777263', metalness: .6, roughness: .38 };
const engine = { name: 'r6_engine_detail', color: '#ffffff', metalness: .28, roughness: .6, map: 'textures/mat_mechanics624_001_baseColor.jpg' };
await buildMotorcycleAsset({
  source: process.argv[2], id: 'r6', name: 'Yamaha YZF-R6 3rd Gen',
  includeMesh: mesh => !['Object_0', 'Object_15'].includes(mesh.name), // stand and mirror glass
  analyze({ meshes, meshBox, worldPositions, THREE }) {
    positions = worldPositions;
    for (const mesh of meshes) if (['Object_1', 'Object_3', 'Object_4', 'Object_6', 'Object_14'].includes(mesh.name))
      components.set(mesh.name, connectedComponents(mesh, worldPositions.get(mesh.name), THREE));
    const rearBox = meshBox('Object_17'), frontBox = meshBox('Object_18');
    const rear = rearBox.getCenter(new THREE.Vector3());
    const front = frontBox.getCenter(new THREE.Vector3());
    frontCenter = front; rearCenter = rear;
    const rearRadius = (rearBox.max.y - rearBox.min.y) / 2;
    const frontRadius = (frontBox.max.y - frontBox.min.y) / 2;
    // The source is posed on a paddock stand. A single rigid rotation settles
    // both circular tyres on the road without changing the supplied body shape.
    const dx = front.x - rear.x, dy = front.y - rear.y;
    const pitch = Math.asin((frontRadius - rearRadius) / Math.hypot(dx, dy)) - Math.atan2(dy, dx);
    const c = Math.cos(pitch), s = Math.sin(pitch);
    const rotate = ([x, y, z]) => [z, x * s + y * c, -x * c + y * s];
    const rearRot = rotate(rear.toArray()), frontRot = rotate(front.toArray());
    const middle = (rearRot[2] + frontRot[2]) / 2;
    const ground = frontRot[1] - frontRadius;
    const normalize = point => { const p = rotate(point); return [p[0], p[1] - ground, p[2] - middle]; };
    const round = p => normalize(p).map(v => +v.toFixed(7));
    const chassis = meshes.find(mesh => mesh.name === 'Object_1');
    const bone = name => round(chassis.skeleton.bones.find(b => b.name === name).getWorldPosition(new THREE.Vector3()).toArray());
    const frontAxle = round(front.toArray());
    const axisPoint = rotate([-.414, .91, 0]);
    const liveryPositions = worldPositions.get('Object_6');
    const tailSurface = components.get('Object_6').components[4].vertices
      .map(vertex => round(liveryPositions.subarray(vertex * 3, vertex * 3 + 3)))
      .reduce((backmost, point) => point[2] > backmost[2] ? point : backmost);
    return { normalize, sourceTransform: { rotateY: Math.PI / 2, sourcePitch: pitch, translateY: -ground, sourceAxleMidpointZ: middle }, anchors: {
      frontAxle, rearAxle: round(rear.toArray()), frontRadius, rearRadius,
      pivot: bone('n36'), shockTop: bone('n44'), shockBottom: bone('n45'),
      steeringPivot: bone('n50'), steeringAxis: axisPoint,
      forkTop: bone('n50'), forkBottom: frontAxle,
      grip: round([.44834, .910, .285]), peg: round([-.16, .35, .20]),
      hip: round([-.235, .895038845, 0]), exhaust: round([-.635, .466, .256]),
      tail: [0, tailSurface[1], tailSurface[2]],
    } };
  },
  includeTriangle(mesh, vertex) {
    const part = components.get(mesh.name)?.byVertex[vertex];
    if (!part) return true;
    if (mesh.name === 'Object_6' && [11, 12, 14, 15, 18, 31, 32].includes(part.index)) return false;
    // The rear lamp sits above .97m in the source. Only the bolt-on plate
    // hanger, its indicator stalks and lenses occupy this lower rear region.
    if (['Object_1', 'Object_3', 'Object_4', 'Object_14'].includes(mesh.name)
      && part.box.max.x < -.70 && part.box.max.y < .94) return false;
    return true;
  },
  rigFor(mesh, vertex) {
    const id = Number(mesh.name.split('_')[1]);
    if (id === 17 || id === 2) return 'rearWheel';
    if (id === 18) return 'frontWheel';
    if (id === 11) return positions.get(mesh.name)[vertex * 3] > 0 ? 'frontWheel' : 'rearWheel';
    const si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
    let chosen = 0, max = -1;
    for (let k = 0; k < 4; k++) if (sw.array[vertex * 4 + k] > max) { max = sw.array[vertex * 4 + k]; chosen = si.array[vertex * 4 + k]; }
    const name = mesh.skeleton.bones[chosen].name;
    if (name === 'n36') return 'swingarm';
    if (name === 'n37' || name === 'n38') return 'rearWheel';
    if (name === 'n52' || name === 'n53' || name === 'n55') return 'frontWheel';
    if (name === 'n44' || name === 'n46') return 'shockUpper';
    if (name === 'n45') return 'shockLower';
    if (name === 'n51') return 'fork';
    if (['n50', 'n57', 'n58', 'n59', 'n60', 'n61'].includes(name)) return 'steering';
    return 'body';
  },
  materialFor(mesh, vertex) {
    if (mesh.name === 'Object_6') {
      const id = components.get(mesh.name).byVertex[vertex].index;
      if ([8, 10, 13].includes(id)) return seat;
      if ([0, 1, 2, 4, 5, 6, 7, 9].includes(id)) return paint;
      return trim;
    }
    if (mesh.name === 'Object_1') {
      const part = components.get(mesh.name).byVertex[vertex];
      if ([2, 3].includes(part.index)) return caliper;
      // Preserve the engine's original geometry, covers and fasteners. Only
      // the less visible surrounding hardware uses the reduced mesh budget.
      if (part.center.x > -.17 && part.center.x < .48 && part.center.y < .72) return engine;
    }
    if (mesh.name === 'Object_11') return { name: 'r6_rim', color: '#a6acb0', metalness: .76, roughness: .32, rim: true };
    if (mesh.name === 'Object_12') {
      const p = positions.get(mesh.name), axle = p[vertex * 3] > 0 ? frontCenter : rearCenter;
      let distance = 0;
      for (let k = 0; k < 3; k++) distance += Math.hypot(p[(vertex + k) * 3] - axle.x, p[(vertex + k) * 3 + 1] - axle.y) / 3;
      return distance > (axle === frontCenter ? .114 : .072) ? steel : carrier;
    }
    if (mesh.name === 'Object_16') return { name: 'r6_exhaust', color: '#3d4144', metalness: .75, roughness: .38 };
    return undefined;
  },
  materialBudgets: {
    r6_plain_paint: 13500, r6_trim: 2500, r6_seat: 2000,
    mat_mechanics624_001: 3500, r6_rim: 4300, r6_exhaust: 850,
    mat_cockpit624_001: 3200,
    mat_backtyre001: 1800, mat_fronttyre001: 1800,
    mat_glass624_001: 2200, mat_light624: 1000,
    exmanifold624_001: 800, mat_muffler624_001: 850,
  },
});
