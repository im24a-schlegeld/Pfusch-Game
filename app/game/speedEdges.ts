import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera } from 'three';
import { speedEdgeIntensity } from './rideVisualFeedback';

/** Twelve pooled camera-edge strips, one draw call and no postprocessing. */
export function createSpeedEdges(camera: PerspectiveCamera) {
  const positions = new Float32Array(12 * 6 * 3);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  const material = new MeshBasicMaterial({
    color: '#ffffff', transparent: true, opacity: 0,
    depthTest: false, depthWrite: false, fog: false, toneMapped: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'speed-edge-streaks';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1000;
  mesh.visible = false;
  camera.add(mesh);
  const put = (vertex: number, x: number, y: number) => {
    const offset = vertex * 3;
    positions[offset] = x; positions[offset + 1] = y; positions[offset + 2] = -1;
  };
  let phase = 0;
  return {
    mesh,
    update(dt: number, speed: number, active: boolean, reducedMotion: boolean) {
      const strength = speedEdgeIntensity(speed, active, reducedMotion);
      mesh.visible = strength > 0;
      if (!mesh.visible) { phase = 0; return; }
      phase = (phase + Math.max(0, dt) * (0.65 + strength * 0.85)) % 1;
      material.opacity = strength * 0.075;
      const halfHeight = Math.tan(camera.fov * Math.PI / 360);
      const halfWidth = halfHeight * camera.aspect;
      for (let index = 0; index < 12; index++) {
        const side = index < 6 ? -1 : 1;
        const row = index % 6;
        const t = (phase + row * 0.163 + (side + 1) * 0.041) % 1;
        const x0 = 0.75 + t * 0.24, x1 = x0 + 0.045 + strength * 0.065;
        const y0 = -0.71 + row * 0.284;
        const y1 = y0 * x1 / x0;
        const width = 0.0016;
        const start = index * 6;
        // Mirroring reverses winding; restore the front face on the left edge.
        put(start, side * x0 * halfWidth, (y0 - width) * halfHeight);
        put(start + (side < 0 ? 2 : 1), side * x1 * halfWidth, (y1 - width) * halfHeight);
        put(start + (side < 0 ? 1 : 2), side * x1 * halfWidth, (y1 + width) * halfHeight);
        put(start + 3, side * x0 * halfWidth, (y0 - width) * halfHeight);
        put(start + (side < 0 ? 5 : 4), side * x1 * halfWidth, (y1 + width) * halfHeight);
        put(start + (side < 0 ? 4 : 5), side * x0 * halfWidth, (y0 + width) * halfHeight);
      }
      geometry.attributes.position.needsUpdate = true;
    },
    dispose() { mesh.removeFromParent(); geometry.dispose(); material.dispose(); },
  };
}
