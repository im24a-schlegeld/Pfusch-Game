interface PointerState {id:number;x:number;y:number;startX:number;startY:number;time:number}
interface GestureActions {weight(value:number):void;move(direction:number):void;togglePause():void}
export const RIDE_GESTURE=Object.freeze({lanePixels:155,weightDeadZone:10,weightPixels:76,twoFingerStartMs:180,twoFingerTapMs:340,tapSlop:14});
/** Each intentional 100 CSS-pixel swipe makes ONE lane change; lifting re-arms it. */
export class RideGestures {
  private pointers:PointerState[]=[];
  private owner:number|null=null;
  private anchorX=0;private anchorY=0;private pairTime:number|null=null;
  private suppressed=false;private laneUsed=false;
  constructor(private actions:GestureActions){}
  down(id:number,x:number,y:number,time:number){
    if(![id,x,y,time].every(Number.isFinite)||this.pointers.some(p=>p.id===id)||this.pointers.length>=2)return;
    const first=this.pointers[0];this.pointers.push({id,x,y,startX:x,startY:y,time});
    if(!first){this.owner=id;this.anchorX=x;this.anchorY=y;this.suppressed=false;this.laneUsed=false;this.pairTime=null;this.actions.weight(0);}
    else if(time-first.time<=RIDE_GESTURE.twoFingerStartMs&&Math.hypot(first.x-first.startX,first.y-first.startY)<=RIDE_GESTURE.tapSlop){this.pairTime=first.time;this.suppressed=true;this.actions.weight(0);}
  }
  move(id:number,x:number,y:number){
    if(![x,y].every(Number.isFinite))return;
    const p=this.pointers.find(p=>p.id===id);if(!p)return;p.x=x;p.y=y;
    if(this.suppressed){if(Math.hypot(x-p.startX,y-p.startY)>RIDE_GESTURE.tapSlop)this.pairTime=null;return;}
    if(id!==this.owner)return;
    const dy=y-this.anchorY;
    this.actions.weight(Math.sign(dy)*Math.max(0,Math.min(1,(Math.abs(dy)-RIDE_GESTURE.weightDeadZone)/RIDE_GESTURE.weightPixels)));
    const dx=x-this.anchorX;
    if(!this.laneUsed&&Math.abs(dx)>=RIDE_GESTURE.lanePixels){this.actions.move(Math.sign(dx));this.laneUsed=true;}
  }
  up(id:number,time:number){
    const i=this.pointers.findIndex(p=>p.id===id);if(i<0)return;this.pointers.splice(i,1);
    if(id===this.owner){this.owner=null;this.actions.weight(0);}
    if(this.pointers.length)return;
    const pause=this.pairTime!==null&&time-this.pairTime<=RIDE_GESTURE.twoFingerTapMs;
    this.pairTime=null;this.suppressed=false;this.laneUsed=false;
    if(pause)this.actions.togglePause();
  }
  cancel(id?:number){
    if(id!==undefined&&!this.pointers.some(p=>p.id===id))return;
    if(id!==undefined&&id!==this.owner&&!this.suppressed){this.pointers=this.pointers.filter(p=>p.id!==id);return;}
    this.pointers=[];this.owner=null;this.pairTime=null;this.suppressed=false;this.laneUsed=false;this.actions.weight(0);
  }
}
