import {TUBE_EXHAUST,exhaustAxisY,raisedLinerY} from './exhaustClearance';
import * as THREE from 'three';
type P = [number, number, number];
function add(root: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, name: string) {
  g.computeVertexNormals(); const mesh = new THREE.Mesh(g,m);mesh.name=name;
  mesh.castShadow=mesh.receiveShadow=true;root.add(mesh);return mesh;
}
function color(hex:string, metalness=0, roughness=.75) {return new THREE.MeshStandardMaterial({color:hex,metalness,roughness});}
function tube(root:THREE.Object3D, points:P[], radius:number, mat:THREE.Material, name:string) {
  const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)),false,'centripetal');
  return add(root,new THREE.TubeGeometry(curve,40,radius,12,false),mat,name);
}
function panel(root:THREE.Object3D, vertices:number[], indices:number[], mat:THREE.Material,name:string) {
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);
  return add(root,g,mat,name);
}
function clonePaint(base:THREE.MeshStandardMaterial){const m=base.clone();m.side=THREE.DoubleSide;return m;}
/** Only the pipe/silencer and a raised channel in the EXISTING liner. No box panels. */
export function fitRearExitExhaust(body:THREE.Group, paint:THREE.MeshStandardMaterial) {
  if(body.getObjectByName('v42-tube-exhaust'))return;
  const names=new Set(['single-exhaust','exhaust-mount-band','exhaust-frame-hanger','open-silencer-outlet','connected-exhaust-pipe']);
  const old:THREE.Mesh[]=[];
  body.traverse(o=>{if(o instanceof THREE.Mesh&&names.has(o.name))old.push(o);});
  if(old.length!==5)throw new Error(`Expected the five original Supermoto exhaust parts, got ${old.length}`);
  old.forEach(o=>{o.removeFromParent();o.geometry.dispose();});
  const e=TUBE_EXHAUST,group=new THREE.Group();group.name='v42-tube-exhaust';body.add(group);
  const silver=color('#a6abb0',.63,.40),carbon=color('#222427',.2,.72),inner=color('#0e0f10',.15,.94);
  const a=new THREE.Vector3(e.x,e.startY,e.startZ),b=new THREE.Vector3(e.x,e.endY,e.endZ);
  const axis=b.clone().sub(a).normalize(),len=a.distanceTo(b);
  const orient=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),axis);
  const shell=new THREE.LatheGeometry([
    new THREE.Vector2(.022,0),new THREE.Vector2(.034,.014),new THREE.Vector2(e.radius,.040),
    new THREE.Vector2(e.radius,len-.068),new THREE.Vector2(e.radius-.003,len-.035),
  ],40);
  const can=add(group,shell,silver,'single-exhaust');can.position.copy(a);can.quaternion.copy(orient);
  const capGeometry=new THREE.LatheGeometry([
    new THREE.Vector2(e.radius,len-.070),new THREE.Vector2(e.radius-.002,len-.029),
    new THREE.Vector2(.039,len+.001),new THREE.Vector2(.027,len+.006),
    new THREE.Vector2(.023,len+.006),new THREE.Vector2(.023,len-.061),
  ],40);
  const cap=add(group,capGeometry,carbon,'open-silencer-outlet');cap.position.copy(a);cap.quaternion.copy(orient);
  const bore=add(group,new THREE.CylinderGeometry(.023,.023,.050,32,1,true),inner,'silencer-inner-bore');
  bore.quaternion.copy(orient);bore.position.copy(b).addScaledVector(axis,-.028);
  const endRing=add(group,new THREE.TorusGeometry(.025,.0024,8,40),silver,'silencer-outlet-ring');
  endRing.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),axis);endRing.position.copy(b).addScaledVector(axis,.007);
  const band=add(group,new THREE.CylinderGeometry(.049,.049,.016,32,1,true),carbon,'exhaust-mount-band');
  band.quaternion.copy(orient);band.position.copy(a).addScaledVector(axis,len*.42);
  tube(group,[[.046,.724,-.238],[.103,.700,-.248],[.138,.680,-.188],[.108,.702,.04],[.104,.724,.27],[e.x,e.startY,e.startZ]],.019,silver,'connected-exhaust-pipe');
  tube(group,[[.11,.976,.62],[e.x,.94,.64],[e.x,exhaustAxisY(.64)+.045,.64]],.008,carbon,'exhaust-frame-hanger');
  const liner=body.getObjectByName('supermoto-under-tail-liner');
  if(!(liner instanceof THREE.Mesh))throw new Error('Supermoto liner is missing');
  const p=liner.geometry.getAttribute('position');let raised=0;
  const original=Float32Array.from(p.array as ArrayLike<number>),half=p.count/2;
  if(!Number.isInteger(half))throw new Error('Expected a two-sided liner sheet');
  for(let i=0;i<p.count;i++){
    const j=i%half,baseY=original[j*3+1],oldY=original[i*3+1];
    const newY=raisedLinerY(original[j*3],baseY,original[j*3+2])+(oldY-baseY);
    if(newY>oldY+1e-7){p.setY(i,newY);raised++;}
  }
  p.needsUpdate=true;liner.geometry.computeVertexNormals();liner.geometry.computeBoundingBox();liner.geometry.computeBoundingSphere();
  liner.userData.exhaustChannelRaised=raised;group.userData.sideCutouts=0;group.userData.boxPanels=0;
}

/** Color rim surfaces only. Spokes stay silver on the supermoto. */
export function finishWheelColors(body:THREE.Group, value:string) {
  const accepted=new Set(['formed-rim-barrel','cast-y-spoke','rim-band','rim-surface']);
  body.traverse(o=>{if(!(o instanceof THREE.Mesh))return;
    const byName=accepted.has(o.name);
    const byWheel=o.parent?.name.endsWith('-wheel')&&o.name!=='cross-laced-spokes'&&o.name!=='spoke'&&o.geometry instanceof THREE.CylinderGeometry&&o.geometry.parameters.radiusTop===.055;
    if(!byName&&!byWheel)return;
    const mats=Array.isArray(o.material)?o.material:[o.material];
    const next=mats.map(m=>{if(!(m instanceof THREE.MeshStandardMaterial))return m;const n=m.clone();n.color.set(value);n.metalness=.52;n.roughness=.40;return n;});
    o.material=Array.isArray(o.material)?next:next[0];
  });
}
/** Small bounded cloth fairing. No deleted faces, no anatomy scaling or torso edits. */
export function fairShoulder(mesh:THREE.Mesh,rings:number,sides:number) {
  const g=mesh.geometry,p=g.getAttribute('position');if(p.count!==(rings+1)*(sides+1))throw new Error('Unexpected sleeve grid');
  const original=Float32Array.from(p.array as ArrayLike<number>),stride=sides+1;
  for(let pass=0;pass<3;pass++){
    const prev=Float32Array.from(p.array as ArrayLike<number>);
    for(let r=1;r<rings;r++){
      const t=r/rings,w=THREE.MathUtils.smoothstep(t,.03,.12)*(1-THREE.MathUtils.smoothstep(t,.34,.48));
      if(!w)continue;
      for(let j=0;j<sides;j++)for(let axis=0;axis<3;axis++){
        const i=(r*stride+j)*3+axis;
        const average=(prev[i-stride*3]+prev[i+stride*3]+prev[(r*stride+(j+sides-1)%sides)*3+axis]+prev[(r*stride+(j+1)%sides)*3+axis])/4;
        const target=prev[i]+(average-prev[i])*.42*w;
        (p.array as Float32Array)[i]=THREE.MathUtils.clamp(target,original[i]-.0035,original[i]+.0035);
      }
      for(let axis=0;axis<3;axis++)(p.array as Float32Array)[(r*stride+sides)*3+axis]=(p.array as Float32Array)[r*stride*3+axis];
    }
  }
  p.needsUpdate=true;g.computeVertexNormals();g.computeBoundingSphere();
}
export function blackSprings(body:THREE.Group){
  const names=new Set(['rear-shock-spring','fork-stanchion','fork-dust-seal']);
  body.traverse(o=>{if(!(o instanceof THREE.Mesh)||!names.has(o.name))return;
    const tint=(m:THREE.Material)=>{if(!(m instanceof THREE.MeshStandardMaterial))return m;const n=m.clone();n.color.set('#151515');n.metalness=.10;n.roughness=.86;return n;};
    o.material=Array.isArray(o.material)?o.material.map(tint):tint(o.material);
  });
}
/** Keep the ORIGINAL materials: cloning detaches them from the glow registry and async ink loaders. */
const wardrobeTinted=new WeakSet<THREE.MeshStandardMaterial>();
export function darkenWardrobe(root:THREE.Object3D,factor=.88){
  const keywords=['garment','hood','shirt','tee','hoodie','outerwear','sleeve','cuff','collar'];
  root.traverse(o=>{if(!(o instanceof THREE.Mesh)||!keywords.some(k=>o.name.toLowerCase().includes(k)))return;
    const materials=Array.isArray(o.material)?o.material:[o.material];
    for(const m of materials){
      if(!(m instanceof THREE.MeshStandardMaterial)||wardrobeTinted.has(m))continue;
      wardrobeTinted.add(m);m.color.multiplyScalar(factor);
      // Do not alter emissiveMap, callbacks, emissiveIntensity, or identity.
    }
  });
}
/** Pull the supermoto cockpit slightly upward/back instead of forward-bent. */
export function tiltHandlebarBack(body:THREE.Object3D){
  const names = new Set(['supermoto-handlebar', 'supermoto-handguard', 'supermoto-lever']);
  const hit=(name:string)=>names.has(name);
  body.traverse(o=>{if(!(o instanceof THREE.Mesh||o instanceof THREE.Group))return;if(!hit(o.name))return;
    o.rotation.x += .10; o.rotation.z += .01;
  });
}
