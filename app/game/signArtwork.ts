export interface SignArtwork {image:HTMLCanvasElement;dim:HTMLCanvasElement;cuts:number[];width:number;height:number}
let cached:Promise<SignArtwork>|undefined;
/** One source of truth for HUD AND pickups: the original hoodie print, with no extra rotation. */
export function loadSignArtwork():Promise<SignArtwork>{
  if(cached)return cached;
  cached=new Promise((resolve,reject)=>{
    const im=new Image();im.onerror=()=>{cached=undefined;reject(new Error('Hoodie-Schildergrafik nicht geladen'));};im.onload=()=>{
      try{
        const c=document.createElement('canvas');const k=Math.min(1,960/im.naturalWidth);c.width=Math.round(im.naturalWidth*k);c.height=Math.round(im.naturalHeight*k);
        const ctx=c.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(im,0,0,c.width,c.height);const a=ctx.getImageData(0,0,c.width,c.height);
        let l=c.width,r=0,t=c.height,b=0;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(a.data[(y*c.width+x)*4+3]>24){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);}
        if(r<=l)throw new Error('Leere Schildergrafik');
        const image=document.createElement('canvas');image.width=r-l+1;image.height=b-t+1;image.getContext('2d')!.drawImage(c,l,t,image.width,image.height,0,0,image.width,image.height);
        const pixels=image.getContext('2d')!.getImageData(0,0,image.width,image.height),columns=new Float32Array(image.width);
        for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)columns[x]+=pixels.data[(y*image.width+x)*4+3]/255;
        const cuts=[0];for(let i=1;i<6;i++){
          const ideal=image.width*i/6,lo=Math.max(cuts[i-1]+1,Math.floor(ideal-image.width*.06)),hi=Math.min(image.width-1,Math.ceil(ideal+image.width*.06));
          let best=lo,cost=Infinity;for(let x=lo;x<=hi;x++){const v=columns[x]+Math.abs(x-ideal)*.06;if(v<cost){cost=v;best=x;}}cuts.push(best);
        }cuts.push(image.width);
        const dim=document.createElement('canvas');dim.width=image.width;dim.height=image.height;
        for(let i=0;i<pixels.data.length;i+=4){const grey=Math.round(17+.22*(pixels.data[i]*.2126+pixels.data[i+1]*.7152+pixels.data[i+2]*.0722));pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=grey;}
        dim.getContext('2d')!.putImageData(pixels,0,0);resolve({image,dim,cuts,width:image.width,height:image.height});
      }catch(e){cached=undefined;reject(e);}
    };im.src='/images/artwork/signs.png';
  });return cached;
}
