import { BufferGeometry, CylinderGeometry, Float32BufferAttribute, ShapeUtils, TorusGeometry, Vector2, Vector3, Quaternion } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
type Point = [number, number, number];
type Outline = readonly (readonly [number, number])[];
/** The red mark is the new lower edge. Keep the fender crown directly below. */
export const SUPERMOTO_MASK_BASE: Point = [0, 0.922, -0.550];
const LAMP_OPENING: Outline = [
  [-0.024,0.941],[0,0.935],[0.024,0.941],[0.055,0.955],
  [0.071,0.989],[0.083,1.026],[0.083,1.047],[0.071,1.064],
  [0.037,1.055],[0,1.051],[-0.037,1.055],[-0.071,1.064],
  [-0.083,1.047],[-0.083,1.026],[-0.071,0.989],[-0.055,0.955],
];
function maskFrontZ(y: number, x: number) {
  return SUPERMOTO_MASK_BASE[2] + (y-SUPERMOTO_MASK_BASE[1])*0.475 + x*x*1.65;
}
/** Shared light anchor stays recessed behind the actual transparent lens. */
export const SUPERMOTO_LENS_FACE: Point = [0,1.008,maskFrontZ(1.008,0)-0.004];
export const SUPERMOTO_LAMP_BULB: Point = [0,1.008,SUPERMOTO_LENS_FACE[2]+0.030];
export const SUPERMOTO_MASK_STRAP_ANCHORS: Point[] = [[0.076,0.954],[0.128,1.080]]
  .map(([x,y])=>[x,y,maskFrontZ(y,x)+0.004]);

/** Thin shaped front and back faces, including real return walls around holes. */
function maskShell(outline: Outline, hole: Outline | undefined, thickness: number, offset: number, lensCenter = false, ridge?: Outline) {
  const contours = [outline, ...(hole ? [hole] : [])];
  const points = contours.flat();
  const ridgeStart = points.length;
  if (ridge) points.push(...ridge);
  if (lensCenter) points.push([SUPERMOTO_LENS_FACE[0], SUPERMOTO_LENS_FACE[1]]);
  const count = points.length;
  const triangles = ridge && hole
    ? [
      ...ShapeUtils.triangulateShape(outline.map(p => new Vector2(...p)), [ridge.map(p => new Vector2(...p))])
        .map(face => face.map(i => i < outline.length ? i : ridgeStart + i - outline.length)),
      ...ShapeUtils.triangulateShape(ridge.map(p => new Vector2(...p)), [hole.map(p => new Vector2(...p))])
        .map(face => face.map(i => i < ridge.length ? ridgeStart + i : outline.length + i - ridge.length)),
    ]
    : lensCenter
    ? outline.map((_, i) => [i, (i + 1) % outline.length, count - 1])
    : ShapeUtils.triangulateShape(outline.map(p => new Vector2(...p)), hole ? [hole.map(p => new Vector2(...p))] : []);
  const positions: number[] = [], indices: number[] = [], uv: number[] = [];
  for (const depth of [offset, offset + thickness]) for (const [i, [x, y]] of points.entries()) {
    const ridgeDepth = ridge && i >= ridgeStart ? -0.008 : 0;
    positions.push(x, y, maskFrontZ(y, x) + depth + ridgeDepth); uv.push((x + 0.145) / 0.290, (y - 0.885) / 0.280);
  }
  for (const [a, b, c] of triangles) {
    const pa = points[a], pb = points[b], pc = points[c];
    const positive = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]) > 0;
    indices.push(a, positive ? c : b, positive ? b : c,
      a + count, (positive ? b : c) + count, (positive ? c : b) + count);
  }
  let first = 0;
  for (const [contourIndex, contour] of contours.entries()) {
    for (let i = 0; i < contour.length; i++) {
      const a = first + i, b = first + (i + 1) % contour.length;
      if (contourIndex === 0) indices.push(a, b, a + count, b, b + count, a + count);
      else indices.push(a, a + count, b, b, a + count, b + count);
    }
    first += contour.length;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

/** Rounded upper board, concave top, folded cheeks and an open right vent.
 * The low central V belongs to the lamp; slim outer tips frame the fender. */
export function supermotoHeadlightMaskGeometry() {
  const outline: Outline = [
    [-0.051,0.922],[0.051,0.922],[0.066,0.925],[0.093,0.970],
    [0.118,1.014],[0.136,1.060],[0.141,1.090],
    [0.104,1.076],[0.098,1.079],[0.098,1.090],[0.137,1.104],
    [0.145,1.107],[0.132,1.153],[0.127,1.168],[0.120,1.173],
    [0.107,1.171],[0.073,1.165],[0.035,1.159],[0,1.157],
    [-0.035,1.159],[-0.073,1.165],[-0.107,1.171],[-0.120,1.173],
    [-0.127,1.168],[-0.132,1.153],[-0.145,1.107],
    [-0.143,1.083],[-0.136,1.060],[-0.118,1.014],[-0.093,0.970],[-0.066,0.925],
  ];
  // Front is -Z: the viewer's right is the motorcycle's negative X side.
  // Reverse the reflected outline to retain outward-facing return walls.
  // Compact only the upper board to meet the lower cockpit. The optical
  // opening, mounting straps and mask-to-fender seam retain their real fit.
  const frontOutline: Outline = outline.map(([x,y]) => [
    -x, y > 1.107 ? 1.107 + (y - 1.107) * 0.70 : y,
  ] as const).reverse();
  return maskShell(frontOutline,LAMP_OPENING,0.004,0,false,lampOutline(1.10));
}

function lampOutline(scale: number): Outline {
  return LAMP_OPENING.map(([x, y]) => [x * scale, SUPERMOTO_LENS_FACE[1] + (y - SUPERMOTO_LENS_FACE[1]) * scale] as const);
}

export function supermotoLampGeometry(part: 'bezel' | 'reflector' | 'glass' | 'light-guide') {
  if(part==='bezel')return maskShell(lampOutline(1.035),lampOutline(0.89),0.012,-0.001);
  if(part==='glass')return maskShell(lampOutline(0.90),undefined,0.0025,-0.004,true);
  if(part==='light-guide')return maskShell([
    [-0.071,1.058],[-0.035,1.048],[0,1.045],[0.035,1.048],[0.071,1.058],
    [0.078,1.043],[0.072,1.029],[0.034,1.037],[0,1.034],[-0.034,1.037],[-0.072,1.029],[-0.078,1.043],
  ],undefined,0.003,0.001);
  // A dark recessed optical housing, rather than a single opaque silver pane.
  return maskShell(lampOutline(0.90),undefined,0.003,0.018,true);
}

const PROJECTORS: readonly (readonly [number,number])[] = [
  [-0.026,1.022],[0.026,1.022],[0,1.009],[-0.026,0.994],[0.026,0.994],
];
/** Five real projector rings and lenses, merged into two bounded draw calls. */
export function supermotoProjectorGeometry(part: 'socket' | 'lens') {
  const front=new Vector3(0,0.475,-1).normalize();
  const rotation=new Quaternion().setFromUnitVectors(new Vector3(0,0,1),front);
  const parts=PROJECTORS.map(([x,y])=>{
    const geometry=part==='socket'
      ? new TorusGeometry(0.0105,0.0022,6,20)
      : new CylinderGeometry(0.0084,0.0084,0.004,20,1);
    if(part==='lens')geometry.rotateX(Math.PI/2);
    geometry.applyQuaternion(rotation);
    geometry.translate(x,y,maskFrontZ(y,x)+(part==='socket'?0.004:0.003));
    return geometry;
  });
  const merged=mergeGeometries(parts,false)!;
  parts.forEach(geometry=>geometry.dispose());
  return merged;
}

export function supermotoLowerLightGuideGeometry() {
  return maskShell([
    [-0.063,0.995],[-0.053,0.962],[-0.020,0.946],[0,0.942],[0.020,0.946],[0.053,0.962],[0.063,0.995],
    [0.053,0.990],[0.044,0.967],[0.015,0.953],[0,0.951],[-0.015,0.953],[-0.044,0.967],[-0.053,0.990],
  ],undefined,0.003,0.001);
}
