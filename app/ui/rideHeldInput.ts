export type RideHoldAction = 'wheelie' | 'brake';

/** Each finger/key owns its hold until release. Releasing one source cannot
 * cancel another, and a lifecycle reset never leaves a held control behind. */
export class RideHeldInput {
  private pointers = new Map<number, RideHoldAction>();
  private keys = new Map<string, RideHoldAction>();

  constructor(private apply: (action: RideHoldAction, held: boolean) => void) {}

  press(id: number, action: RideHoldAction) {
    if (!Number.isFinite(id) || this.pointers.has(id) || this.pointers.size >= 10) return;
    this.pointers.set(id, action);
    this.publish();
  }
  release(id: number) {
    if (!this.pointers.delete(id)) return;
    this.publish();
  }
  key(key: string, action: RideHoldAction, held: boolean) {
    if (held) this.keys.set(key, action);
    else this.keys.delete(key);
    this.publish();
  }
  clearPointers() { this.pointers.clear(); this.publish(); }
  clear() { this.pointers.clear(); this.keys.clear(); this.publish(); }
  isHeld(action: RideHoldAction) {
    return [...this.pointers.values(), ...this.keys.values()].includes(action);
  }
  hasPointers() { return this.pointers.size > 0; }
  private publish() {
    this.apply('wheelie', this.isHeld('wheelie'));
    this.apply('brake', this.isHeld('brake'));
  }
}
