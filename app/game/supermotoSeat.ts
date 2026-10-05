import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, MathUtils, Vector3 } from 'three';
import { SUPERMOTO_SEAT } from './supermotoFit';

/** Extra upholstery below the authored riding surface: a tapered wedge in
 * side view, thin at the nose and rear tip with a deeper middle skirt. */
export function supermotoSeatSkirtDepth(z: number) {
  const knots = [[-0.220, 0], [-0.100, 0.012], [0.100, 0.052],
    [0.230, 0.070], [0.380, 0.048], [0.550, 0.016], [0.708, 0]];
  const index = knots.findIndex(point => point[0] >= z);
  const i = Math.max(0, Math.min(knots.length - 2, index < 0 ? knots.length - 2 : index - 1));
  const a = knots[i], b = knots[i + 1];
  return MathUtils.lerp(a[1], b[1], MathUtils.clamp((z - a[0]) / (b[0] - a[0]), 0, 1));
}

/** Sample the authored saddle with the existing twenty-section loft layout.
 * The lower wedge is independent of the upper riding/contact profile. */
function saddleSections() {
  const profile = new CatmullRomCurve3(SUPERMOTO_SEAT.map(r => new Vector3(r[0], r[1], r[2])), false, 'catmullrom', 0.25);
  const centers = new CatmullRomCurve3(SUPERMOTO_SEAT.map(r => new Vector3(r[0], r[3], 0)), false, 'catmullrom', 0.25);
  return Array.from({ length: 21 }, (_, i) => {
    const p = profile.getPoint(i / 20), c = centers.getPoint(i / 20);
    return { z: p.x, width: Math.max(0.002, p.y), halfDepth: Math.max(0.002, p.z), centerY: c.y };
  });
}
const SEAT_SECTIONS = saddleSections();

/** The plastic shoulder and concealed seat pan use this same physical seam. */
export function supermotoSeatSection(z: number) {
  const sections = SEAT_SECTIONS;
  const index = sections.findIndex(section => section.z >= z);
  const i = Math.max(0, Math.min(sections.length - 2, index < 0 ? sections.length - 2 : index - 1));
  const a = sections[i], b = sections[i + 1], t = MathUtils.clamp((z - a.z) / (b.z - a.z), 0, 1);
  return { z, width: MathUtils.lerp(a.width, b.width, t), halfDepth: MathUtils.lerp(a.halfDepth, b.halfDepth, t),
    centerY: MathUtils.lerp(a.centerY, b.centerY, t), skirt: supermotoSeatSkirtDepth(z) };
}

/** The lower bolster wraps the existing subframe, with a rounded bottom turn.
 * The riding surface above the horizontal centre line remains elliptical. */
export function supermotoSeatLowerWidth(width: number, cosine: number) {
  return width * Math.sqrt(Math.max(0, 1 - Math.abs(cosine) ** 8));
}

export function supermotoSeatGeometry() {
  const sections = SEAT_SECTIONS, segments = 24, stride = segments + 1;
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  for (const section of sections) for (let j = 0; j <= segments; j++) {
    const angle = j / segments * Math.PI * 2 - Math.PI / 2, c = Math.cos(angle);
    const depth = section.halfDepth + (c < 0 ? supermotoSeatSkirtDepth(section.z) : 0);
    const x = c < 0 ? Math.sign(Math.sin(angle)) * supermotoSeatLowerWidth(section.width, c)
      : Math.sin(angle) * section.width;
    positions.push(x, section.centerY + c * depth, section.z);
    uv.push(j / segments, (section.z - sections[0].z) / (sections.at(-1)!.z - sections[0].z));
  }
  for (let row = 0; row < sections.length - 1; row++) for (let j = 0; j < segments; j++) {
    const a = row * stride + j, b = a + stride;
    indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
  for (const [row, reverse] of [[0, false], [sections.length - 1, true]] as const) {
    const first = row * stride;
    for (let j = 1; j < segments - 1; j++)
      indices.push(first, first + (reverse ? j + 1 : j), first + (reverse ? j : j + 1));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}
