/** Visual inertia after settlement; never advances score, domain traffic or RNG. */
export function createCrashTravel(
  speed: number,
  impact: boolean,
  reducedMotion: boolean,
) {
  const initialSpeed = reducedMotion
    ? 0
    : Math.max(0, Math.min(50, speed)) * (impact ? 0.24 : 1);
  const drag = impact ? 5 : 2.9;
  let elapsed = 0;
  return {
    advance(dt: number, active: boolean) {
      if (active && Number.isFinite(dt))
        elapsed = Math.min(1.2, elapsed + Math.max(0, Math.min(0.1, dt)));
    },
    get distance() {
      return (initialSpeed * (1 - Math.exp(-drag * elapsed))) / drag;
    },
    get speed() {
      return initialSpeed * Math.exp(-drag * elapsed);
    },
    get elapsed() {
      return elapsed;
    },
  };
}
