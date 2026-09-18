import * as THREE from 'three';
import type { Player, Product } from '../domain/types';
import type { CarriedCapMotionInput } from './carriedCapMotion';
type Point = [number, number, number];
const up = new THREE.Vector3(0, 1, 0);
function finish(color: string, metalness = 0, roughness = 0.85) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness });
}
function put(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, name: string) {
  const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
  mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function bar(parent: THREE.Object3D, a: Point, b: Point, r: number, m: THREE.Material, name: string) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const delta = end.clone().sub(start);
  const o = put(parent, new THREE.CylinderGeometry(r, r, delta.length(), 12), m, name);
  o.position.copy(start).lerp(end, .5); o.quaternion.setFromUnitVectors(up, delta.normalize()); return o;
}
/** A flat, closed fabric ribbon. Constant width, stable frame, no round cord. */
export function strapGeometry(points: Point[], width = .027, thickness = .0022,
  fit?: (point: THREE.Vector3, t: number) => THREE.Vector3) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), false, 'centripetal');
  const positions: number[] = [], indices: number[] = [], uvs: number[] = [];
  let previous = new THREE.Vector3(1, 0, 0);
  const segments = 112;
  const centers = Array.from({ length: segments + 1 }, (_, i) => {
    const point = curve.getPoint(i / segments);
    return fit ? fit(point, i / segments) : point;
  });
  for (let i = 0; i <= segments; i++) {
    const t = i / segments, p = centers[i];
    const tangent = centers[Math.min(segments, i + 1)].clone()
      .sub(centers[Math.max(0, i - 1)]).normalize();
    const shoulder = THREE.MathUtils.smoothstep(p.y, .52, .598);
    const normal = new THREE.Vector3(p.x * .6, shoulder * 2.5, p.z / .17).normalize();
    const across = new THREE.Vector3().crossVectors(tangent, normal).normalize();
    if (across.lengthSq() < .1) across.copy(previous);
    if (i && across.dot(previous) < 0) across.negate();
    previous.copy(across);
    const out = new THREE.Vector3().crossVectors(across, tangent).normalize();
    for (const [side, depth] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const v = p.clone().addScaledVector(across, side * width / 2).addScaledVector(out, depth * thickness / 2);
      positions.push(v.x, v.y, v.z); uvs.push((side + 1) / 2, t);
    }
  }
  for (let i = 0; i < segments; i++) for (let j = 0; j < 4; j++) {
    const a = i * 4 + j, b = i * 4 + (j + 1) % 4;
    indices.push(a, a + 4, b, b, a + 4, b + 4);
  }
  indices.push(0, 1, 2, 0, 2, 3);
  const n = segments * 4; indices.push(n, n + 2, n + 1, n, n + 3, n + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices); g.computeVertexNormals(); g.computeBoundingSphere(); return g;
}
/** Preserve the real logo material, but flatten the front so the print stays readable. */
export function pouchGeometry() {
  const p: number[] = [], uv: number[] = [], ix: number[] = [];
  const rows = 40, sides = 60;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows, y = -.114 + t * .228;
    const belly = Math.sin(Math.PI * t) ** .5;
    const taperX = .79 + .21 * belly;
    const taperZ = .68 + .32 * belly;
    for (let j = 0; j <= sides; j++) {
      const u = j / sides;
      const a = u * Math.PI * 2 - Math.PI / 2;
      const s = Math.sin(a), c = Math.cos(a);
      const front = Math.max(0, c);
      const back = Math.max(0, -c);
      const x = Math.sign(s) * Math.abs(s) ** .58 * .096 * taperX;
      const z = front * (.028 + .004 * belly) - back * (.040 + .004 * (1 - belly));
      p.push(x, y, z * taperZ);
      uv.push(u, t);
    }
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < sides; j++) {
    const a = i * (sides + 1) + j, b = a + sides + 1;
    ix.push(a, a + 1, b, b, a + 1, b + 1);
  }
  for (const r of [0, rows]) for (let j = 1; j < sides - 1; j++) {
    const k = r * (sides + 1);
    if (!r) ix.push(k, k + j + 1, k + j); else ix.push(k, k + j, k + j + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(ix);
  g.computeVertexNormals();
  return g;
}
/** Fit the middle of the strap to the actual garment, not a fixed shirt radius.
 * Local-to-world ray tests also handle a leaning rider and the folded hood.
 * The ends stay at the real pouch lugs, so there is no floating attachment. */
function garmentStrapFit(torso: THREE.Group) {
  const surfaces = ['tailored-garment', 'folded-hood', 'stand-collar']
    .map(name => torso.getObjectByName(name))
    .filter((object): object is THREE.Mesh => object instanceof THREE.Mesh);
  torso.updateWorldMatrix(true, true);
  const inverse = torso.matrixWorld.clone().invert();
  const ray = new THREE.Raycaster();
  return (point: THREE.Vector3, t: number) => {
    const blend = THREE.MathUtils.smoothstep(t, .035, .14)
      * (1 - THREE.MathUtils.smoothstep(t, .86, .965));
    if (!blend || !surfaces.length) return point;
    const radial = new THREE.Vector3(point.x, 0, point.z).normalize();
    if (radial.lengthSq() < .5) return point;
    const origin = radial.clone().multiplyScalar(.85).setY(point.y)
      .applyMatrix4(torso.matrixWorld);
    const target = new THREE.Vector3(0, point.y, 0).applyMatrix4(torso.matrixWorld);
    ray.set(origin, target.sub(origin).normalize());
    const hit = ray.intersectObjects(surfaces, false)[0];
    if (!hit) return point;
    const surface = hit.point.clone().applyMatrix4(inverse).addScaledVector(radial, .0045);
    return point.lerp(surface, blend);
  };
}
export function addCleanCrossbody(torso: THREE.Group, originalLogoMaterial: THREE.MeshStandardMaterial) {
  const cloth = finish('#1f2022'), seam = finish('#303134'), hardware = finish('#555a5c', .7, .3);
  const group = new THREE.Group(); group.name = 'crossbody-assembly-v39'; torso.add(group);
  const bag = new THREE.Group(); bag.name = 'carried-crossbody-bag';
  bag.position.set(.214, .112, .176); bag.rotation.set(.045, -Math.PI + .13, -.055); group.add(bag);
  put(bag, pouchGeometry(), originalLogoMaterial, 'crossbody-pouch');
  const lugs: Point[] = [[-.072, .098, -.011], [.072, .098, .011]];
  for (const p of lugs) {
    const lug = put(bag, new THREE.TorusGeometry(.0105, .0021, 8, 16, Math.PI * 1.8), hardware, 'crossbody-strap-ring');
    lug.position.set(...p); lug.rotation.y = Math.PI / 2;
  }
  bag.updateMatrix();
  const left = new THREE.Vector3(...lugs[0]).applyMatrix4(bag.matrix).toArray() as Point;
  const right = new THREE.Vector3(...lugs[1]).applyMatrix4(bag.matrix).toArray() as Point;
  put(group, strapGeometry([
    left, [.176, .233, -.082], [.072, .347, -.165], [-.062, .47, -.166],
    [-.149, .548, -.114], [-.164, .592, -.024], [-.159, .578, .086],
    [-.088, .49, .168], [.027, .353, .194], right,
  ], .024, .0022, garmentStrapFit(torso)), cloth, 'crossbody-flat-strap');
  const zip = new THREE.CatmullRomCurve3([[-.071, .074, -.026], [0, .081, -.031], [.071, .074, -.026]].map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  put(bag, new THREE.TubeGeometry(zip, 28, .00145, 6, false), seam, 'crossbody-zipper-seam');
  const pull = put(bag, new THREE.TorusGeometry(.0062, .0012, 6, 12), hardware, 'crossbody-zipper-pull');
  pull.scale.y = 1.45; pull.position.set(.052, .069, -.032);
  const adjuster = put(group, new THREE.BoxGeometry(.029, .011, .0045), hardware, 'crossbody-strap-adjuster');
  adjuster.position.set(.08, .331, .188); adjuster.rotation.z = -.69;
}
function selectedColor(p: Product, player: Player) {
  return p.preview?.colors.find(c=>c.variantIds.includes(player.variants[p.id]))?.baseColor ?? p.baseColor;
}
/** Detailed key and fabric fob at the ignition; never attached to the rider's hip. */
export function addIgnitionKey(
  body: THREE.Group, player: Player, products: Product[], grip: readonly number[],
) {
  const product = products.find(p=>p.id===player.equipped.accessory && p.handle==='schlusselanhanger');
  if (!product) return undefined;
  const assembly = new THREE.Group();assembly.name='ignition-keychain-v38';body.add(assembly);
  // Chassis-local ignition mounts. The sport fob lies rearward over the tank;
  // the scooter key faces the rider from its inner leg shield, not from inside
  // the handlebar nacelle. All mounts move with the motorcycle, never the hip.
  const mounts: Record<string, { point: Point; socketPitch: number; hangPitch: number }> = {
    '125': { point: [-.050, 1.170, -.350], socketPitch: 0, hangPitch: -.18 },
    '450': { point: [-.055, 1.105, -.390], socketPitch: 0, hangPitch: -.24 },
    '701': { point: [-.050, 1.050, -.435], socketPitch: 0, hangPitch: -1.33 },
    scooter: { point: [.075, .840, -.160], socketPitch: Math.PI / 2, hangPitch: -Math.PI / 2 },
  };
  const mount = mounts[player.bike] ?? {
    point: [-.055, grip[1]-.025, grip[2]+.050] as Point, socketPitch: 0, hangPitch: -.2,
  };
  assembly.position.set(...mount.point);
  assembly.rotation.x = mount.socketPitch;
  assembly.userData.mount = 'ignition';
  const chrome=finish('#aeb5b9',.86,.25), black=finish('#1e2021'), fabric=finish(selectedColor(product,player));
  const socket=put(assembly,new THREE.CylinderGeometry(.017,.019,.018,20),black,'ignition-barrel');
  socket.position.y=-.009;
  const bezel=put(assembly,new THREE.TorusGeometry(.013,.002,8,24),chrome,'ignition-bezel');bezel.rotation.x=Math.PI/2;
  bar(assembly,[0,-.022,0],[.066,-.032,0],.010,black,'ignition-clamp-mount');
  const key=put(assembly,new THREE.BoxGeometry(.006,.025,.0025),chrome,'ignition-key-blade');key.position.y=.011;
  const head=put(assembly,new THREE.BoxGeometry(.028,.020,.006),black,'ignition-key-head');head.position.y=.03;
  const pivot=new THREE.Group();pivot.name='keychain-pivot';pivot.position.set(-.01,.034,.003);
  pivot.rotation.set(mount.hangPitch, 0, -.09);assembly.add(pivot);
  for (const z of [0,.0028]) {
    const ring=put(pivot,new THREE.TorusGeometry(.022,.00165,8,36,Math.PI*1.9),chrome,'keychain-split-ring');
    ring.position.set(-.018,-.012,z);ring.rotation.z=z?-.15:.15;
  }
  bar(pivot,[-.025,-.031,.001],[-.040,-.048,.001],.0035,chrome,'keychain-connector');
  const tag=new THREE.Group();tag.name='keychain-fabric-tag';pivot.add(tag);
  tag.position.set(-.05,-.108,.008);tag.rotation.z=-.28;tag.rotation.y=-.45;
  const outline=new THREE.Shape();outline.moveTo(-.020,-.068);outline.lineTo(.018,-.065);
  outline.quadraticCurveTo(.025,-.063,.025,-.055);outline.lineTo(.020,.057);
  outline.quadraticCurveTo(.019,.07,.008,.072);outline.lineTo(-.014,.07);
  outline.quadraticCurveTo(-.026,.068,-.025,.055);outline.lineTo(-.027,-.055);
  outline.quadraticCurveTo(-.027,-.064,-.020,-.068);
  const tagGeometry=new THREE.ExtrudeGeometry(outline,{depth:.0028,bevelEnabled:true,bevelSize:.001,bevelThickness:.0008,bevelSegments:2,steps:1,curveSegments:8});
  put(tag,tagGeometry,fabric,'keychain-fabric-body');
  for (const x of [-.020,.018]) for(let i=0;i<11;i++)
    bar(tag,[x,-.053+i*.01,.004],[x,-.048+i*.01,.004],.00065,chrome,'keychain-stitch');
  const eyelet=put(tag,new THREE.TorusGeometry(.005,.0014,8,20),chrome,'keychain-eyelet');eyelet.position.set(-.002,.058,.003);
  if(typeof document!=='undefined') {
    const c=document.createElement('canvas');c.width=128;c.height=512;
    const ctx=c.getContext('2d');
    if(ctx){
      ctx.clearRect(0,0,128,512);
      const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;
      const print=new THREE.MeshStandardMaterial({map,transparent:true,alphaTest:.1,roughness:.96,side:THREE.DoubleSide});
      let disposed=false;
      print.addEventListener('dispose',()=>{disposed=true;map.dispose();});
      // Reuse the supplied real Pfusch artwork; do not imitate its lettering.
      // The headless geometry verifier intentionally has no Image implementation.
      if (typeof Image !== 'undefined') {
        const artwork=new Image();
        artwork.onload=()=>{
          if(disposed)return;
          const scale=Math.min(390/artwork.naturalWidth,90/artwork.naturalHeight);
          const w=artwork.naturalWidth*scale,h=artwork.naturalHeight*scale;
          ctx.save();ctx.translate(64,256);ctx.rotate(-Math.PI/2);
          ctx.drawImage(artwork,-w/2,-h/2,w,h);ctx.restore();map.needsUpdate=true;
        };
        artwork.onerror=()=>{if(!disposed)console.error('Keychain brand artwork could not load.');};
        artwork.src='/images/artwork/ziptie.png';
      }
      for(const z of [-.0015,.0045]) {const ink=put(tag,new THREE.PlaneGeometry(.030,.112),print,'keychain-wordmark');ink.position.set(-.001,-.002,z);if(z<0)ink.rotation.y=Math.PI;}
    }
  }
  let sway=0, velocity=0;
  return { update(input:CarriedCapMotionInput,dt:number) {
    if(input.paused||!Number.isFinite(dt)||dt<=0)return;
    const step=Math.min(dt,.05);
    const target=input.reducedMotion?0:THREE.MathUtils.clamp((input.longitudinalAcceleration??0)*.018,-.18,.18);
    velocity+=(target-sway)*28*step;velocity*=Math.exp(-step*9);sway+=velocity*step;
    pivot.rotation.x=mount.hangPitch+sway; pivot.rotation.z=-.09;
  }};
}
