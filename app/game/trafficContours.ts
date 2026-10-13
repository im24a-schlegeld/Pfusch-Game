import * as THREE from 'three';

const MAX_SEGMENTS = 1024;
const TIRE_SEGMENTS = 32;
const majorPart = /^(sculpted-body|raked-cabin|van-cab-lower|cab-roof|cargo-shell|tow-deck-and-ramp|door-skin|front-bumper|rear-bumper-inset|cab-step|deck-front-edge|rear-mudflap|headboard-.+|winch|barrier-board|weighted-foot|barrier-post)$|window|windscreen|glass/;

/** A clone keeps this prototype, so visual lines never become collision/ramp picks. */
class TrafficContour extends THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> {
  override raycast() {}
}

/** One static contour draw for a whole pooled vehicle. Extract real form edges
 * before material batching removes part identities; omit hardware and smooth
 * triangulation. Colour variants and pool clones share the finished resources.
 */
export function createTrafficContour(
  sources: readonly THREE.Mesh[],
  tires: readonly THREE.Group[],
) {
  const vertices: number[] = [];
  const append = (a: THREE.Vector3, b: THREE.Vector3) => {
    if (vertices.length >= MAX_SEGMENTS * 6) return;
    vertices.push(a.x, a.y, a.z, b.x, b.y, b.z);
  };
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  // The authored tire is a round torus. Its outer and shoulder circles remain
  // identical when the wheel rolls, so these boundaries need no wheel copies
  // or per-frame updates. Every circle lies on the actual tire surface.
  for (const tire of tires) {
    const radius = tire.userData.radius as number;
    for (const [x, ringRadius] of [[0, radius], [-0.095, radius - 0.095], [0.095, radius - 0.095]]) {
      for (let segment = 0; segment < TIRE_SEGMENTS; segment++) {
        const start = segment * Math.PI * 2 / TIRE_SEGMENTS;
        const end = (segment + 1) * Math.PI * 2 / TIRE_SEGMENTS;
        a.set(x, Math.cos(start) * ringRadius, Math.sin(start) * ringRadius).add(tire.position);
        b.set(x, Math.cos(end) * ringRadius, Math.sin(end) * ringRadius).add(tire.position);
        append(a, b);
      }
    }
  }
  for (const source of sources) {
    if (!majorPart.test(source.name)) continue;
    source.updateMatrix();
    // Welded face adjacency keeps window borders and strong body bends while
    // excluding coplanar fan diagonals and the smooth wheel-arch tessellation.
    const edges = new THREE.EdgesGeometry(source.geometry, 40);
    const positions = edges.getAttribute('position');
    for (let i = 0; i < positions.count; i += 2) {
      a.fromBufferAttribute(positions, i).applyMatrix4(source.matrix);
      b.fromBufferAttribute(positions, i + 1).applyMatrix4(source.matrix);
      append(a, b);
    }
    edges.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  const material = new THREE.LineBasicMaterial({ color: '#080a0e', fog: true,
    depthTest: true, depthWrite: false, toneMapped: false });
  material.name = 'cartoon-traffic-contour';
  material.onBeforeCompile = shader => {
    // Line primitives ignore polygonOffset. A tiny clip-depth bias keeps a
    // real surface border stable without revealing edges behind the body.
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\ngl_Position.z -= 0.00001 * gl_Position.w;');
  };
  material.customProgramCacheKey = () => 'pfusch-traffic-contour-v1';
  const contour = new TrafficContour(geometry, material);
  contour.name = 'cartoon-traffic-contour';
  contour.userData.cartoonTrafficContour = true;
  // Opaque body surfaces write depth first; concealed rear edges stay hidden.
  contour.renderOrder = 1;
  return contour;
}
