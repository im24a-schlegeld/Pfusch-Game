import type { RunStats } from '../domain/types';
import type { Engine } from '../game/engine';

/** A crash offer must never settle coins before its continuation is decided. */
export class RideCompletion {
  run: RunStats | null = null;
  private revealed = false;
  constructor(private engine: Engine, private continuationAvailable: boolean | (() => boolean)) {}
  get offersRevive() {
    const available = typeof this.continuationAvailable === 'function'
      ? this.continuationAvailable() : this.continuationAvailable;
    return !this.run && available && this.engine.canRevive;
  }
  settle(finish: (run: RunStats) => void, declineRevive = false) {
    if (this.run || this.engine.phase !== 'crashed' || (this.offersRevive && !declineRevive)) return;
    this.run = this.engine.stats();
    finish(this.run);
  }
  revive() {
    return this.offersRevive && this.engine.revive();
  }
  reveal(ready: (runId: string) => void) {
    if (!this.run || this.revealed) return;
    this.revealed = true;
    ready(this.run.id);
  }
}

/** A visual reservation costs nothing until its original crashed ride is still valid. */
export function reserveBellRevive(completion: RideCompletion, ownerId: string, runId: string) {
  let closed = false;
  return {
    cancel() { closed = true; },
    redeem(current: RideCompletion, currentOwner: string, pay: (runId: string) => boolean) {
      if (closed || current !== completion || currentOwner !== ownerId || !completion.offersRevive) return false;
      closed = true;
      return pay(runId) && completion.revive();
    },
  };
}
