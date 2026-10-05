/** Offline Yamaha R6 conversion: node scripts/build-r6-asset.mjs <source.usdz> */
import { buildMotorcycleAsset } from './build-motorcycle-asset.mjs';
import { connectedComponents } from './motorcycle-components.mjs';
import { drilledRotor } from './motorcycle-brake-rotor.mjs';

let positions;
const rotors = [];
const components = new Map();
const paint = { name: 'r6_plain_paint', color: '#e7e7df', metalness: .04, roughness: .42, paintable: true };
const trim = { name: 'r6_trim', color: '#24272a', metalness: .1, roughness: .6 };
const seat = { name: 'r6_seat', color: '#17191c', metalness: 0, roughness: .88 };
const steel = { name: 'r6_brake_steel', color: '#a4aaaf', metalness: .88, roughness: .3 };
const carrier = { name: 'r6_brake_carrier', color: '#30363b', metalness: .72, roughness: .43 };
const caliper = { name: 'r6_brake_caliper', color: '#777263', metalness: .6, roughness: .38 };
const engine = { name: 'r6_engine_detail', color: '#626669', metalness: .48, roughness: .54 };
const metal = { name: 'r6_metal', color: '#aeb3b6', metalness: .72, roughness: .42 };
const rubber = { name: 'r6_tyre', color: '#121314', metalness: 0, roughness: 1 };
const glass = { name: 'r6_clear_glass', color: '#b3c2c9', metalness: 0, roughness: .14, transparent: true, opacity: .22 };
const rearLamp = { name: 'r6_rear_lamp', color: '#9d1617', metalness: .05, roughness: .28 };
const reflector = { name: 'r6_reflector', color: '#c7d2d9', metalness: .8, roughness: .24 };
const indicator = { name: 'r6_indicator', color: '#da8b22', metalness: .05, roughness: .3 };
await buildMotorcycleAsset({
  source: process.argv[2], id: 'r6', name: 'Sport Bike',
  // Object 4 and 8 duplicate the transparent surfaces already in Object 3.
  includeMesh: mesh => !['Object_0', 'Object_4', 'Object_8', 'Object_15'].includes(mesh.name),
  analyze({ meshes, meshBox, worldPositions, worldNormals, THREE }) {
    positions = worldPositions;
    for (const mesh of meshes) if (['Object_1', 'Object_3', 'Object_5', 'Object_6', 'Object_14'].includes(mesh.name))
      components.set(mesh.name, connectedComponents(mesh, worldPositions.get(mesh.name), THREE));
    // Keep the overall supplied shape while softening the optical corners and
    // shortening the screen lip into a restrained, unbadged game-bike variant.
    // The same continuous deformation affects fairing, recess and lens alike.
    for (const mesh of meshes) {
      const p = worldPositions.get(mesh.name);
      for (let i = 0; i < p.length; i += 3) {
        const [x, y, z] = p.subarray(i, i + 3);
        if (x > .75 && x < .93 && y > .70 && y < .90 && Math.abs(z) > .14) {
          const border = Math.min((x - .75) / .05, (.93 - x) / .03, (y - .70) / .025, (.90 - y) / .025, 1);
          p[i + 1] += .012 * Math.min(1, (Math.abs(z) - .14) / .10) * Math.max(0, border);
        }
        if (mesh.name === 'Object_3' && components.get(mesh.name).byVertex[i / 3].index === 0 && y > 1.035) {
          const top = (y - 1.035) / .077;
          p[i] += .025 * top; p[i + 1] -= .012 * top;
        }
      }
    }
    const rearBox = meshBox('Object_17'), frontBox = meshBox('Object_18');
    const rear = rearBox.getCenter(new THREE.Vector3());
    const front = frontBox.getCenter(new THREE.Vector3());
    const brake = meshes.find(mesh => mesh.name === 'Object_12');
    const geometry = new THREE.BufferGeometry();
    const rotorGeometry = [
      { center: [front.x, front.y, .05721793], radius: .155276, thickness: .005 },
      { center: [front.x, front.y, -.05734916], radius: .155276, thickness: .005 },
      { center: [rear.x, rear.y, .08331449], radius: .1041245, thickness: .0033, rear: true },
    ].map((spec, index) => {
      const rotor = drilledRotor(THREE, { ...spec, center: [spec.center[2], spec.center[1], -spec.center[0]] });
      rotor.geometry.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
      const start = rotors.length ? rotors.at(-1).end : 0;
      rotors.push({ start, end: start + rotor.geometry.attributes.position.count, frictionEnd: start + rotor.frictionVertices, rig: index < 2 ? 'frontWheel' : 'rearWheel' });
      return rotor.geometry;
    });
    for (const [name, itemSize] of [['position', 3], ['normal', 3], ['uv', 2]]) {
      const values = new Float32Array(rotorGeometry.reduce((sum, part) => sum + part.attributes[name].array.length, 0));
      let offset = 0;
      for (const part of rotorGeometry) { values.set(part.attributes[name].array, offset); offset += part.attributes[name].array.length; }
      geometry.setAttribute(name, new THREE.BufferAttribute(values, itemSize));
    }
    brake.geometry = geometry;
    worldPositions.set(brake.name, geometry.attributes.position.array);
    worldNormals.set(brake.name, geometry.attributes.normal.array);
    for (const part of rotorGeometry) part.dispose();
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
      headlights: [round([.7773092045, .8006546617, .1455130474]), round([.7773092046, .8006546736, -.1455131152])],
    } };
  },
  includeTriangle(mesh, vertex) {
    const part = components.get(mesh.name)?.byVertex[vertex];
    if (!part) return true;
    if (mesh.name === 'Object_6' && [11, 12, 14, 15, 18, 23, 24, 25, 31, 32, 33].includes(part.index)) return false;
    if (mesh.name === 'Object_1' && part.index === 27) return false; // remaining under-tail plate stalk
    // These wholly enclosed small parts are behind the intact crankcase shell.
    if (mesh.name === 'Object_1' && part.box.min.x > -.05 && part.box.max.x < .34
      && part.box.min.y > .30 && part.box.max.y < .68 && part.box.min.z > -.08 && part.box.max.z < .08) return false;
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
    if (id === 12) return rotors.find(rotor => vertex < rotor.end).rig;
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
      if ([1, 4, 9, 11, 37, 45].includes(part.index)) return trim;
      if ([0, 36, 49, 67, 68].includes(part.index)) return metal;
      // Keep exterior case contours and covers; decimate fine hardware at a
      // bounded geometric error instead of substituting a primitive engine.
      if (part.center.x > -.17 && part.center.x < .48 && part.center.y < .72) return engine;
      return metal;
    }
    if (['Object_17', 'Object_18'].includes(mesh.name)) return rubber;
    if (mesh.name === 'Object_3') return components.get(mesh.name).byVertex[vertex].index === 2 ? rearLamp : glass;
    if (mesh.name === 'Object_14') return indicator;
    if (mesh.name === 'Object_5') return components.get(mesh.name).byVertex[vertex].center.x < 0 ? rearLamp : reflector;
    if (mesh.name === 'Object_9') return { name: 'r6_gauge', color: '#19262c', metalness: .05, roughness: .25 };
    if (mesh.name === 'Object_10') return trim;
    if (mesh.name === 'Object_2' || mesh.name === 'Object_7') return metal;
    if (mesh.name === 'Object_13') return { name: 'r6_headers', color: '#766e60', metalness: .72, roughness: .5 };
    if (mesh.name === 'Object_11') return { name: 'r6_rim', color: '#a6acb0', metalness: .76, roughness: .32, rim: true };
    if (mesh.name === 'Object_12') {
      return vertex < rotors.find(rotor => vertex < rotor.end).frictionEnd ? steel : carrier;
    }
    if (mesh.name === 'Object_16') return { name: 'r6_exhaust', color: '#3d4144', metalness: .75, roughness: .38 };
    return undefined;
  },
  simplification(bucket) {
    return { error: /engine/.test(bucket.material) ? .009 : /paint|seat|glass/.test(bucket.material) ? .008 : .025,
      weights: [.1, .1, .1, 0, 0], flags: ['Permissive'] };
  },
  materialBudgets: {
    r6_plain_paint: 8000, r6_trim: 3200, r6_seat: 900,
    r6_engine_detail: 10000, r6_metal: 3800, r6_rim: 2600, r6_exhaust: 650,
    r6_tyre: 3000, r6_clear_glass: 750, r6_reflector: 650, r6_rear_lamp: 200,
    r6_indicator: 100, r6_brake_caliper: 1000, r6_headers: 650,
  },
});
