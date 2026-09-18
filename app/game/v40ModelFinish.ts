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
/** Replaces the complete Supermoto exhaust as a connected assembly. Side bodywork stays uncut. */
export function fitRearExitExhaust(body:THREE.Group, paint:THREE.MeshStandardMaterial) {
  if(body.getObjectByName('v40-rear-exhaust'))return;
  const names=new Set(['single-exhaust','exhaust-mount-band','exhaust-frame-hanger','open-silencer-outlet','connected-exhaust-pipe']);
  const old:THREE.Object3D[]=[];body.traverse(o=>{if(names.has(o.name))old.push(o);});
  if(old.length!==5)throw new Error(`Supermoto exhaust: expected five original parts, got ${old.length}`);
  for(const o of old){o.removeFromParent();if(o instanceof THREE.Mesh){o.geometry.dispose();/* old shared materials stay alive */}}
  const group=new THREE.Group();group.name='v40-rear-exhaust';body.add(group);
  const metal=color('#596169',.72,.38), dark=color('#151719',.25,.75);
  // Tucked inside the original side covers. The end points rearward (+Z).
  const x=.080, y=.942, rear=.852;
  tube(group,[[.045,.724,-.234],[.105,.699,-.245],[.143,.674,-.163],[.105,.687,.07],[.088,.749,.31],[x,.903,.49]],.020,metal,'connected-exhaust-pipe');
  const length=.343;
  const can=add(group,new THREE.CylinderGeometry(.034,.030,length,20,1,true),metal,'single-exhaust');
  can.rotation.x=Math.PI/2;can.position.set(x,y-.018,rear-length/2);
  // A real cavity/open rear lip, no painted black disc and no lateral opening.
  const bore=new THREE.LatheGeometry([new THREE.Vector2(.034,-.075),new THREE.Vector2(.034,0),new THREE.Vector2(.037,.004),new THREE.Vector2(.025,.005),new THREE.Vector2(.024,-.076)],32);
  bore.rotateX(Math.PI/2);const mouth=add(group,bore,dark,'open-silencer-outlet');mouth.position.set(x,y,rear);
  tube(group,[[x,.904,.49],[x,.924,.61],[x,y,.782]],.030,metal,'exhaust-upper-connector');
  // Rear-facing recessed socket. Radial quads make the opening genuine geometry.
  const verts:number[]=[],ix:number[]=[];const segments=48;
  for(let row=0;row<3;row++) for(let j=0;j<=segments;j++){
    const a=j/segments*Math.PI*2, c=Math.cos(a),s=Math.sin(a);
    const r=row===0?.040:row===1?.044:.053;
    verts.push(x+c*r,y+s*r,rear+(row===0?-.033:row===1?.007:0));
  }
  for(let r=0;r<2;r++)for(let j=0;j<segments;j++){const a=r*(segments+1)+j,b=a+segments+1;ix.push(a,a+1,b,a+1,b+1,b);}
  const outer=paint.clone();outer.side=THREE.DoubleSide;panel(group,verts,ix,outer,'rear-only-exhaust-recess');
  const rearShape=new THREE.Shape();rearShape.moveTo(-.139,.89);rearShape.lineTo(.139,.89);rearShape.lineTo(.139,1.014);rearShape.lineTo(-.139,1.014);rearShape.closePath();
  const hole=new THREE.Path();hole.absarc(x,y,.040,0,Math.PI*2,true);rearShape.holes.push(hole);
  const cap=add(group,new THREE.ExtrudeGeometry(rearShape,{depth:.008,bevelEnabled:false,curveSegments:32}),outer,'rear-panel-with-exhaust-opening');cap.position.z=rear-.006;
  // Paint cheek panels conceal the silencer in exact side elevation, without
  // modifying the original side-cover polygons or creating side cut-outs.
  for(const side of [-1,1]){
    const xx=side*.139;
    panel(group,[xx,.89,.50,xx,1.005,.50,xx,1.028,.86,xx,.89,.86],[0,1,2,0,2,3],outer,'closed-undertail-cheek');
  }
  tube(group,[[.11,.986,.54],[x,.965,.54]],.008,dark,'exhaust-frame-hanger');
  group.userData.outletDirection='+Z';group.userData.sideCutouts=0;
}
/** Color actual barrel/spokes, not brakes or tires. Clone shared materials. */
export function finishWheelColors(body:THREE.Group, value:string) {
  const accepted=new Set(['formed-rim-barrel','cross-laced-spokes','cast-y-spoke']);
  body.traverse(o=>{if(o instanceof THREE.Mesh&&(accepted.has(o.name)||(o.parent?.name.endsWith('-wheel') && o.geometry instanceof THREE.CylinderGeometry && o.geometry.parameters.radiusTop===.055))){
    const mats=Array.isArray(o.material)?o.material:[o.material];
    const next=mats.map(m=>{if(!(m instanceof THREE.MeshStandardMaterial))return m;const n=m.clone();n.color.set(value);n.metalness=.48;n.roughness=.44;return n;});
    o.material=Array.isArray(o.material)?next:next[0];
  }});
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
/** Explicit existing mesh names; never recolor the shared engine/alloy material. */
export function blackSprings(body:THREE.Group){
  const names=new Set(['rear-shock-spring','fork-stanchion','fork-dust-seal']);
  body.traverse(o=>{if(!(o instanceof THREE.Mesh)||!names.has(o.name))return;
    const tint=(m:THREE.Material)=>{if(!(m instanceof THREE.MeshStandardMaterial))return m;const n=m.clone();n.color.set('#141414');n.metalness=.12;n.roughness=.82;return n;};
    o.material=Array.isArray(o.material)?o.material.map(tint):tint(o.material);
  });
}
