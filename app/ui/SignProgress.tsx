import {useEffect,useRef,useState} from 'react';
import {loadSignArtwork, type SignArtwork} from '../game/signArtwork';
export default function SignProgress({mask}:{mask:number}){
  const ref=useRef<HTMLCanvasElement>(null),[art,setArt]=useState<SignArtwork|null>(null),[failed,setFailed]=useState(false);
  useEffect(()=>{let active=true;loadSignArtwork().then(a=>{if(active)setArt(a);}).catch(()=>{if(active)setFailed(true);});return()=>{active=false;};},[]);
  useEffect(()=>{
    if(!art||!ref.current)return;
    const c=ref.current;c.width=art.width;c.height=art.height;const ctx=c.getContext('2d')!;
    ctx.clearRect(0,0,c.width,c.height);
    for(let i=0;i<art.pieces.length;i++){
      const p=art.pieces[i],collected=!!(mask&(1<<i));
      ctx.drawImage(collected?p.canvas:p.dim,p.x,p.y);
    }
  },[art,mask]);
  const count=Array.from({length:6},(_,i)=>Number(!!(mask&(1<<i)))).reduce((a,b)=>a+b,0);
  return <div className="sign-set-v38" data-testid="sign-progress" data-mask={mask} data-ready={!!art} aria-label={`${count} von 6 Schildern gesammelt`}><div className="sign-set-caption"><span>{count===6?'SET KOMPLETT':'SAMMELSET'}</span><b>{count}/6</b></div><canvas ref={ref} aria-hidden="true"/>{failed&&<span>Grafik konnte nicht geladen werden</span>}</div>;
}
