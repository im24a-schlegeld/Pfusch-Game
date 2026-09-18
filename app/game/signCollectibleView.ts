import * as THREE from 'three';
import {SIGN_IDS,type SignId} from './signCollectibles';
import {loadSignArtwork} from './signArtwork';
interface SignViewState {active:boolean;id:SignId;lane:number;z:number}
/** Exact alpha silhouettes, not bitmap UVs squeezed into mismatching circle geometry. */
export function makeSignCollectibleView(capacity:number,laneWidth:number,low=false){
  const root=new THREE.Group();root.name='sign-collectibles';let disposed=false,ready=false;
  const geometries:THREE.BufferGeometry[]=[],materials:THREE.Material[]=[],textures:THREE.Texture[]=[];
  const slots=Array.from({length:capacity},(_,i)=>{const group=new THREE.Group();group.name=`sign-pickup-${i}`;group.visible=false;root.add(group);return group;});
  loadSignArtwork().then(art=>{
    if(disposed)return;
    for(let i=0;i<6;i++){
      const canvas=document.createElement('canvas'),w=art.cuts[i+1]-art.cuts[i];canvas.width=w;canvas.height=art.height;
      canvas.getContext('2d')!.drawImage(art.image,art.cuts[i],0,w,art.height,0,0,w,art.height);
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;textures.push(texture);
      const g=new THREE.PlaneGeometry(1.08*w/art.height,1.08);geometries.push(g);
      materials.push(new THREE.MeshBasicMaterial({map:texture,alphaTest:.08,side:THREE.DoubleSide,toneMapped:false}));
    }ready=true;
  }).catch(e=>{if(!disposed)console.error(e);});
  return {root,update(signs:readonly SignViewState[],elapsed:number){
    for(let i=0;i<slots.length;i++){const g=slots[i],s=signs[i];g.visible=!!s?.active&&ready&&!disposed;if(!g.visible)continue;const index=SIGN_IDS.indexOf(s.id);
      if(g.userData.signId!==s.id){g.clear();const mesh=new THREE.Mesh(geometries[index],materials[index]);mesh.name='sign-original-artwork';g.add(mesh);g.userData.signId=s.id;}
      g.position.set(s.lane*laneWidth,1.36+Math.sin(elapsed*2.1+i*.8)*.07,-s.z);g.rotation.set(-.1,0,0);
    }
  },dispose(){disposed=true;root.removeFromParent();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());}};
}
