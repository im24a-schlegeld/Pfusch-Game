export interface WheelieVisualContact {
  height: number;
  velocityY: number;
  pitch: number;
  onTowTruck: boolean;
}

/** Observe the original physics transition; never consume or defer rider input. */
export function createWheelieLoadUp() {
  const duration = 0.19;
  let age = duration;
  return {
    update(before: WheelieVisualContact, pitch: number, active: boolean, reducedMotion: boolean, dt: number) {
      if (!active || reducedMotion) { age = duration; return 0; }
      const grounded = before.height === 0 && before.velocityY === 0 &&
        before.pitch <= 0.000001 && !before.onTowTruck;
      if (dt > 0 && grounded && pitch > before.pitch) age = 0;
      else age = Math.min(duration, age + Math.max(0, dt));
      return (1 - age / duration) ** 2;
    },
  };
}

/** No effect at starter cruising speed, pause, blur or reduced motion. */
export function speedEdgeIntensity(speed: number, active: boolean, reducedMotion: boolean) {
  if (!active || reducedMotion) return 0;
  const t = Math.max(0, Math.min(1, (speed - 28) / 17));
  return t * t * (3 - 2 * t);
}
