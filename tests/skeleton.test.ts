import {describe,it,expect} from 'vitest';
import {Vector3} from 'three';
import {POSES,RIDER_DIMENSIONS as d,solveJoint,type Point} from '../app/game/riderSkeleton';
const distance=(a:Point,b:Point)=>new Vector3(...a).distanceTo(new Vector3(...b));
describe('immutable adult skeleton',()=>{
 it('keeps both arm and leg bone lengths on all three motorcycles',()=>{
  for(const p of Object.values(POSES))for(const side of [-1,1]){
   const mirror=(v:Point):Point=>[side*v[0],v[1],v[2]];
   expect(distance(p.hip,p.shoulder)).toBeCloseTo(d.torsoLength,10);
   expect(distance(mirror([d.shoulderHalf,p.shoulder[1],p.shoulder[2]]),mirror(p.elbow))).toBeCloseTo(d.upperArm,10);
   expect(distance(mirror(p.elbow),mirror(p.wrist))).toBeCloseTo(d.forearm,10);
   expect(distance(mirror([d.hipHalf,p.hip[1]-.01,p.hip[2]]),mirror(p.knee))).toBeCloseTo(d.thigh,10);
   expect(distance(mirror(p.knee),mirror(p.ankle))).toBeCloseTo(d.shin,10);
  }
 });
 it('does not silently stretch a bone when a contact target is impossible',()=>{expect(()=>solveJoint([0,0,0],[0,2,0],.34,.30,[1,0,0])).toThrow(RangeError);});
 it('keeps the exact bone lengths with a degenerate bend pole',()=>{const joint=solveJoint([0,0,0],[0,.5,0],.34,.30,[0,1,0]);expect(distance([0,0,0],joint)).toBeCloseTo(.34,10);expect(distance(joint,[0,.5,0])).toBeCloseTo(.30,10);});
});
