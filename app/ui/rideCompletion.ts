import type { RunStats } from '../domain/types';
import type { Engine } from '../game/engine';

/** A crash offer must never settle coins before its continuation is decided. */
export class RideCompletion {
  run: RunStats | null = null;
  private revealed = false;
  constructor(private engine: Engine, private shareSupported: boolean) {}
  get offersRevive() {
    return !this.run && this.shareSupported && this.engine.canRevive;
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
