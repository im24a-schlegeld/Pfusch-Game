/** Unscaled chassis coordinates. +Z points to the back. */
export const TUBE_EXHAUST=Object.freeze({x:.112,startZ:.46,endZ:.89,startY:.773,endY:.902,radius:.047,clearance:.008});
export function exhaustAxisY(z:number){const e=TUBE_EXHAUST;return e.startY+(e.endY-e.startY)*(z-e.startZ)/(e.endZ-e.startZ);}
export function raisedLinerY(x:number,y:number,z:number):number {
  const e=TUBE_EXHAUST;if(z<e.startZ-.018||z>e.endZ+.012)return y;
  const dx=Math.abs(x-e.x),r=e.radius+.006;if(dx>r+.026)return y;
  const slope=(e.endY-e.startY)/(e.endZ-e.startZ);
  const crown=exhaustAxisY(z)+r*Math.sqrt(1+slope*slope)*Math.sqrt(Math.max(0,1-Math.min(1,dx/r)**2))+e.clearance;
  if(dx<=r)return Math.max(y,crown);
  const t=(dx-r)/.026,blend=1-t*t*(3-2*t);
  return y+Math.max(0,exhaustAxisY(z)+e.clearance-y)*blend;
}
