import { SIGN_COLLECTIBLES, type SignCollectibleDefinition } from './signCollectibles';
export interface SignPiece {canvas:HTMLCanvasElement;dim:HTMLCanvasElement;x:number;y:number;width:number;height:number}
export interface SignArtwork {image:HTMLCanvasElement;dim:HTMLCanvasElement;pieces:SignPiece[];width:number;height:number;fallbacks:number}
let cached:Promise<SignArtwork>|undefined;
const makeCanvas=(w:number,h:number)=>{const c=document.createElement('canvas');c.width=Math.max(1,Math.ceil(w));c.height=Math.max(1,Math.ceil(h));return c;};
function context(c:HTMLCanvasElement){const x=c.getContext('2d',{willReadFrequently:true});if(!x)throw new Error('Canvas 2D unavailable');return x;}
function load(path:string):Promise<HTMLImageElement>{
  return new Promise((resolve,reject)=>{
    const im=new Image();const timer=setTimeout(()=>{im.onload=im.onerror=null;reject(new Error('Sign timeout: '+path));},8000);
    im.onload=()=>{clearTimeout(timer);resolve(im);};im.onerror=()=>{clearTimeout(timer);reject(new Error('Sign unavailable: '+path));};
    im.src=path;
  });
}
function boundary(ctx:CanvasRenderingContext2D,d:SignCollectibleDefinition,w:number,h:number){
  ctx.beginPath();
  if(d.shape==='circle')ctx.ellipse(w/2,h/2,w/2,h/2,0,0,Math.PI*2);
  else if(d.shape==='triangle'){ctx.moveTo(w/2,0);ctx.lineTo(w,h);ctx.lineTo(0,h);ctx.closePath();}
  else if(d.shape==='rounded-square'){
    const r=Math.min(w,h)*.045;ctx.moveTo(r,0);ctx.lineTo(w-r,0);ctx.quadraticCurveTo(w,0,w,r);ctx.lineTo(w,h-r);ctx.quadraticCurveTo(w,h,w-r,h);ctx.lineTo(r,h);ctx.quadraticCurveTo(0,h,0,h-r);ctx.lineTo(0,r);ctx.quadraticCurveTo(0,0,r,0);
  } else ctx.rect(0,0,w,h);
}
function grayscale(source:HTMLCanvasElement){
  const c=makeCanvas(source.width,source.height),ctx=context(c);ctx.drawImage(source,0,0);
  const p=ctx.getImageData(0,0,c.width,c.height);
  for(let i=0;i<p.data.length;i+=4){const g=Math.round(18+.22*(p.data[i]*.2126+p.data[i+1]*.7152+p.data[i+2]*.0722));p.data[i]=p.data[i+1]=p.data[i+2]=g;}
  ctx.putImageData(p,0,0);return c;
}
async function original(d:SignCollectibleDefinition){
  let im:HTMLImageElement|undefined;try{im=await load(d.asset);}catch{}
  const [l,b,r,t]=d.crop;
  const naturalW=im?.naturalWidth??d.sourceSize[0],naturalH=im?.naturalHeight??d.sourceSize[1];
  const rawW=(r-l)*naturalW,rawH=(t-b)*naturalH,k=Math.min(1,384/Math.max(rawW,rawH));
  const c=makeCanvas(rawW*k,rawH*k),ctx=context(c);
  ctx.save();boundary(ctx,d,c.width,c.height);ctx.clip();
  if(im)ctx.drawImage(im,l*naturalW,(1-t)*naturalH,rawW,rawH,0,0,c.width,c.height);
  else {
    ctx.fillStyle='#3b4144';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#f0f0ec';ctx.font=`bold ${c.height*.62}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(d.id,c.width/2,c.height/2);
  }
  ctx.restore();
  const angle=-d.rotation,co=Math.abs(Math.cos(angle)),si=Math.abs(Math.sin(angle));
  const out=makeCanvas(c.width*co+c.height*si+4,c.width*si+c.height*co+4),o=context(out);
  o.translate(out.width/2,out.height/2);o.rotate(angle);o.drawImage(c,-c.width/2,-c.height/2);
  return {canvas:out,fallback:!im};
}

/**
 * Fixed reference layout.
 *
 * The coordinates are scaled directly from the supplied 1401x466 PFUSCH sign
 * composition to a 660x220 HUD canvas. There is no per-letter maxW/maxH auto-fit.
 *
 * Reference layer order: P -> F -> S -> U -> C -> H.
 */
export function loadSignArtwork():Promise<SignArtwork>{
  if(cached)return cached;
  cached=Promise.all(SIGN_COLLECTIBLES.map(original)).then(loaded=>{
    const width=660,height=220,image=makeCanvas(width,height),ctx=context(image);

    const layout=[
      {x:0,   y:49, w:163, h:163}, // P, partly covered by F
      {x:110, y:49, w:153, h:153}, // F
      {x:219, y:53, w:133, h:133}, // U
      {x:298, y:16, w:155, h:196}, // S triangle behind U/C
      {x:414, y:38, w:142, h:142}, // C
      {x:522, y:32, w:136, h:136}, // H
    ] as const;

    const pieces=loaded.map(({canvas},i)=>{
      const target=layout[i];
      const piece=makeCanvas(target.w,target.h);
      context(piece).drawImage(canvas,0,0,piece.width,piece.height);
      return {
        canvas:piece,
        dim:grayscale(piece),
        x:target.x,
        y:target.y,
        width:piece.width,
        height:piece.height,
      };
    });

    for(const i of [0,1,3,2,4,5]){
      const p=pieces[i];
      ctx.drawImage(p.canvas,p.x,p.y);
    }

    return {
      image,
      dim:grayscale(image),
      pieces,
      width,
      height,
      fallbacks:loaded.filter(s=>s.fallback).length,
    };
  }).catch(e=>{cached=undefined;throw e;});
  return cached;
}
