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
function _panel(root:THREE.Object3D, vertices:number[], indices:number[], mat:THREE.Material,name:string) {
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);
  return add(root,g,mat,name);
}
function _clonePaint(base:THREE.MeshStandardMaterial){const m=base.clone();m.side=THREE.DoubleSide;return m;}
/** Only the pipe/silencer and a raised channel in the EXISTING liner. No box panels. */
export function fitRearExitExhaust(body:THREE.Group, _paint:THREE.MeshStandardMaterial) {
  if(body.getObjectByName('v42-tube-exhaust'))return;
  const names=new Set(['single-exhaust','exhaust-mount-band','exhaust-frame-hanger','open-silencer-outlet','connected-exhaust-pipe']);
  const old:THREE.Mesh[]=[];
  body.traverse(o=>{if(o instanceof THREE.Mesh&&names.has(o.name))old.push(o);});
  if(old.length!==5)throw new Error(`Expected the five original Supermoto exhaust parts, got ${old.length}`);
  old.forEach(o=>{o.removeFromParent();o.geometry.dispose();});
  const e=TUBE_EXHAUST,group=new THREE.Group();group.name='v42-tube-exhaust';body.add(group);
  const silver=color('#a6abb0',.63,.40),carbon=color('#222427',.2,.72),inner=color('#0e0f10',.15,.94);
  const a=new THREE.Vector3(e.x,e.startY+.018,e.startZ+.02),b=new THREE.Vector3(e.x,e.endY+.03,e.endZ-.01);
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
  // Four-stroke header: short outlet from the head, tight downward bend ahead
  // of the cylinder, then a continuous return up the right side to the can.
  tube(group,[[.046,.724,-.238],[.135,.709,-.247],[.190,.664,-.286],
    [.197,.610,-.295],[.196,.570,-.252],[.191,.580,-.173],
    [.170,.656,-.119],[.129,.746,-.055],[.105,.776,.130],[.103,.782,.310],
    [e.x,e.startY+.018,e.startZ+.02]],.0175,silver,'connected-exhaust-pipe');
  tube(group,[[.075,.976,.62],[e.x,.94,.64],[e.x,exhaustAxisY(.64)+.045,.64]],.008,carbon,'exhaust-frame-hanger');
  const liner=body.getObjectByName('supermoto-under-tail-liner');
  if(!(liner instanceof THREE.Mesh))throw new Error('Supermoto liner is missing');
  const p=liner.geometry.getAttribute('position');let raised=0;
  const original=Float32Array.from(p.array as ArrayLike<number>),half=p.count/2;
  if(!Number.isInteger(half))throw new Error('Expected a two-sided liner sheet');
  // Raising the liner also moves it into a narrower part of the side cover.
  // Fit its width to that actual inner wall, not the former low outer edge.
  const wallTriangles: THREE.Triangle[]=[];
  body.traverse(object=>{
    if(!(object instanceof THREE.Mesh)||object.name!=='supermoto-side-cover')return;
    const pos=object.geometry.getAttribute('position'),ix=object.geometry.index!;
    for(let i=0;i<ix.count;i+=3){
      const triangle=new THREE.Triangle(...[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(pos,ix.getX(i+j))) as [THREE.Vector3,THREE.Vector3,THREE.Vector3]);
      if(triangle.getMidpoint(new THREE.Vector3()).x>0)wallTriangles.push(triangle);
    }
  });
  const wallRay=new THREE.Ray(),wallHit=new THREE.Vector3(),inward=new THREE.Vector3(-1,0,0);
  const innerWallX=(y:number,z:number)=>{
    wallRay.set(new THREE.Vector3(1,y,z),inward);let x=Infinity;
    for(const t of wallTriangles)if(wallRay.intersectTriangle(t.a,t.b,t.c,false,wallHit))x=Math.min(x,wallHit.x);
    return x;
  };
  for(let i=0;i<p.count;i++){
    const j=i%half,baseY=original[j*3+1],oldY=original[i*3+1];
    let x=original[j*3],newY=raisedLinerY(x,baseY,original[j*3+2])+(oldY-baseY);
    const z=original[j*3+2];
    if(x>0)for(let pass=0;pass<8;pass++){
      x=Math.min(x,innerWallX(newY,z)-.007);
      newY=Math.max(newY,raisedLinerY(x,baseY,z)+(oldY-baseY));
    }
    p.setXYZ(i,x,newY,z);
    if(newY>oldY+1e-7)raised++;
  }
  p.needsUpdate=true;liner.geometry.computeVertexNormals();liner.geometry.computeBoundingBox();liner.geometry.computeBoundingSphere();
  liner.userData.exhaustChannelRaised=raised;group.userData.sideCutouts=0;group.userData.boxPanels=0;
}

/** Color rim surfaces only. Spokes stay silver on the supermoto. */
export function finishWheelColors(body:THREE.Group, value:string) {
  const accepted=new Set(['formed-rim-barrel','rim-band','rim-surface','supermoto-rim-ring','supermoto-rim-face']);
  body.traverse(o=>{if(!(o instanceof THREE.Mesh))return;
    const lower=o.name.toLowerCase();
    if(lower.includes('spoke')||lower.includes('tyre')||lower.includes('tire'))return;
    const byName=accepted.has(o.name)||lower.includes('rim')||lower.includes('wheel-ring')||lower.includes('wheel-face');
    const byWheel=o.parent?.name.endsWith('-wheel')&&o.geometry instanceof THREE.CylinderGeometry&&o.geometry.parameters.radiusTop>=.045&&o.geometry.parameters.radiusTop<=.058;
    if(!byName&&!byWheel)return;
    const mats=Array.isArray(o.material)?o.material:[o.material];
    const next=mats.map(m=>{if(!(m instanceof THREE.MeshStandardMaterial))return m;const n=m.clone();n.color.set(value);n.metalness=.52;n.roughness=.40;return n;});
    o.material=Array.isArray(o.material)?next:next[0];
  });
}
/** Small bounded cloth fairing. No deleted faces, no anatomy scaling or torso edits. */
export function fairShoulder(mesh:THREE.Mesh,rings:number,sides:number,torso?:THREE.Mesh,torsoFrame?:THREE.Group,softTeeFront=false) {
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
  // Fair the LIGHTING separately from the silhouette. The sleeve's duplicated
  // UV seam and tight shoulder rings otherwise show as glossy triangular patches.
  const normal=g.getAttribute('normal'),value=new THREE.Vector3();
  for(let pass=0;pass<6;pass++) {
    const prev=Float32Array.from(normal.array as ArrayLike<number>);
    for(let r=1;r<rings;r++) {
      const weight=1-THREE.MathUtils.smoothstep(r/rings,.30,.60);
      if(!weight)continue;
      for(let j=0;j<sides;j++) {
        value.set(0,0,0);
        for(const [row,col,factor] of [[r,j,2],[r-1,j,1],[r+1,j,1],[r,(j+sides-1)%sides,1],[r,(j+1)%sides,1]]) {
          const k=(row*stride+col)*3;
          value.x+=prev[k]*factor;value.y+=prev[k+1]*factor;value.z+=prev[k+2]*factor;
        }
        value.normalize();const i=r*stride+j;
        value.lerp(new THREE.Vector3().fromArray(prev,i*3),1-weight).normalize();
        normal.setXYZ(i,value.x,value.y,value.z);
      }
    }
    for(let r=0;r<=rings;r++) {
      const first=r*stride,last=first+sides;
      value.fromBufferAttribute(normal,first).add(new THREE.Vector3().fromBufferAttribute(normal,last)).normalize();
      normal.setXYZ(first,value.x,value.y,value.z);normal.setXYZ(last,value.x,value.y,value.z);
    }
  }
  normal.needsUpdate=true;
  if(torso && torsoFrame) {
    torsoFrame.updateMatrix();
    const inverse=torsoFrame.matrix.clone().invert();
    const inverseRotation=torsoFrame.quaternion.clone().invert();
    const sample=new THREE.Vector3(),existing=new THREE.Vector3(),shared=new THREE.Vector3();
    // Torso and sleeve are overlapping cloth shells. Smoothing each shell alone
    // still leaves their intersecting edges visible. Shade the upper back from
    // the SAME continuous field, independent of either shell's depth/triangles.
    // Loose tees use the same treatment at the front armhole so the shoulder
    // reads as cloth rather than a separately highlighted deltoid.
    // This modifies normals only; every vertex, UV and bone weight stays intact.
    for(const surface of [torso,mesh]) {
      const position=surface.geometry.getAttribute('position'),normals=surface.geometry.getAttribute('normal');
      for(let i=0;i<position.count;i++) {
        sample.fromBufferAttribute(position,i);
        existing.fromBufferAttribute(normals,i);
        if(surface===mesh) {sample.applyMatrix4(inverse);existing.applyQuaternion(inverseRotation);}
        const face=softTeeFront&&sample.z<0?-1:1;
        const weight=THREE.MathUtils.smoothstep(sample.y,.29,.36)
          *(1-THREE.MathUtils.smoothstep(sample.y,.60,.65))
          *(1-THREE.MathUtils.smoothstep(Math.abs(sample.x),.28,.38))
          *THREE.MathUtils.smoothstep(sample.z*face,.005,.040);
        if(weight<=0)continue;
        shared.set(sample.x*2.5,.10+.72*THREE.MathUtils.smoothstep(sample.y,.45,.62),face).normalize();
        existing.lerp(shared,weight).normalize();
        if(surface===mesh)existing.applyQuaternion(torsoFrame.quaternion);
        normals.setXYZ(i,existing.x,existing.y,existing.z);
      }
      normals.needsUpdate=true;
    }
  }
  for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material]) {
    if(m instanceof THREE.MeshStandardMaterial) {m.roughness=1;m.metalness=0;m.envMapIntensity=0;}
  }
}
export function blackSprings(body:THREE.Group){
  const names=new Set(['rear-shock-spring','fork-stanchion','fork-dust-seal']);
  body.traverse(o=>{if(!(o instanceof THREE.Mesh)||!names.has(o.name))return;
    const tint=(m:THREE.Material)=>{if(!(m instanceof THREE.MeshStandardMaterial))return m;const n=m.clone();n.color.set('#151515');n.metalness=.10;n.roughness=.86;return n;};
    o.material=Array.isArray(o.material)?o.material.map(tint):tint(o.material);
  });
}
/** Apply the requested model-specific black hardware and livery-color shock coils. */
export function finishRequestedModelParts(
  body: THREE.Group,
  model: string,
  paintColor: THREE.ColorRepresentation,
) {
  const black = (source: THREE.Material): THREE.Material => {
    if (!(source instanceof THREE.MeshStandardMaterial)) return source;
    const next = source.clone();
    next.color.set('#101214');
    next.metalness = 0.16;
    next.roughness = 0.72;
    return next;
  };
  const blackNames =
    model === '450'
      ? new Set(['box-section-swingarm', 'supermoto-handlebar'])
      : model === '125' || model === '701'
        ? new Set([
            'telescopic-fork-slider',
            'fork-stanchion',
            'fork-yoke',
            'fork-yoke-collar',
          ])
        : new Set<string>();
  const springNames = new Set([
    'rear-shock-spring',
    'sport-rear-shock-spring',
    'scooter-rear-spring',
  ]);
  body.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const isPeg = model === '450' && object.name.startsWith('supermoto-footpeg-');
    if (blackNames.has(object.name) || isPeg) {
      object.material = Array.isArray(object.material)
        ? object.material.map(black)
        : black(object.material);
    }
    if (!springNames.has(object.name)) return;
    const finishSpring = (source: THREE.Material): THREE.Material => {
      if (!(source instanceof THREE.MeshStandardMaterial)) return source;
      const finish = source.clone();
      finish.color.set(paintColor);
      finish.metalness = Math.max(0.3, finish.metalness);
      finish.roughness = Math.min(0.48, finish.roughness);
      return finish;
    };
    object.material = Array.isArray(object.material)
      ? object.material.map(finishSpring)
      : finishSpring(object.material);
  });
}
/** Keep the ORIGINAL materials: cloning detaches them from the glow registry and async ink loaders. */
const wardrobeTinted=new WeakSet<THREE.MeshStandardMaterial>();
export function darkenWardrobe(root:THREE.Object3D,factor=.82){
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
