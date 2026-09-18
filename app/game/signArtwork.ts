export interface SignPiece {canvas: HTMLCanvasElement; dim: HTMLCanvasElement; x: number; y: number; width: number; height: number}
export interface SignArtwork {image: HTMLCanvasElement; dim: HTMLCanvasElement; pieces: SignPiece[]; width:number; height:number}
let cached:Promise<SignArtwork>|undefined;
function toGrey(src:HTMLCanvasElement){
  const out=document.createElement('canvas');out.width=src.width;out.height=src.height;
  const ctx=out.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(src,0,0);
  const data=ctx.getImageData(0,0,out.width,out.height);
  for(let i=0;i<data.data.length;i+=4){
    const grey=Math.round(20+.22*(data.data[i]*.2126+data.data[i+1]*.7152+data.data[i+2]*.0722));
    data.data[i]=data.data[i+1]=data.data[i+2]=grey;
  }
  ctx.putImageData(data,0,0);return out;
}
export function loadSignArtwork():Promise<SignArtwork>{
  if(cached)return cached;
  cached=new Promise((resolve,reject)=>{
    const im=new Image();
    im.onerror=()=>{cached=undefined;reject(new Error('Hoodie-Schildergrafik nicht geladen'));};
    im.onload=()=>{
      try{
        const source=document.createElement('canvas');
        const k=Math.min(1,960/im.naturalWidth);
        source.width=Math.round(im.naturalWidth*k);source.height=Math.round(im.naturalHeight*k);
        const sctx=source.getContext('2d',{willReadFrequently:true})!;
        sctx.drawImage(im,0,0,source.width,source.height);
        const src=sctx.getImageData(0,0,source.width,source.height);
        let l=source.width,r=0,t=source.height,b=0;
        for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++)if(src.data[(y*source.width+x)*4+3]>24){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);}
        if(r<=l||b<=t)throw new Error('Leere Schildergrafik');
        const image=document.createElement('canvas');image.width=r-l+1;image.height=b-t+1;
        image.getContext('2d')!.drawImage(source,l,t,image.width,image.height,0,0,image.width,image.height);
        const ictx=image.getContext('2d',{willReadFrequently:true})!;
        const data=ictx.getImageData(0,0,image.width,image.height);
        const alpha=(x:number,y:number)=>data.data[(y*image.width+x)*4+3];
        const seen=new Uint8Array(image.width*image.height);
        const components:{x0:number;y0:number;x1:number;y1:number;pixels:[number,number][]}[]=[];
        for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
          const index=y*image.width+x;
          if(seen[index]||alpha(x,y)<=24)continue;
          const queue:[number,number][]=[[x,y]];seen[index]=1;
          const pixels:[number,number][]=[];let x0=x,y0=y,x1=x,y1=y;
          while(queue.length){
            const [cx,cy]=queue.pop()!;pixels.push([cx,cy]);x0=Math.min(x0,cx);y0=Math.min(y0,cy);x1=Math.max(x1,cx);y1=Math.max(y1,cy);
            for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){
              const nx=cx+dx, ny=cy+dy;
              if(nx<0||ny<0||nx>=image.width||ny>=image.height)continue;
              const ni=ny*image.width+nx;
              if(seen[ni]||alpha(nx,ny)<=24)continue;
              seen[ni]=1;queue.push([nx,ny]);
            }
          }
          if((x1-x0+1)*(y1-y0+1)>=32)components.push({x0,y0,x1,y1,pixels});
        }
        components.sort((a,b)=>a.x0-b.x0);
        if(components.length!==6)throw new Error(`Erwartet 6 Schild-Komponenten, gefunden ${components.length}`);
        const pieces=components.map(c=>{
          const canvas=document.createElement('canvas');canvas.width=c.x1-c.x0+1;canvas.height=c.y1-c.y0+1;
          const ctx=canvas.getContext('2d')!;
          const slice=ctx.createImageData(canvas.width,canvas.height);
          for(const [px,py] of c.pixels){
            const srcIndex=(py*image.width+px)*4, dstIndex=((py-c.y0)*canvas.width+(px-c.x0))*4;
            slice.data[dstIndex]=data.data[srcIndex];slice.data[dstIndex+1]=data.data[srcIndex+1];slice.data[dstIndex+2]=data.data[srcIndex+2];slice.data[dstIndex+3]=data.data[srcIndex+3];
          }
          ctx.putImageData(slice,0,0);
          const dim=toGrey(canvas);
          return {canvas,dim,x:c.x0,y:c.y0,width:canvas.width,height:canvas.height};
        });
        resolve({image,dim:toGrey(image),pieces,width:image.width,height:image.height});
      }catch(e){cached=undefined;reject(e);}
    };
    im.src='/images/artwork/signs.png';
  });
  return cached;
}
