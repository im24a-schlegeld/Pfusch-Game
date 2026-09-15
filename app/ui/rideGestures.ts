interface PointerState {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  time: number;
}
interface GestureActions {
  weight(value: number): void;
  move(direction: number): void;
  togglePause(): void;
}
export const RIDE_GESTURE = Object.freeze({
  lanePixels: 45,
  weightDeadZone: 8,
  weightPixels: 72,
  twoFingerStartMs: 180,
  twoFingerTapMs: 340,
  tapSlop: 12,
});

/** Two bounded pointer slots; gesture state never owns a keyboard input. */
export class RideGestures {
  private pointers: PointerState[] = [];
  private owner: number | null = null;
  private anchorX = 0;
  private anchorY = 0;
  private pairTime: number | null = null;
  private suppressed = false;

  constructor(private actions: GestureActions) {}

  down(id: number, x: number, y: number, time: number) {
    if (this.pointers.some((p) => p.id === id) || this.pointers.length >= 2)
      return;
    const first = this.pointers[0];
    this.pointers.push({ id, x, y, startX: x, startY: y, time });
    if (!first) {
      this.owner = id;
      this.anchorX = x;
      this.anchorY = y;
      this.suppressed = false;
      this.pairTime = null;
      this.actions.weight(0);
    } else if (
      time - first.time <= RIDE_GESTURE.twoFingerStartMs &&
      Math.hypot(first.x - first.startX, first.y - first.startY) <=
        RIDE_GESTURE.tapSlop
    ) {
      this.pairTime = first.time;
      this.suppressed = true;
      this.actions.weight(0);
    }
  }

  move(id: number, x: number, y: number) {
    const pointer = this.pointers.find((p) => p.id === id);
    if (!pointer) return;
    pointer.x = x;
    pointer.y = y;
    if (this.suppressed) {
      if (
        Math.hypot(x - pointer.startX, y - pointer.startY) >
        RIDE_GESTURE.tapSlop
      )
        this.pairTime = null;
      return;
    }
    if (id !== this.owner) return;
    const dy = y - this.anchorY;
    const value =
      Math.sign(dy) *
      Math.max(
        0,
        Math.min(
          1,
          (Math.abs(dy) - RIDE_GESTURE.weightDeadZone) /
            RIDE_GESTURE.weightPixels,
        ),
      );
    this.actions.weight(value);
    const dx = x - this.anchorX;
    if (Math.abs(dx) >= RIDE_GESTURE.lanePixels) {
      this.actions.move(Math.sign(dx));
      this.anchorX = x;
    }
  }

  up(id: number, time: number) {
    const index = this.pointers.findIndex((p) => p.id === id);
    if (index < 0) return;
    this.pointers.splice(index, 1);
    if (id === this.owner) {
      this.owner = null;
      this.actions.weight(0);
    }
    if (this.pointers.length) return;
    const pause =
      this.pairTime !== null &&
      time - this.pairTime <= RIDE_GESTURE.twoFingerTapMs;
    this.pairTime = null;
    this.suppressed = false;
    if (pause) this.actions.togglePause();
  }

  cancel(id?: number) {
    if (id !== undefined && !this.pointers.some((p) => p.id === id)) return;
    if (id !== undefined && id !== this.owner && !this.suppressed) {
      this.pointers = this.pointers.filter((p) => p.id !== id);
      return;
    }
    this.pointers = [];
    this.owner = null;
    this.pairTime = null;
    this.suppressed = false;
    this.actions.weight(0);
  }
}
