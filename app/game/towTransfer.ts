/** World metres, seconds. No collision exemptions for the car being crossed. */
export interface TransferObstacle {
  x: number; z: number; velocity: number; height: number;
  halfWidth: number; front: number; rear: number; car: boolean;
}
export interface TransferPlan {
  launchVelocity: number; lateralDelay: number; lateralSeconds: number;
  forwardBoost: number; boostSeconds: number; feasible: boolean; apex: number;
}
export const TOW_TRANSFER = Object.freeze({launchVelocity: 6.4, lateralSeconds: .42});
const smooth = (t: number) => {t=Math.max(0,Math.min(1,t));return t*t*t*(10+t*(-15+6*t));};
export function transferX(from:number,to:number,seconds:number,plan?:TransferPlan) {
  return from+(to-from)*smooth((seconds-(plan?.lateralDelay??0))/(plan?.lateralSeconds??.54));
}
/** A small take-off push, decaying to normal road speed. This is real forward travel. */
export function transferBoostDistance(seconds:number,plan:TransferPlan):number {
  const t=Math.max(0,Math.min(seconds,plan.boostSeconds));
  return plan.forwardBoost*(t-t*t/(2*plan.boostSeconds));
}
export function planTowTransfer(height:number,speed:number,gravity:number,from:number,to:number,obstacles:readonly TransferObstacle[]):TransferPlan {
  if(![height,speed,gravity,from,to].every(Number.isFinite)||gravity<=0)throw new Error('Invalid transfer inputs');
  const relevant=obstacles.filter(o=>o.z>-10&&o.z<24&&Math.abs(o.x-to)<o.halfWidth+.1);
  const cars=relevant.filter(o=>o.car);
  const roof=cars.length?Math.max(...cars.map(o=>o.height)):1.98;
  const h0=Math.max(0,height);
  const fallback:TransferPlan={launchVelocity:Math.sqrt(2*gravity*Math.max(.12,roof+.22-h0)),lateralDelay:.10,lateralSeconds:.34,forwardBoost:4.5,boostSeconds:.68,feasible:false,apex:Math.max(h0+.12,roof+.22)};
  // Prefer a flatter, more forward jump that clears a small car instead of launching high.
  for(const clearance of [.14,.18,.22,.28]) {
    const apex=Math.max(h0+.15,roof+clearance),v=Math.sqrt(2*gravity*(apex-h0));
    const flight=(v+Math.sqrt(v*v+2*gravity*h0))/gravity;
    for(const boost of [3.5,4.5,5.5,6.5,7.5]) for(const duration of [.28,.34,.38,.42]) for(const delay of [0,.06,.12,.18,.24]) {
      const plan:TransferPlan={launchVelocity:v,lateralDelay:delay,lateralSeconds:duration,forwardBoost:boost,boostSeconds:.8,feasible:true,apex};
      if(delay+duration>flight-.03)continue;
      let safe=true,crossed=cars.length===0;
      // Include arrival on the road. Both vertical and longitudinal clearance
      // must be real, using the same front/rear extents as the Engine.
      for(let t=0;t<=flight+.20;t+=1/120){
        const x=transferX(from,to,t,plan),y=Math.max(0,h0+v*t-gravity*t*t/2);
        for(const o of relevant){
          const z=o.z-(speed-o.velocity)*t-transferBoostDistance(t,plan);
          if(z>=o.rear||z<=o.front||Math.abs(x-o.x)>=o.halfWidth)continue;
          if(y<o.height+.055){safe=false;break;}
          if(o.car)crossed=true;
        }
        if(!safe)break;
      }
      if(safe)return plan;
    }
  }
  return fallback;
}
