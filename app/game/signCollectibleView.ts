import * as THREE from 'three';
import {SIGN_IDS,type SignId} from './signCollectibles';
import {loadOriginalSignArtwork} from './signArtwork';
interface SignViewState {active:boolean;id:SignId;lane:number;z:number}
export function makeSignCollectibleView(capacity:number,laneWidth:number,_low=false){
  const root=new THREE.Group();root.name='sign-collectibles';let disposed=false,ready=false;
  const geometries:THREE.BufferGeometry[]=[],materials:THREE.Material[]=[],textures:THREE.Texture[]=[];
  const slots=Array.from({length:capacity},(_,i)=>{const group=new THREE.Group();group.name=`sign-pickup-${i}`;group.visible=false;root.add(group);return group;});
  loadOriginalSignArtwork().then(art=>{
    if(disposed)return;
    for(const piece of art){
      const texture=new THREE.CanvasTexture(piece.canvas);texture.colorSpace=THREE.SRGBColorSpace;textures.push(texture);
      const g=new THREE.PlaneGeometry(1.06*piece.canvas.width/piece.canvas.height,1.06);geometries.push(g);
      materials.push(new THREE.MeshBasicMaterial({map:texture,alphaTest:.06,side:THREE.DoubleSide,toneMapped:false}));
    }
    ready=true;
  }).catch(e=>{if(!disposed)console.error(e);});
  return {root,update(signs:readonly SignViewState[],elapsed:number){
    for(let i=0;i<slots.length;i++){
      const g=slots[i],s=signs[i];g.visible=!!s?.active&&ready&&!disposed;if(!g.visible)continue;const index=SIGN_IDS.indexOf(s.id);
      if(g.userData.signId!==s.id){g.clear();const mesh=new THREE.Mesh(geometries[index],materials[index]);mesh.name='sign-original-artwork';g.add(mesh);g.userData.signId=s.id;}
      g.position.set(s.lane*laneWidth,1.34+Math.sin(elapsed*2+i*.7)*.05,-s.z);g.rotation.set(-.08,0,0);
    }
  },dispose(){if(disposed)return;disposed=true;root.removeFromParent();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());}};
}
