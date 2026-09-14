import * as THREE from 'three';
import { isRoadEvent, ROAD_EVENTS } from './roadEvents';

const materials = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, metal = 0, rough = 0.75) {
  const key = `${color}:${metal}:${rough}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      metalness: metal,
      roughness: rough,
    });
    materials.set(key, m);
  }
  return m;
}
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 10);
export function box(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: string,
  metal = 0,
) {
  const m = new THREE.Mesh(boxGeometry, mat(color, metal));
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function cylinder(
  parent: THREE.Object3D,
  r: number,
  length: number,
  x: number,
  y: number,
  z: number,
  color: string,
) {
  const m = new THREE.Mesh(cylinderGeometry, mat(color, 0.45));
  m.scale.set(r, length, r);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function textPlane(
  text: string,
  width: number,
  height: number,
  color = '#eeeee8',
  background = 'transparent',
) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  if (background !== 'transparent') {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, 512, 128);
  }
  ctx.fillStyle = color;
  ctx.font = 'italic 900 78px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 65, 490);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.userData.disposable = true;
  return mesh;
}
export function makeTraffic(kind: string, colorIndex: number) {
  const group = new THREE.Group();
  const colors = ['#526065', '#b8b9ad', '#895c50', '#677762'];
  const color = colors[colorIndex % 4];
  if (kind === 'barrier') {
    // Exposed edge of a temporary road plate, low enough for a controlled wheel lift.
    box(group, 2, 0.16, 0.7, 0, 0.08, 0, '#7a7464');
    for (let i = -1; i <= 1; i++) {
      const stripe = box(
        group,
        0.22,
        0.14,
        0.02,
        i * 0.57,
        0.08,
        0.36,
        '#303635',
      );
      stripe.rotation.z = -0.4;
    }
    return group;
  }
  if (isRoadEvent(kind)) {
    const { width, length, height } = ROAD_EVENTS[kind];
    group.name = `road-event-${kind}`;
    const patch = new THREE.Shape();
    for (let i = 0; i < 32; i++) {
      const angle = (i / 32) * Math.PI * 2;
      const edge = 0.92 + 0.08 * Math.sin(i * 2.7) ** 2;
      const x = Math.cos(angle) * width * 0.5 * edge;
      const y = Math.sin(angle) * length * 0.5 * edge;
      if (i === 0) patch.moveTo(x, y);
      else patch.lineTo(x, y);
    }
    patch.closePath();
    const surface = new THREE.Mesh(
      new THREE.ShapeGeometry(patch),
      new THREE.MeshStandardMaterial({
        color:
          kind === 'wet'
            ? '#344d5a'
            : kind === 'pothole'
              ? '#111719'
              : kind === 'gravel'
                ? '#9b917c'
                : '#747775',
        roughness: kind === 'wet' ? 0.12 : 0.94,
        metalness: kind === 'wet' ? 0.45 : 0,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    surface.rotation.x = -Math.PI / 2;
    surface.position.y = 0.022;
    group.add(surface);
    if (kind === 'pothole') {
      const rim = new THREE.BufferGeometry();
      const vertices: number[] = [];
      for (let i = 0; i <= 32; i++) {
        const a = ((i % 32) / 32) * Math.PI * 2;
        const r = 0.92 + 0.08 * Math.sin((i % 32) * 2.7) ** 2;
        for (const edge of [0.82, 1])
          vertices.push(
            ((Math.cos(a) * width) / 2) * r * edge,
            edge === 1 ? height : 0.023,
            ((Math.sin(a) * length) / 2) * r * edge,
          );
      }
      const indices: number[] = [];
      for (let i = 0; i < 32; i++) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
      rim.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(vertices, 3),
      );
      rim.setIndex(indices);
      rim.computeVertexNormals();
      group.add(new THREE.Mesh(rim, mat('#727975')));
    } else if (kind === 'rough' || kind === 'gravel') {
      const stones = new THREE.InstancedMesh(
        boxGeometry,
        mat(kind === 'gravel' ? '#c1b7a0' : '#444b4b'),
        40,
      );
      const transform = new THREE.Object3D();
      for (let i = 0; i < 40; i++) {
        const x = (((i * 0.6180339) % 1) - 0.5) * width * 0.78;
        const z = (((i * 0.4142135) % 1) - 0.5) * length * 0.8;
        transform.position.set(x, height - 0.007, z);
        transform.rotation.y = i * 1.7;
        transform.scale.set(
          kind === 'rough' ? 0.21 : 0.075,
          0.014,
          kind === 'rough' ? 0.045 : 0.08,
        );
        transform.updateMatrix();
        stones.setMatrixAt(i, transform.matrix);
      }
      group.add(stones);
    } else {
      for (let i = 0; i < 3; i++) {
        const glint = box(
          group,
          0.6 - i * 0.12,
          0.003,
          0.035,
          (i - 1) * 0.32,
          0.025,
          (i - 1) * 0.7,
          '#8aabb7',
        );
        glint.rotation.y = -0.3;
      }
    }
    return group;
  }
  const van = kind === 'van';
  box(group, 1.65, 0.66, 3.9, 0, 0.68, 0, color);
  box(
    group,
    1.52,
    van ? 1.8 : 0.84,
    van ? 3.3 : 2.1,
    0,
    van ? 1.63 : 1.37,
    van ? -0.05 : -0.3,
    color,
  );
  box(
    group,
    1.34,
    0.51,
    0.025,
    0,
    van ? 1.95 : 1.45,
    van ? -1.72 : -1.37,
    '#2c3f45',
  );
  if (!van) box(group, 1.34, 0.45, 0.03, 0, 1.4, 0.77, '#293b40');
  for (const s of [-1, 1]) {
    box(group, 0.43, 0.13, 0.035, s * 0.55, 0.81, 1.97, '#df5d45');
    for (const z of [-1.22, 1.24]) {
      const tire = cylinder(group, 0.34, 0.18, s * 0.83, 0.38, z, '#181c1c');
      tire.rotation.z = Math.PI / 2;
    }
  }
  box(group, 0.43, 0.12, 0.02, 0, 0.48, 1.98, '#e0dfcc');
  return group;
}
export function sign(text: string) {
  const mesh = textPlane(text, 6, 1.5, '#e9ede1', '#272d2f');
  return mesh;
}
export function disposeUnique(root: THREE.Object3D) {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.userData.disposable) {
      o.geometry.dispose();
      const m = o.material as THREE.MeshBasicMaterial;
      m.map?.dispose();
      m.dispose();
    }
  });
}
