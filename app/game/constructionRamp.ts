import { RAMP_FRONT_CONTACT, RAMP_REAR_CONTACT } from './trafficDomain';

/** One optional lane; the other two remain ordinary asphalt. All values in metres. */
export const CONSTRUCTION_RAMP = Object.freeze({
  width: 2.2, entryZ: 8, lipZ: 2, gapEndZ: -6, endZ: -8,
  height: 0.65, launchVelocity: 6,
});
export function constructionRampHeight(z: number) {
  const ramp = CONSTRUCTION_RAMP;
  return ramp.height * Math.max(0, Math.min(1, (ramp.entryZ - z) / (ramp.entryZ - ramp.lipZ)));
}
/** Fit the existing immutable bike axles to the shallow entry plane. */
export function constructionRampPose(bikeId: string, localZ: number, minimumPitch = 0) {
  const front = RAMP_FRONT_CONTACT[bikeId] ?? RAMP_FRONT_CONTACT['450'];
  const rear = RAMP_REAR_CONTACT[bikeId] ?? RAMP_REAR_CONTACT['450'];
  const pitch = Math.max(minimumPitch, Math.atan2(
    constructionRampHeight(localZ + front.axle) - constructionRampHeight(localZ + rear.axle),
    rear.axle - front.axle,
  ));
  const c = Math.cos(pitch), s = Math.sin(pitch);
  const support = (tire: typeof front) => {
    const centerZ = localZ + tire.axle * c + tire.radius * s;
    const centerY = rear.radius + (tire.radius - rear.radius) * c + (rear.axle - tire.axle) * s;
    return constructionRampHeight(centerZ) + tire.radius - centerY;
  };
  return { height: Math.max(0, support(front), support(rear)), pitch };
}
