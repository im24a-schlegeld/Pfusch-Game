import * as THREE from 'three';
/** A flat logo panel uses the header bitmap itself, not the photographed bag UVs. */
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
      const k=Math.min(378/(r-l+1),310/(b-t+1)),w=(r-l+1)*k,h=(b-t+1)*k;
      c.drawImage(im,l,t,r-l+1,b-t+1,(512-w)/2,340-h/2,w,h);map.needsUpdate=true;
    };im.src=path;
  }
  return mat;
}
export function flatPouchGeometry(){
  const s=new THREE.Shape();const w=.092,h=.114,r=.016;
  s.moveTo(-w+r,-h);s.lineTo(w-r,-h);s.quadraticCurveTo(w,-h,w,-h+r);s.lineTo(w,h-r);s.quadraticCurveTo(w,h,w-r,h);s.lineTo(-w+r,h);s.quadraticCurveTo(-w,h,-w,h-r);s.lineTo(-w,-h+r);s.quadraticCurveTo(-w,-h,-w+r,-h);
  const g=new THREE.ExtrudeGeometry(s,{depth:.054,bevelEnabled:true,bevelThickness:.005,bevelSize:.005,bevelSegments:3,steps:1,curveSegments:10});g.translate(0,0,-.032);
  const p=g.getAttribute('position'),uv=g.getAttribute('uv');for(let i=0;i<p.count;i++)uv.setXY(i,p.getZ(i)<0?.5-p.getX(i)/.194:.5+p.getX(i)/.194,(p.getY(i)+.119)/.238);
  g.computeVertexNormals();return g;
}
