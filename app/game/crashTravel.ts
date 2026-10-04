export type CrashDirection = 'front' | 'rear' | 'side' | 'fall';

/** Visual inertia after settlement; never advances score, domain traffic or RNG. */
export function createCrashTravel(
  speed: number,
  impact: boolean | CrashDirection,
  reducedMotion: boolean,
) {
  const direction =
    typeof impact === 'boolean' ? (impact ? 'front' : 'fall') : impact;
  const retained = { front: 0.24, rear: 0.72, side: 0.65, fall: 1 }[direction];
  const initialSpeed = reducedMotion
    ? 0
    : Math.max(0, Math.min(50, Number.isFinite(speed) ? speed : 0)) * retained;
  const drag = direction === 'front' ? 5 : direction === 'rear' ? 3.8 : 2.9;
  // Remove the exponential's residual velocity so the slide comes to rest at
  // the end of the presentation instead of freezing while still travelling.
  const tail = Math.exp(-drag * 1.2);
  let elapsed = 0;
  return {
    advance(dt: number, active: boolean) {
      if (active && Number.isFinite(dt))
        elapsed = Math.min(1.2, elapsed + Math.max(0, Math.min(0.1, dt)));
    },
    get distance() {
      return (
        (initialSpeed *
          ((1 - Math.exp(-drag * elapsed)) / drag - tail * elapsed)) /
        (1 - tail)
      );
    },
    get speed() {
      return (
        (initialSpeed * Math.max(0, Math.exp(-drag * elapsed) - tail)) /
        (1 - tail)
      );
    },
    get elapsed() {
      return elapsed;
    },
  };
}
