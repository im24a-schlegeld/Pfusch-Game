/** Keep the complete visual pass at 60 Hz on faster displays, without dropping
 * elapsed simulation time or changing resolution, geometry or animation speed. */
export function createRenderCadence() {
  const interval = 1000 / 60;
  let deadline = -Infinity;
  return {
    accept(now: number, continuous: boolean) {
      if (!continuous || deadline === -Infinity || !Number.isFinite(now)) {
        deadline = Number.isFinite(now) ? now + interval : -Infinity;
        return true;
      }
      // Small callback jitter at native 60 Hz must not halve its frame rate.
      if (now + 0.5 < deadline) return false;
      // Retain the phase across 120/144 Hz callbacks and long missed frames.
      deadline += Math.max(1, Math.floor((now - deadline) / interval) + 1) * interval;
      return true;
    },
  };
}
