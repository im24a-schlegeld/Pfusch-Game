import * as THREE from 'three';
export function headerBagMaterial(path:string, source:THREE.MeshStandardMaterial){
  const mat=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.94,metalness:0});
  if(typeof document==='undefined')return mat;
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=640;
  const c=canvas.getContext('2d');if(!c)return mat;
  c.fillStyle='#202124';c.fillRect(0,0,512,640);
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;mat.map=map;
  let disposed=false;mat.addEventListener('dispose',()=>{disposed=true;map.dispose();});
  if(typeof Image!=='undefined'){
    const im=new Image();im.onload=()=>{
      if(disposed)return;
      const scratch=document.createElement('canvas');scratch.width=im.naturalWidth;scratch.height=im.naturalHeight;
      const ctx=scratch.getContext('2d',{willReadFrequently:true});if(!ctx)return;ctx.drawImage(im,0,0);
      const data=ctx.getImageData(0,0,scratch.width,scratch.height).data;
      let l=scratch.width,r=0,t=scratch.height,b=0;
      for(let y=0;y<scratch.height;y++)for(let x=0;x<scratch.width;x++)if(data[(y*scratch.width+x)*4+3]>32){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);}
      if(r<=l||b<=t)return;
      const k=Math.min(382/(r-l+1),292/(b-t+1)),w=(r-l+1)*k,h=(b-t+1)*k;
      c.drawImage(im,l,t,r-l+1,b-t+1,(512-w)/2,336-h/2,w,h);map.needsUpdate=true;
    };im.src=path;
  }
  return mat;
}
export function flatPouchGeometry(){
  const s=new THREE.Shape();
  s.moveTo(-.074,-.102);s.quadraticCurveTo(-.094,-.094,-.096,-.070);s.lineTo(-.094,.058);
  s.quadraticCurveTo(-.093,.086,-.070,.096);s.lineTo(.064,.094);s.quadraticCurveTo(.089,.090,.094,.065);
  s.lineTo(.098,-.066);s.quadraticCurveTo(.098,-.090,.076,-.098);s.lineTo(-.045,-.104);s.quadraticCurveTo(-.060,-.105,-.074,-.102);
  const g=new THREE.ExtrudeGeometry(s,{depth:.040,bevelEnabled:true,bevelThickness:.0032,bevelSize:.004,bevelSegments:3,steps:1,curveSegments:14});
  g.translate(0,0,-.024);
  const p=g.getAttribute('position'),uv=g.getAttribute('uv');
  for(let i=0;i<p.count;i++)uv.setXY(i,.5+p.getX(i)/.205,(p.getY(i)+.115)/.230);
  for(let i=0;i<p.count;i++){
    const y=p.getY(i),z=p.getZ(i),bulge=(1-Math.min(1,Math.abs(y)/.115))*.008;
    p.setZ(i,z+(z>0?bulge:-bulge*.35));
  }
  g.computeVertexNormals();return g;
}
