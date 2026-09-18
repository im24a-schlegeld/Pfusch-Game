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
/** Hidden high-mounted supermoto exhaust with a real rear opening and rear cut-out only. */
export function fitRearExitExhaust(body:THREE.Group, paint:THREE.MeshStandardMaterial) {
  if(body.getObjectByName('v41-rear-exhaust'))return;
  const oldNames=new Set(['single-exhaust','exhaust-mount-band','exhaust-frame-hanger','open-silencer-outlet','connected-exhaust-pipe','exhaust-upper-connector','rear-only-exhaust-recess','rear-panel-with-exhaust-opening','closed-undertail-cheek']);
  const old:THREE.Object3D[]=[];body.traverse(o=>{if(oldNames.has(o.name)||o.name==='v40-rear-exhaust')old.push(o);});
  for(const o of old){o.removeFromParent();if(o instanceof THREE.Mesh)o.geometry.dispose();}
  const group=new THREE.Group();group.name='v41-rear-exhaust';body.add(group);
  const metal=color('#767c81',.78,.34), dark=color('#111214',.18,.82), carbon=color('#232528',.18,.72), outer=clonePaint(paint);
  const x=.072, y=.975, rear=.828;
  tube(group,[[.046,.724,-.238],[.103,.700,-.248],[.138,.680,-.188],[.104,.696,.020],[.086,.748,.258],[.076,.860,.462],[x,.942,.622]],.019,metal,'connected-exhaust-pipe');
  const can=add(group,new THREE.CylinderGeometry(.039,.034,.250,28,1,true),metal,'single-exhaust');
  can.rotation.x=Math.PI/2;can.position.set(x,y-.006,rear-.100);can.scale.set(1,.98,1);
  const tip=add(group,new THREE.CylinderGeometry(.042,.038,.070,28,1,true),carbon,'exhaust-carbon-cap');
  tip.rotation.x=Math.PI/2;tip.position.set(x,y,rear-.020);
  const bore=add(group,new THREE.CylinderGeometry(.021,.021,.060,24,1,true),dark,'open-silencer-outlet');
  bore.rotation.x=Math.PI/2;bore.position.set(x,y+.001,rear+.004);
  const ring=add(group,new THREE.TorusGeometry(.029,.0035,8,24),metal,'exhaust-tip-ring');ring.rotation.x=Math.PI/2;ring.position.set(x,y,rear+.037);
  const band=add(group,new THREE.TorusGeometry(.038,.003,8,30),metal,'exhaust-mount-band');band.rotation.x=Math.PI/2;band.position.set(x,y-.018,rear-.120);
  tube(group,[[.115,.985,.535],[.095,.982,.575],[x,.972,.617]],.008,color('#3d4145',.5,.42),'exhaust-frame-hanger');
  const panelShape=new THREE.Shape();
  panelShape.moveTo(-.140,.890);panelShape.lineTo(.140,.890);panelShape.lineTo(.140,1.024);panelShape.lineTo(-.140,1.024);panelShape.closePath();
  const hole=new THREE.Path();hole.absellipse(x,y,.046,.033,0,Math.PI*2,true);panelShape.holes.push(hole);
  const cap=add(group,new THREE.ExtrudeGeometry(panelShape,{depth:.010,bevelEnabled:false,curveSegments:28}),outer,'rear-panel-with-exhaust-opening');cap.position.z=rear+.005;
  // side cheeks go lower and conceal the exhaust in profile
  for(const side of [-1,1]){
    const xx=side*.142;
    panel(group,[xx,.892,.495,xx,1.006,.495,xx,1.038,.838,xx,.936,.856],[0,1,2,0,2,3],outer,'closed-undertail-cheek');
  }
  group.userData.outletDirection='+Z';
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
/** Slightly darken garments only, not skin, tires, plastics or helmet shell. */
export function darkenWardrobe(root:THREE.Object3D,factor=.88){
  const keywords=['garment','hood','shirt','tee','hoodie','outerwear','sleeve','cuff','collar'];
  root.traverse(o=>{if(!(o instanceof THREE.Mesh))return;if(!keywords.some(k=>o.name.toLowerCase().includes(k)))return;
    const apply=(m:THREE.Material)=>{if(!(m instanceof THREE.MeshStandardMaterial))return m;const n=m.clone();n.color.multiplyScalar(factor);return n;};
    o.material=Array.isArray(o.material)?o.material.map(apply):apply(o.material);
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
