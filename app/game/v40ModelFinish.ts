import {TUBE_EXHAUST, SUPERMOTO_EXHAUST_OUTLET, SUPERMOTO_EXHAUST_TANGENT} from './exhaustClearance';
import * as THREE from 'three';
type P = [number, number, number];
function add(root: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, name: string) {
  g.computeVertexNormals(); const mesh = new THREE.Mesh(g,m);mesh.name=name;
  mesh.castShadow=mesh.receiveShadow=true;root.add(mesh);return mesh;
}
function color(hex:string, metalness=0, roughness=.75) {return new THREE.MeshStandardMaterial({color:hex,metalness,roughness});}
function tube(root:THREE.Object3D, points:P[], radius:number, mat:THREE.Material, name:string, segments=40) {
  const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)),false,'centripetal');
  return add(root,new THREE.TubeGeometry(curve,segments,radius,12,false),mat,name);
}
function _panel(root:THREE.Object3D, vertices:number[], indices:number[], mat:THREE.Material,name:string) {
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);
  return add(root,g,mat,name);
}
function _clonePaint(base:THREE.MeshStandardMaterial){const m=base.clone();m.side=THREE.DoubleSide;return m;}
/** A formed alloy can and continuous four-stroke header, fitted beside the liner. */
export function fitRearExitExhaust(body:THREE.Group, _paint:THREE.MeshStandardMaterial) {
  if(body.getObjectByName('v42-tube-exhaust'))return;
  const names=new Set(['single-exhaust','exhaust-mount-band','exhaust-frame-hanger','open-silencer-outlet','connected-exhaust-pipe']);
  const old:THREE.Mesh[]=[];
  body.traverse(o=>{if(o instanceof THREE.Mesh&&names.has(o.name))old.push(o);});
  if(old.length!==5)throw new Error(`Expected the five original Supermoto exhaust parts, got ${old.length}`);
  old.forEach(o=>{o.removeFromParent();o.geometry.dispose();});
  const e=TUBE_EXHAUST,group=new THREE.Group();group.name='v42-tube-exhaust';body.add(group);
  const silver=color('#a4a6a3',.72,.36),carbon=color('#303334',.36,.56),inner=color('#101213',.08,.96);
  inner.side=THREE.DoubleSide;
  const headerFinish=color('#827768',.70,.38);
  const a=new THREE.Vector3(e.x,e.startY,e.startZ),b=new THREE.Vector3(e.x,e.endY,e.endZ);
  const axis=b.clone().sub(a).normalize(),len=a.distanceTo(b);
  const orient=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),axis);
  // Each ring is (lateral radius, vertical radius, distance along the can).
  // Independent radii retain the pressed oval shell and a circular outlet.
  const ovalShell=(profile:P[],closed=false)=>{
    const positions:number[]=[],indices:number[]=[],sides=32;
    for(const [rx,rz,y] of profile)for(let side=0;side<sides;side++){
      const angle=side/sides*Math.PI*2;
      positions.push(Math.cos(angle)*rx,y,Math.sin(angle)*rz);
    }
    for(let row=0;row<profile.length-(closed?0:1);row++)for(let side=0;side<sides;side++){
      const i=row*sides+side,j=((row+1)%profile.length)*sides+side;
      const next=row*sides+(side+1)%sides;
      const nextRow=((row+1)%profile.length)*sides+(side+1)%sides;
      indices.push(i,j,next,next,j,nextRow);
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setIndex(indices);geometry.computeVertexNormals();
    return geometry;
  };
  const shell=ovalShell([
    [.0185,.0185,-.008],[.021,.021,0],[.027,.032,.030],[e.radius,e.verticalRadius,.075],
    [e.radius,e.verticalRadius,len-.067],[e.radius-.002,e.verticalRadius-.004,len-.032],
    [.0255,.0255,len-.032],[.0185,.0185,.012],
  ],true);
  const can=add(group,shell,silver,'single-exhaust');can.position.copy(a);can.quaternion.copy(orient);
  const capGeometry=ovalShell([
    [e.radius+.001,e.verticalRadius+.001,len-.069],
    [e.radius-.001,e.verticalRadius-.003,len-.032],[.030,.036,len-.009],
    [.030,.033,len+.009],[.031,.031,len+.015],
    [.026,.026,len+.015],[.026,.026,len-.059],
  ],true);
  const cap=add(group,capGeometry,carbon,'open-silencer-outlet');cap.position.copy(a);cap.quaternion.copy(orient);
  const bore=add(group,new THREE.CylinderGeometry(.0255,.0255,.067,32,1,true),inner,'silencer-inner-bore');
  bore.quaternion.copy(orient);bore.position.copy(b).addScaledVector(axis,-.019);
  const boreBack=add(group,new THREE.CircleGeometry(.0255,32),inner,'silencer-bore-depth');
  boreBack.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),axis);
  boreBack.position.copy(b).addScaledVector(axis,-.053);
  const endRing=add(group,new THREE.TorusGeometry(.028,.0028,8,32),silver,'silencer-outlet-ring');
  endRing.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),axis);endRing.position.copy(b).addScaledVector(axis,.015);
  const bandAt=len*.53;
  const band=add(group,ovalShell([
    [e.radius+.0015,e.verticalRadius+.0015,bandAt-.011],[e.radius+.0015,e.verticalRadius+.0015,bandAt+.011],
  ]),carbon,'exhaust-mount-band');
  band.quaternion.copy(orient);band.position.copy(a);
  // Short forward overhang and a rounded downward return below the radiator.
  // Exit forward through the gap between both cradle rails. Only beyond the
  // front of the cradle does the compact return sweep outward. The rear
  // section stays behind both main and rear braces. A formed final elbow
  // enters the shortened front neck along the unchanged silencer axis.
  const headerPoints:P[]=[
    [...SUPERMOTO_EXHAUST_OUTLET],
    SUPERMOTO_EXHAUST_OUTLET.map((value,index)=>value+SUPERMOTO_EXHAUST_TANGENT[index]) as P,
    [.015,.530,-.320],[.075,.514,-.325],[.143,.528,-.294],
    [.164,.570,-.212],[.171,.658,-.150],[.160,.668,-.085],[.118,.669,-.010],
    [.081,.667,.075],[.078,.677,.200],
  ];
  const headerCurve=new THREE.CurvePath<THREE.Vector3>();
  headerCurve.add(new THREE.CatmullRomCurve3(headerPoints.map(p=>new THREE.Vector3(...p)),false,'centripetal'));
  headerCurve.add(new THREE.CubicBezierCurve3(
    new THREE.Vector3(...headerPoints[headerPoints.length-1]),
    new THREE.Vector3(.077,.681,.247),
    new THREE.Vector3(.087,.746,.302),
    new THREE.Vector3(.078,.751,.330),
  ));
  headerCurve.add(new THREE.CubicBezierCurve3(
    new THREE.Vector3(.078,.751,.330),
    new THREE.Vector3(.069,.756,.358),
    new THREE.Vector3(.046,.748,.371),
    new THREE.Vector3(.040,.748,.401),
  ));
  headerCurve.add(new THREE.CubicBezierCurve3(
    new THREE.Vector3(.040,.748,.401),
    new THREE.Vector3(.034,.748,.431),
    a.clone().addScaledVector(axis,-.030),
    a.clone(),
  ));
  add(group,new THREE.TubeGeometry(headerCurve,80,.0185,12,false),headerFinish,'connected-exhaust-pipe');
  const bandTop=new THREE.Vector3(0,bandAt,-e.verticalRadius-.002).applyQuaternion(orient).add(a);
  // Read the real upper subframe rod so a shortened tail cannot leave the
  // hanger's upper eye suspended between the two frame rails.
  const upperRail=body.getObjectsByProperty('name','supermoto-upper-subframe')
    .find(part=>part.position.x>0) as THREE.Mesh<THREE.CylinderGeometry>;
  const halfRail=upperRail.geometry.parameters.height/2;
  const railStart=new THREE.Vector3(0,-halfRail,0).applyQuaternion(upperRail.quaternion).add(upperRail.position);
  const railEnd=new THREE.Vector3(0,halfRail,0).applyQuaternion(upperRail.quaternion).add(upperRail.position);
  const hangerTop=railStart.clone().lerp(railEnd,THREE.MathUtils.clamp((bandTop.z-railStart.z)/(railEnd.z-railStart.z),0,1));
  tube(group,[hangerTop.toArray() as P,[.040,hangerTop.y-.022,bandTop.z],[.040,bandTop.y+.017,bandTop.z],bandTop.toArray() as P],.0075,carbon,'exhaust-frame-hanger');
  // Small, real joints at the outlet and bracket make the separated surfaces
  // legible without adding heavy decorative geometry to the running game.
  for(const fraction of [.13,.83]){
    const bead=add(group,new THREE.TorusGeometry(.019,.0013,6,20),silver,'header-weld');
    const curve=(group.getObjectByName('connected-exhaust-pipe') as THREE.Mesh<THREE.TubeGeometry>).geometry.parameters.path;
    bead.position.copy(curve.getPointAt(fraction));
    bead.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),curve.getTangentAt(fraction));
  }
  const liner=body.getObjectByName('supermoto-under-tail-liner');
  if(liner)liner.userData.exhaustChannelRaised=1;
  group.userData.sideCutouts=0;group.userData.boxPanels=0;
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
