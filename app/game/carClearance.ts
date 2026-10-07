import { RAMP_FRONT_CONTACT, RAMP_REAR_CONTACT } from './trafficDomain';
import { TAIL_CONTACT } from './tailContact';

/** Actual rendered body/roof profiles: [longitudinal position, half width, bottom, top]. */
export const CAR_BODY_PROFILE: [number, number, number, number][] = [
  [-2.9, .9, .43, .76], [-2.68, 1.11, .43, .94], [-1.95, 1.175, .94, 1.05],
  [0, 1.175, .98, 1.12], [1.85, 1.175, .94, 1.09], [2.62, 1.1, .46, 1], [2.9, .94, .46, .91],
];
export const CAR_CABIN_PROFILE: [number, number, number, number][] = [
  [-1.34, 1.04, 1.03, 1.19], [-.59, .91, 1.1, 1.94], [.66, .91, 1.1, 1.98], [1.5, 1.035, 1.04, 1.3],
];
function profileTop(profile: typeof CAR_BODY_PROFILE, x: number, z: number): number {
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1], b = profile[i];
    if (z < a[0] || z > b[0]) continue;
    const t = (z - a[0]) / (b[0] - a[0]);
    // Include the thin tire's width, without the old 30cm side padding.
    if (Math.abs(x) > a[1] + (b[1] - a[1]) * t + .10) return 0;
    return a[3] + (b[3] - a[3]) * t;
  }
  return 0;
}
export function carSurfaceHeight(x: number, z: number, police = false): number {
  let top = Math.max(profileTop(CAR_BODY_PROFILE, x, z), profileTop(CAR_CABIN_PROFILE, x, z));
  if (police && Math.abs(x) < .46 && Math.abs(z - .08) < .2) top = Math.max(top, 2.06);
  return top;
}

/** Same displayed pitch as SceneView: recovery beyond tail contact is not extra visual lift. */
export function carContactPitch(bikeId: string, wheelieAngle: number, towPitch: number): number {
  return Math.max(towPitch, Math.min(wheelieAngle, (TAIL_CONTACT[bikeId] ?? TAIL_CONTACT['450']).angle));
}

/** At steep recoverable angles either tire can be the leading/trailing one. */
export function carFrontReach(bikeId: string, pitch: number): number {
  const front = RAMP_FRONT_CONTACT[bikeId] ?? RAMP_FRONT_CONTACT['450'];
  const rear = RAMP_REAR_CONTACT[bikeId] ?? RAMP_REAR_CONTACT['450'];
  const sin = Math.sin(pitch), cos = Math.cos(pitch);
  return Math.max(front.radius - front.radius * sin - front.axle * cos,
    rear.radius - rear.radius * sin - rear.axle * cos);
}

/** The trailing tire stays solid until its outer edge has passed the car's nose. */
export function carRearReach(bikeId: string, pitch: number): number {
  const front = RAMP_FRONT_CONTACT[bikeId] ?? RAMP_FRONT_CONTACT['450'];
  const rear = RAMP_REAR_CONTACT[bikeId] ?? RAMP_REAR_CONTACT['450'];
  const sin = Math.sin(pitch), cos = Math.cos(pitch);
  return Math.max(front.radius * sin + front.axle * cos + front.radius,
    rear.radius * sin + rear.axle * cos + rear.radius);
}

/** World-space tire envelope at the existing ballistic height; never changes the arc. */
export function carJumpClearance(bikeId: string, height: number, pitch: number, carZ: number, lateral: number, police = false): number {
  const front = RAMP_FRONT_CONTACT[bikeId] ?? RAMP_FRONT_CONTACT['450'];
  const rear = RAMP_REAR_CONTACT[bikeId] ?? RAMP_REAR_CONTACT['450'];
  const sin = Math.sin(pitch), cos = Math.cos(pitch);
  const lift = rear.radius * (1 - cos) + rear.axle * sin;
  let clearance = Infinity;
  for (const tire of [front, rear]) {
    const centerY = height + tire.radius * cos - tire.axle * sin + lift;
    const centerZ = tire.radius * sin + tire.axle * cos;
    for (let sample = -8; sample <= 8; sample++) {
      const dz = tire.radius * sample / 8;
      const roof = carSurfaceHeight(lateral, carZ + centerZ + dz, police);
      if (roof > 0) clearance = Math.min(clearance, centerY - Math.sqrt(Math.max(0, tire.radius ** 2 - dz ** 2)) - roof);
    }
  }
  // The chassis between the wheels must also stay outside the roof.
  for (let sample = 1; sample < 8; sample++) {
    const t = sample / 8, z = front.axle + (rear.axle - front.axle) * t;
    const y = .22;
    const roof = carSurfaceHeight(lateral, carZ + y * sin + z * cos, police);
    if (roof > 0) clearance = Math.min(clearance, height + y * cos - z * sin + lift - roof);
  }
  return clearance;
}
