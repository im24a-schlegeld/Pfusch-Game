import { BufferGeometry, Float32BufferAttribute, MathUtils } from 'three';
import { SUPERMOTO_SIDE_COVER, SUPERMOTO_TAIL_FENDER } from './supermotoFit';
import { formedSheet } from './supermotoSheet';
import { exhaustAxisY, TUBE_EXHAUST } from './exhaustClearance';
import { supermotoSeatLowerWidth, supermotoSeatSection } from './supermotoSeat';
export { supermotoShroudGeometry } from './supermotoTank';

type Section = readonly [number, number, number, number];
type Point = [number, number, number];

/** One upholstery seam for the visible side shoulder and concealed seat pan. */
function seatJoinAt(z: number) {
  const saddle = supermotoSeatSection(z);
  const influence = MathUtils.smoothstep(z, 0.185, 0.255)
    * (1 - MathUtils.smoothstep(z, 0.675, 0.780));
  const cosine = 0.22 + 0.53 * MathUtils.clamp(saddle.skirt / 0.020, 0, 1);
  return { saddle, influence, x: supermotoSeatLowerWidth(saddle.width, cosine),
    y: saddle.centerY - (saddle.halfDepth + saddle.skirt) * cosine };
}

/** Interpolate the authored upper/lower silhouette without changing seat or frame mounts. */
function sideEdgeAt(edge: readonly Point[], z: number): Point {
  const index = Math.max(0, edge.findIndex(point => point[2] >= z) - 1);
  const a = edge[index], b = edge[Math.min(index + 1, edge.length - 1)];
  const t = MathUtils.clamp((z - a[2]) / (b[2] - a[2] || 1), 0, 1);
  return [MathUtils.lerp(a[0], b[0], t), MathUtils.lerp(a[1], b[1], t), z];
}

/** Mould a number panel around a small upper lip of the right-hand oval can.
 * The matching left panel retains a straight lower line and a flatter face.
 * Both skins share an ordered outline before the interior surface vertices. */
export function supermotoSideCoverGeometry(side: number) {
  const upper = SUPERMOTO_SIDE_COVER.slice(0, 5);
  const lower = [SUPERMOTO_SIDE_COVER[0], ...SUPERMOTO_SIDE_COVER.slice(4).reverse()];
  const stops = [...new Set(SUPERMOTO_SIDE_COVER.map(point => point[2]))].sort((a, b) => a - b);
  const stations: number[] = [stops[0]];
  for (let i = 1; i < stops.length; i++) {
    const steps = Math.max(1, Math.ceil((stops[i] - stops[i - 1]) / 0.018));
    for (let j = 1; j <= steps; j++) stations.push(MathUtils.lerp(stops[i - 1], stops[i], j / steps));
  }
  const cols = 24, rollCols = 8, rows = stations.length - 1, stride = cols + 1;
  const raw: Point[] = [];
  for (const z of stations) {
    const a = sideEdgeAt(upper, z), b = sideEdgeAt(lower, z);
    const join = seatJoinAt(z), shoulder = join.influence;
    // Begin beneath the actual rounded upholstery edge. The raised inner
    // seam turns outward and down into the number panel, rather than joining
    // a horizontal top strip to a flat side at a hard right-angle corner.
    a[0] = MathUtils.lerp(a[0], join.x, shoulder);
    a[1] = MathUtils.lerp(a[1], join.y, shoulder);
    if (side > 0) {
      const e = TUBE_EXHAUST;
      const lip = MathUtils.smoothstep(z, e.startZ - 0.150, e.startZ - 0.070)
        * (1 - MathUtils.smoothstep(z, e.endZ - 0.080, e.endZ - 0.035));
      // Only the upper few millimetres of the compact can sit behind the
      // plastic return. The main number panel stays shallow and narrow.
      b[1] = MathUtils.lerp(b[1], Math.min(b[1], exhaustAxisY(z) + e.verticalRadius * 0.92), lip);
    }
    for (let col = 0; col <= cols; col++) {
      const depth = a[1] - b[1], shoulderDepth = Math.min(MathUtils.lerp(0.055, 0.026, shoulder), depth * 0.42);
      const shoulderFraction = shoulderDepth / Math.max(0.001, depth);
      // Keep a smooth eight-segment turn even where the shoulder is shallow.
      const v = col <= rollCols ? col / rollCols * shoulderFraction
        : MathUtils.lerp(shoulderFraction, 1, (col - rollCols) / (cols - rollCols));
      const roll = MathUtils.clamp(v / Math.max(0.001, shoulderFraction), 0, 1);
      const rolledY = a[1] - shoulderDepth * (1 - Math.cos(roll * Math.PI / 2));
      const remaining = MathUtils.clamp((v - shoulderFraction) / Math.max(0.001, 1 - shoulderFraction), 0, 1);
      const y = v <= shoulderFraction ? rolledY : MathUtils.lerp(a[1] - shoulderDepth, b[1], remaining);
      const shoulderX = MathUtils.lerp(Math.max(a[0], MathUtils.lerp(a[0], b[0], shoulderFraction)),
        Math.max(b[0], a[0] + 0.025), shoulder);
      let x = v <= shoulderFraction
        ? MathUtils.lerp(a[0], shoulderX, Math.sin(roll * Math.PI / 2))
        : MathUtils.lerp(shoulderX, b[0], remaining);
      x += Math.sin(v * Math.PI) * 0.007;
      if (side > 0) {
        // Circumscribe the actual inclined oval shell, including a thermal
        // gap. The rolled shoulder joins the narrow upper saddle seam.
        const e = TUBE_EXHAUST, slope = (e.endY - e.startY) / (e.endZ - e.startZ);
        const dy = (y - exhaustAxisY(z)) / Math.sqrt(1 + slope * slope);
        const ry = e.verticalRadius + 0.014, rx = e.radius + 0.014;
        let wrapX = x;
        if (dy < ry && dy > -ry) wrapX = e.x + rx * Math.sqrt(1 - (dy / ry) ** 2);
        else if (dy >= ry && dy < ry + 0.034)
          wrapX = MathUtils.lerp(e.x, x, MathUtils.smoothstep(dy, ry, ry + 0.034));
        const blend = MathUtils.smoothstep(z, e.startZ - 0.025, e.startZ - 0.010);
        x = MathUtils.lerp(x, Math.max(x, wrapX), blend);
      }
      raw.push([x, y, z]);
    }
  }
  // Keep a real densely sampled perimeter first; the liner reads this exact
  // boundary, so its edge follows the wrap rather than a straight approximation.
  const boundary: number[] = [];
  for (let row = 0; row <= rows; row++) boundary.push(row * stride);
  for (let col = 1; col <= cols; col++) boundary.push(rows * stride + col);
  for (let row = rows - 1; row >= 0; row--) boundary.push(row * stride + cols);
  for (let col = cols - 1; col > 0; col--) boundary.push(col);
  const order = [...boundary], selected = new Set(boundary);
  for (let i = 0; i < raw.length; i++) if (!selected.has(i)) order.push(i);
  const remap = new Map(order.map((old, index) => [old, index]));
  const faceSize = order.length, positions: number[] = [], uv: number[] = [], indices: number[] = [];
  for (const offset of [0.002, -0.002]) for (const index of order) {
    const [x, y, z] = raw[index];
    positions.push(side * (x + offset), y, z);
    uv.push((z + 0.5) / 1.5, (y - 0.65) / 0.35);
  }
  const face = (a: number, b: number, c: number) => {
    const ia = remap.get(a)!, ib = remap.get(b)!, ic = remap.get(c)!;
    if (side > 0) indices.push(ia, ic, ib, ia + faceSize, ib + faceSize, ic + faceSize);
    else indices.push(ia, ib, ic, ia + faceSize, ic + faceSize, ib + faceSize);
  };
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const a = row * stride + col, b = a + stride;
    face(a, a + 1, b); face(a + 1, b + 1, b);
  }
  for (let i = 0; i < boundary.length; i++) {
    const j = (i + 1) % boundary.length;
    if (side > 0) indices.push(i, i + faceSize, j, j, i + faceSize, j + faceSize);
    else indices.push(i, j, i + faceSize, j, j + faceSize, i + faceSize);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.userData.sideBoundaryCount = boundary.length;
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

function sectionAt(sections: readonly Section[], u: number): Section {
  const station = u * (sections.length - 1), i = Math.min(Math.floor(station), sections.length - 2);
  const t = station - i, a = sections[i], b = sections[i + 1];
  return [
    MathUtils.lerp(a[0], b[0], t), MathUtils.lerp(a[1], b[1], t),
    MathUtils.lerp(a[2], b[2], t), MathUtils.lerp(a[3], b[3], t),
  ];
}

/** Long tapered blade; its concealed pan follows the wedge upholstery while
 * the outer lip rolls into the number panels. The rear tip tracks the tyre. */
export function supermotoTailFenderGeometry() {
  return formedSheet(40, 16, (u, v) => {
    const [z, width, crown, edgeY] = sectionAt(SUPERMOTO_TAIL_FENDER, u);
    const corner = MathUtils.smoothstep(u, 0.94, 1) * MathUtils.smoothstep(Math.abs(v), 0.66, 1);
    const join = seatJoinAt(z);
    const panWidth = MathUtils.lerp(width, join.x, join.influence);
    const x = v * panWidth;
    let y = edgeY + crown * (1 - v * v);
    if (z < 0.710) {
      const saddle = join.saddle;
      // The front blend can still be wider than the upholstery. Its hidden
      // return stops at the lower seam height instead of climbing up to the
      // seat centre line outside the rounded cross-section.
      const panX = Math.min(Math.abs(x), join.x);
      const pan = saddle.centerY - (saddle.halfDepth + saddle.skirt)
        * Math.pow(Math.max(0, 1 - (panX / saddle.width) ** 2), 1 / 8) - 0.003;
      const across = MathUtils.lerp(1 - MathUtils.smoothstep(Math.abs(x) / saddle.width, 0.84, 1.12), 1, join.influence);
      const longitudinal = MathUtils.smoothstep(z, 0.115, 0.18)
        * (1 - MathUtils.smoothstep(z, 0.670, 0.710));
      y = MathUtils.lerp(y, pan, across * longitudinal);
    }
    return [x, y, z - corner * 0.013];
  }, [0, -0.007, 0]);
}

export { supermotoFrontFenderGeometry, SUPERMOTO_FRONT_FENDER_MOUNT } from './supermotoFrontFender';
export { supermotoHeadlightMaskGeometry, supermotoLampGeometry, SUPERMOTO_LAMP_BULB, SUPERMOTO_LENS_FACE, SUPERMOTO_MASK_STRAP_ANCHORS } from './supermotoHeadlight';
