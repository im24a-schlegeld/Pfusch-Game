import type { Engine } from '../game/engine';
import { Pause } from 'lucide-react';
import SignProgress from './SignProgress';
const number=(n:number)=>Math.floor(n).toLocaleString('de-CH');
/** One grid owns score, signs, metrics, combo and pause. No independent top offsets. */
export default function RideHud({engine,best,pause}:{engine:Engine;best:number;pause:()=>void}) {
  return <div className="v42-hud" aria-label="Fahrdaten">
    <div className="v42-score"><span>PUNKTE</span><strong data-long={number(engine.score).length>9}>{number(engine.score)}</strong><small>BESTE {number(best)}</small></div>
    <div className="v42-sign-slot"><SignProgress mask={engine.collectedSigns}/></div>
    <div className="v42-metrics"><b>{number(engine.distance)} <small>M</small></b><b>{Math.round(engine.speed*3.6)} <small>KM/H</small></b></div>
    <div className="v42-right-bottom"><span className="v42-combo">×{engine.combo.toFixed(1)} <small>KOMBO</small></span><button type="button" onClick={pause} aria-label="Fahrt pausieren"><Pause size={21} fill="currentColor" strokeWidth={0} aria-hidden="true" /></button></div>
  </div>;
}
