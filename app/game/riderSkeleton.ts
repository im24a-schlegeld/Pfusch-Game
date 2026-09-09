import {Vector3} from 'three';
export type Point=[number,number,number];
export const RIDER_DIMENSIONS=Object.freeze({torsoLength:.53,neckToHelmetCenter:.22,shoulderHalf:.21,hipHalf:.125,upperArm:.34,forearm:.30,thigh:.43,shin:.43});
export interface RiderTarget {hip:Point;grip:Point;peg:Point;torsoLean:number}
export interface RiderPose extends RiderTarget {shoulder:Point;head:Point;elbow:Point;knee:Point;wrist:Point;ankle:Point}
const v=(p:Point)=>new Vector3(...p);
/** Exact two-bone solve. Unreachable contact targets are configuration errors, never stretched anatomy. */
export function solveJoint(start:Point,end:Point,first:number,second:number,pole:Point):Point{
 const origin=v(start),delta=v(end).sub(origin),distance=delta.length();
 if(distance<Math.abs(first-second)+1e-6||distance>first+second-1e-6)throw new RangeError('Rider contact target is outside the fixed skeleton reach');
 const direction=delta.divideScalar(distance);const along=(first*first-second*second+distance*distance)/(2*distance);const height=Math.sqrt(Math.max(0,first*first-along*along));
 const bend=v(pole).addScaledVector(direction,-v(pole).dot(direction));
 if(bend.lengthSq()<1e-8){const axes=[new Vector3(1,0,0),new Vector3(0,1,0),new Vector3(0,0,1)];axes.sort((a,b)=>Math.abs(a.dot(direction))-Math.abs(b.dot(direction)));bend.copy(axes[0]).addScaledVector(direction,-axes[0].dot(direction));}
 return origin.addScaledVector(direction,along).addScaledVector(bend.normalize(),height).toArray() as Point;
}
export function resolveRiderPose(target:RiderTarget):RiderPose{
 const d=RIDER_DIMENSIONS;const shoulder:Point=[0,target.hip[1]+Math.cos(target.torsoLean)*d.torsoLength,target.hip[2]-Math.sin(target.torsoLean)*d.torsoLength];
 const head:Point=[0,shoulder[1]+d.neckToHelmetCenter,shoulder[2]-.035];
 const wrist:Point=[target.grip[0],target.grip[1]+.015,target.grip[2]+.02];const ankle:Point=[target.peg[0],target.peg[1]+.105,target.peg[2]+.055];
 return {...target,shoulder,head,wrist,ankle,elbow:solveJoint([d.shoulderHalf,shoulder[1],shoulder[2]],wrist,d.upperArm,d.forearm,[.18,-.12,.10]),knee:solveJoint([d.hipHalf,target.hip[1]-.01,target.hip[2]],ankle,d.thigh,d.shin,[.20,0,-1])};
}
export const RIDER_TARGETS:Readonly<Record<'125'|'450'|'701',RiderTarget>>=Object.freeze({
 '125':{hip:[0,.94,.25],grip:[.31,1.25,-.40],peg:[.20,.33,.12],torsoLean:.16},
 '450':{hip:[0,1.00,.18],grip:[.38,1.13,-.44],peg:[.22,.47,.18],torsoLean:.30},
 '701':{hip:[0,.88,.32],grip:[.32,.94,-.47],peg:[.24,.41,.40],torsoLean:.60},
});
export const POSES={ '125':resolveRiderPose(RIDER_TARGETS['125']),'450':resolveRiderPose(RIDER_TARGETS['450']),'701':resolveRiderPose(RIDER_TARGETS['701'])};
