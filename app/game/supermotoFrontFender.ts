import { MathUtils } from 'three';
import { SUPERMOTO_FRONT_FENDER } from './supermotoFit';
import { formedSheet } from './supermotoSheet';
type Section = readonly [number, number, number, number];
type Point = [number, number, number];
/** Shape-preserving longitudinal bends; unlike an unconstrained spline,
 * these tangents cannot overshoot the tyre-clearance stations. Width stays
 * piecewise linear so the real stepped outline is not rounded into an oval. */
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

/** Keep the mounting crown beneath the mask while extending the EXC blade.
 * Monotone tangents avoid a kink at the mounting row or rear return. */
function frontFenderMountedZ(z: number) {
  const nose = -1.045, crown = -0.665, rear = -0.452, fittedCrown = -0.550, fittedNose = -0.995;
  const frontSlope = (fittedCrown - fittedNose) / (crown - nose);
  const rearSlope = (rear - fittedCrown) / (rear - crown);
  const tangent = 2 * frontSlope * rearSlope / (frontSlope + rearSlope);
  const before = z <= crown;
  const a = before ? nose : crown, b = before ? crown : rear;
  const outA = before ? fittedNose : fittedCrown, outB = before ? fittedCrown : rear;
  const m0 = before ? frontSlope : tangent, m1 = before ? tangent : rearSlope;
  const t = MathUtils.clamp((z - a) / (b - a), 0, 1);
  return (2 * t ** 3 - 3 * t * t + 1) * outA
    + (t ** 3 - 2 * t * t + t) * (b - a) * m0
    + (-2 * t ** 3 + 3 * t * t) * outB
    + (t ** 3 - t * t) * (b - a) * m1;
}

function frontFenderPointAt(u: number, v: number): Point {
  const folds = [[0, 1], [0.25, 0.94], [0.50, 0.35], [0.625, 0.35], [0.75, 0.50], [1, 0]];
    const section = frontFenderSectionAt(u), [z, width] = section, across = Math.abs(v);
    const segment = Math.max(0, folds.findIndex(p => p[0] >= across) - 1);
    const a = folds[segment], b = folds[segment + 1];
    const height = MathUtils.lerp(a[1], b[1], (across - a[0]) / (b[0] - a[0]));
    // Clip the two corners of the broad nose. Use physical longitudinal
    // distance so dense first stations cannot fold back over one another.
    const noseCorner = 0.020 * MathUtils.smoothstep(across, 0.55, 1)
      * (1 - MathUtils.smoothstep(z, -1.045, -0.915));
    const pointZ = z + noseCorner;
    let profile = section;
    if (noseCorner > 0) {
      const next = SUPERMOTO_FRONT_FENDER.findIndex(station => station[0] >= pointZ);
      const i = Math.max(0, next - 1), start = SUPERMOTO_FRONT_FENDER[i][0];
      const t = (pointZ - start) / (SUPERMOTO_FRONT_FENDER[i + 1][0] - start);
      profile = frontFenderSectionAt((i + t) / (SUPERMOTO_FRONT_FENDER.length - 1));
    }
    // The shoulder notch only cuts the outer flange. Keep the central rib
    // continuous through it instead of pinching the entire cross-section.
    const spineWidth = z > -0.915 && z < -0.760
      ? Math.max(width, MathUtils.lerp(0.099, 0.090, (z + 0.915) / 0.155))
      : width;
    const x = across <= 0.5 ? across * spineWidth
      : MathUtils.lerp(spineWidth * 0.5, width, (across - 0.5) * 2);
    // The reinforcing folds fade into the smooth leading lip and rear skirt;
    // carrying the channels all the way to either cut edge creates two bumps.
    const foldStrength = MathUtils.smoothstep(pointZ, -1.015, -0.945)
      * (1 - MathUtils.smoothstep(pointZ, -0.520, -0.470));
    const crownHeight = MathUtils.lerp(1 - v * v, height, foldStrength);
    const widthFit = MathUtils.lerp(0.98, 0.86, MathUtils.smoothstep(z, -0.870, -0.665));
    return [Math.sign(v) * x * widthFit, profile[3] + profile[2] * crownHeight, frontFenderMountedZ(pointZ)];
}

/** The holder seats on the actual moulded crown, not its previous rear slope. */
export const SUPERMOTO_FRONT_FENDER_MOUNT: Point = frontFenderPointAt(
  SUPERMOTO_FRONT_FENDER.findIndex(row => row[0] === -0.665) / (SUPERMOTO_FRONT_FENDER.length - 1),
  0.034 / 0.091,
);

/** One thin moulded part: broad central spine, recessed side channels,
 * kicked-out shoulders, rounded descending nose and short rear return. */
export function supermotoFrontFenderGeometry() {
  return formedSheet(60, 16, frontFenderPointAt, [0, -0.004, 0], true);
}
