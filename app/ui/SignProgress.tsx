import {useEffect,useRef,useState} from 'react';
import {loadSignArtwork,type SignArtwork} from '../game/signArtwork';
export default function SignProgress({mask}:{mask:number}) {
  const ref=useRef<HTMLCanvasElement>(null),[art,setArt]=useState<SignArtwork|null>(null),[failed,setFailed]=useState(false);
  useEffect(()=>{let alive=true;loadSignArtwork().then(a=>{if(alive)setArt(a);}).catch(()=>{if(alive)setFailed(true);});return()=>{alive=false;};},[]);
  useEffect(()=>{if(!art||!ref.current)return;const c=ref.current;c.width=art.width;c.height=art.height;const ctx=c.getContext('2d');if(!ctx)return;ctx.clearRect(0,0,c.width,c.height);
    // Whole, separate layers: selecting F cannot reveal any U pixels. The dark
    // U layer remains in front and occludes F at their natural overlap.
    [0,1,3,2,4,5].forEach(i=>{const p=art.pieces[i];ctx.drawImage(mask&(1<<i)?p.canvas:p.dim,p.x,p.y);});
  },[art,mask]);
  const count=Array.from({length:6},(_,i)=>Number(!!(mask&(1<<i)))).reduce((a,b)=>a+b,0);
  return <div className="sign-set-v38 v42-signs" data-testid="sign-progress" data-mask={mask} data-ready={!!art} data-fallbacks={art?.fallbacks??0} aria-label={`${count} von 6 Schildern gesammelt`}>
    <div className="sign-set-caption"><span>{count===6?'SET KOMPLETT':'SAMMELSET'}</span><b>{count}/6</b></div>
    <canvas ref={ref} width={660} height={205} aria-hidden="true"/>
    {failed&&<small className="v42-asset-note">{count}/6 gesammelt</small>}
  </div>;
}
