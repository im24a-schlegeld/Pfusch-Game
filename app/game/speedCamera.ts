/** The fixed-step engine owns camera placement; the renderer only reads it. */
export interface SpeedCameraState {
  id: number;
  active: boolean;
  distance: number;
  side: -1 | 1;
  triggered: boolean;
}

export const SPEED_CAMERA = Object.freeze({
  firstScore: 7_500,
  scoreInterval: 15_000,
  lookAhead: 90,
  searchStep: 12,
  searchEnd: 198,
  lookBehind: 28,
  triggerRange: 4,
});

/** One reusable camera, scheduled at score thresholds on suitable road only. */
export class SpeedCameraSchedule {
  readonly camera: SpeedCameraState = {
    id: 0,
    active: false,
    distance: 0,
    side: -1,
    triggered: false,
  };

  private nextScore = SPEED_CAMERA.firstScore;

  update(
    score: number,
    distance: number,
    allowSchedule: boolean,
    eligibleAt: (distance: number) => boolean,
  ): void {
    if (!Number.isFinite(score) || !Number.isFinite(distance)) return;
    const camera = this.camera;
    if (camera.active && distance > camera.distance + SPEED_CAMERA.lookBehind)
      camera.active = false;
    if (camera.active || !allowSchedule || score < this.nextScore) return;

    // A tunnel or bridge postpones the pending threshold instead of consuming
    // it or introducing a second, invisible set of roadside camera candidates.
    for (
      let ahead = SPEED_CAMERA.lookAhead;
      ahead <= SPEED_CAMERA.searchEnd;
      ahead += SPEED_CAMERA.searchStep
    ) {
      const candidate = distance + ahead;
      if (!eligibleAt(candidate)) continue;
      camera.id++;
      camera.active = true;
      camera.distance = candidate;
      camera.side = camera.id % 2 === 0 ? 1 : -1;
      camera.triggered = false;
      this.nextScore += SPEED_CAMERA.scoreInterval;
      return;
    }
  }
}
