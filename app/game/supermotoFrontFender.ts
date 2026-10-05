import { MathUtils } from 'three';
import { SUPERMOTO_FRONT_FENDER } from './supermotoFit';
import { formedSheet } from './supermotoSheet';
type Section = readonly [number, number, number, number];
type Point = [number, number, number];
/** Shape-preserving longitudinal bends; unlike an unconstrained spline,
 * these tangents cannot overshoot the tyre-clearance stations. Width stays
 * piecewise linear so the tapered shoulders do not become a bulbous oval. */
function frontFenderSectionAt(u: number): Section {
  const sections = SUPERMOTO_FRONT_FENDER;
  const station = u * (sections.length - 1), i = Math.min(Math.floor(station), sections.length - 2);
  const t = station - i, a = sections[i], b = sections[i + 1], span = b[0] - a[0];
  const slope = (index: number, component: 2 | 3) => {
    const secant = (n: number) => (sections[n + 1][component] - sections[n][component])
      / (sections[n + 1][0] - sections[n][0]);
    if (index === 0) return secant(0);
    if (index === sections.length - 1) return secant(index - 1);
    const left = secant(index - 1), right = secant(index);
    if (left * right <= 0) return 0;
    const before = sections[index][0] - sections[index - 1][0];
    const after = sections[index + 1][0] - sections[index][0];
    const w1 = 2 * after + before, w2 = after + 2 * before;
    return (w1 + w2) / (w1 / left + w2 / right);
  };
  const bend = (component: 2 | 3) => (2 * t ** 3 - 3 * t ** 2 + 1) * a[component]
    + (t ** 3 - 2 * t ** 2 + t) * span * slope(i, component)
    + (-2 * t ** 3 + 3 * t ** 2) * b[component]
    + (t ** 3 - t ** 2) * span * slope(i + 1, component);
  return [MathUtils.lerp(a[0], b[0], t), MathUtils.lerp(a[1], b[1], t), bend(2), bend(3)];
}

function frontFenderPointAt(u: number, v: number): Point {
  const folds = [[0, 1], [0.25, 0.94], [0.50, 0.35], [0.625, 0.35], [0.75, 0.50], [1, 0]];
    const section = frontFenderSectionAt(u), [z, width] = section, across = Math.abs(v);
    const segment = Math.max(0, folds.findIndex(p => p[0] >= across) - 1);
    const a = folds[segment], b = folds[segment + 1];
    const height = MathUtils.lerp(a[1], b[1], (across - a[0]) / (b[0] - a[0]));
    // Clip the two corners of the broad nose. Use physical longitudinal
    // distance so dense first stations cannot fold back over one another.
    const noseCorner = 0.010 * MathUtils.smoothstep(across, 0.55, 1)
      * (1 - MathUtils.smoothstep(z, -1.100, -0.940));
    const pointZ = z + noseCorner;
    let profile = section;
    if (noseCorner > 0) {
      const next = SUPERMOTO_FRONT_FENDER.findIndex(station => station[0] >= pointZ);
      const i = Math.max(0, next - 1), start = SUPERMOTO_FRONT_FENDER[i][0];
      const t = (pointZ - start) / (SUPERMOTO_FRONT_FENDER[i + 1][0] - start);
      profile = frontFenderSectionAt((i + t) / (SUPERMOTO_FRONT_FENDER.length - 1));
    }
    // The reinforcing folds fade into the smooth leading lip and rear skirt;
    // carrying the channels all the way to either cut edge creates two bumps.
    const foldStrength = MathUtils.smoothstep(pointZ, -1.070, -0.940)
      * (1 - MathUtils.smoothstep(pointZ, -0.520, -0.470));
    const crownHeight = MathUtils.lerp(1 - v * v, height, foldStrength);
    return [v * width, profile[3] + profile[2] * crownHeight, pointZ];
}

/** The holder seats on the actual moulded crown, not its previous rear slope. */
export const SUPERMOTO_FRONT_FENDER_MOUNT: Point = frontFenderPointAt(
  SUPERMOTO_FRONT_FENDER.findIndex(row => row[0] === -0.550) / (SUPERMOTO_FRONT_FENDER.length - 1),
  0.034 / 0.080,
);

/** One thin moulded part: broad central spine, recessed side channels,
 * tapered shoulders, rounded descending nose and deep rear return. */
export function supermotoFrontFenderGeometry() {
  return formedSheet(60, 16, frontFenderPointAt, [0, -0.004, 0], true);
}
