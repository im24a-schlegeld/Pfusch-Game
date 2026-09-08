import * as THREE from 'three';
import type { Player, Product } from '../domain/types';

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
const sphereGeometry = new THREE.SphereGeometry(1, 12, 8);
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
function limb(
  parent: THREE.Object3D,
  from: number[],
  to: number[],
  radius: number,
  color: string,
) {
  const a = new THREE.Vector3(...from),
    b = new THREE.Vector3(...to);
  const mesh = cylinder(parent, radius, a.distanceTo(b), 0, 0, 0, color);
  mesh.position.copy(a.add(b).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    b.sub(new THREE.Vector3(...from)).normalize(),
  );
  return mesh;
}
function sphere(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  color: string,
) {
  const m = new THREE.Mesh(sphereGeometry, mat(color));
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
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
export function makeBike(player: Player, products: Product[]) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const color = player.paint;
  const frame =
    player.bike === '450'
      ? '#d36b32'
      : player.bike === '701'
        ? '#b8c56e'
        : '#6a7277';
  const wheels: THREE.Group[] = [];
  for (const z of [-1.03, 1.05]) {
    const wheel = new THREE.Group();
    wheel.position.set(0, 0.48, z);
    body.add(wheel);
    const tire = new THREE.Mesh(
      new THREE.TorusGeometry(0.36, 0.115, 8, 18),
      mat('#111415'),
    );
    tire.rotation.y = Math.PI / 2;
    wheel.add(tire);
    const rim = cylinder(wheel, 0.29, 0.16, 0, 0, 0, player.rims);
    rim.rotation.z = Math.PI / 2;
    const hub = cylinder(wheel, 0.07, 0.28, 0, 0, 0, '#aeb4b5');
    hub.rotation.z = Math.PI / 2;
    for (let k = 0; k < 6; k++) {
      const spoke = box(wheel, 0.12, 0.025, 0.56, 0, 0, 0, '#515b60', 0.8);
      spoke.rotation.x = (k * Math.PI) / 3;
    }
    wheels.push(wheel);
  }
  limb(body, [-0.17, 0.52, 1.05], [-0.17, 0.92, -0.48], 0.065, frame);
  limb(body, [0.17, 0.52, 1.05], [0.17, 0.92, -0.48], 0.065, frame);
  limb(body, [0, 0.83, 0.65], [0, 1.32, -0.3], 0.07, frame);
  limb(body, [0, 1.32, -0.3], [0, 0.62, -0.25], 0.065, frame);
  box(body, 0.51, 0.4, 0.48, 0, 0.76, 0.12, '#444a4c', 0.75);
  for (let i = 0; i < 4; i++)
    box(body, 0.57, 0.025, 0.38, 0, 0.67 + i * 0.07, 0.08, '#8a8f8d', 0.65);
  for (const x of [-0.17, 0.17])
    limb(body, [x, 0.48, -1.03], [x, 1.5, -0.68], 0.049, '#ad9862');
  const fender = box(body, 0.38, 0.09, 0.88, 0, 1.13, -1.02, color);
  fender.rotation.x = -0.1;
  const tail = box(body, 0.47, 0.13, 0.79, 0, 1.27, 0.89, color);
  tail.rotation.x = 0.13;
  box(body, 0.47, 0.15, 1.22, 0, 1.37, 0.28, '#161a1b');
  const tank = box(body, 0.59, 0.37, 0.59, 0, 1.25, -0.31, color);
  tank.rotation.x = -0.18;
  for (const x of [-0.31, 0.31]) {
    const shroud = box(body, 0.06, 0.36, 0.65, x, 1.23, -0.31, color);
    shroud.rotation.x = -0.25;
    const exhaust = cylinder(body, 0.115, 0.65, x * 1.3, 1.05, 0.9, '#a1a5a2');
    exhaust.rotation.x = Math.PI / 2;
    box(body, 0.22, 0.035, 0.15, x * 1.5, 0.71, 0.1, '#8d9595');
  }
  limb(body, [-0.5, 1.59, -0.65], [0.5, 1.59, -0.65], 0.035, '#bdc1bc');
  box(body, 0.37, 0.35, 0.12, 0, 1.47, -0.86, color);
  box(body, 0.27, 0.1, 0.03, 0, 1.47, -0.94, '#f7f4d8');
  box(body, 0.22, 0.045, 0.035, 0, 1.26, 1.3, '#fa4f30');
  if (player.bike === '701') {
    box(body, 0.67, 0.34, 0.6, 0, 1.23, -0.27, color);
    box(body, 0.39, 0.48, 0.12, 0, 1.7, -0.82, '#242c2c');
  }
  const number = textPlane(
    player.decal === '01' ? '01' : 'P /',
    0.42,
    0.17,
    '#171a1b',
  );
  number.position.set(0, 1.55, -0.936);
  number.rotation.y = Math.PI;
  body.add(number);
  const upper = products.find((p) => p.id === player.equipped.upper);
  const selected = upper?.variants.find(
    (v) => v.id === player.variants[upper.id],
  );
  const garment = selected?.baseColor ?? upper?.baseColor ?? '#393d40';
  const rider = new THREE.Group();
  body.add(rider);
  const torso = box(rider, 0.63, 0.7, 0.38, 0, 1.91, 0.22, garment);
  torso.rotation.x = -0.28;
  const isTee = upper?.type.toLowerCase().includes('shirt');
  for (const s of [-1, 1]) {
    limb(rider, [s * 0.29, 2.11, 0.14], [s * 0.4, 1.84, -0.32], 0.12, garment);
    limb(
      rider,
      [s * 0.4, 1.84, -0.32],
      [s * 0.47, 1.6, -0.66],
      0.095,
      isTee ? '#ad856d' : garment,
    );
    sphere(rider, s * 0.47, 1.59, -0.65, 0.1, 0.1, 0.12, '#1b1e1f');
    limb(rider, [s * 0.2, 1.6, 0.45], [s * 0.38, 1.11, -0.03], 0.14, '#202528');
    limb(
      rider,
      [s * 0.38, 1.11, -0.03],
      [s * 0.39, 0.79, 0.25],
      0.115,
      '#202528',
    );
    box(rider, 0.23, 0.17, 0.4, s * 0.39, 0.76, 0.11, '#101415');
  }
  const headProduct = products.find((p) => p.id === player.equipped.head);
  const headVariant = headProduct?.variants.find(
    (v) => v.id === player.variants[headProduct.id],
  );
  const helmetColor =
    headVariant?.baseColor ?? headProduct?.baseColor ?? '#eeeeea';
  sphere(rider, 0, 2.51, 0.02, 0.3, 0.32, 0.32, helmetColor);
  box(rider, 0.5, 0.16, 0.16, 0, 2.51, -0.25, '#151e21', 0.3);
  box(rider, 0.5, 0.035, 0.38, 0, 2.68, -0.19, helmetColor);
  box(rider, 0.37, 0.1, 0.16, 0, 2.32, -0.22, helmetColor);
  const logo = textPlane(
    upper?.title.toLowerCase().includes('keep up') ? 'KEEP UP.' : 'PFUSCH.',
    0.49,
    0.13,
  );
  logo.position.set(0, 2.06, 0.47);
  logo.rotation.x = -0.28;
  rider.add(logo);
  if (
    upper?.type.toLowerCase().includes('hoodie') ||
    upper?.type.toLowerCase().includes('zipper')
  )
    sphere(rider, 0, 2.23, 0.32, 0.27, 0.18, 0.16, garment);
  if (player.equipped.accessory) {
    box(rider, 0.34, 0.4, 0.12, 0.12, 1.95, 0.5, '#191d1b');
    limb(rider, [-0.28, 2.2, 0.49], [0.28, 1.63, 0.49], 0.025, '#979276');
  }
  return { root, body, wheels, rider };
}
export function makeTraffic(kind: string, colorIndex: number) {
  const group = new THREE.Group();
  const colors = ['#526065', '#b8b9ad', '#895c50', '#677762'];
  const color = colors[colorIndex % 4];
  if (kind === 'ramp') {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [
          -1, 0, 1.4, 1, 0, 1.4, -1, 0.65, -1.4, 1, 0, 1.4, 1, 0.65, -1.4, -1,
          0.65, -1.4,
        ],
        3,
      ),
    );
    geometry.computeVertexNormals();
    const ramp = new THREE.Mesh(geometry, mat('#ccda83'));
    group.add(ramp);
    box(group, 0.08, 0.07, 2.8, -0.93, 0.32, 0, '#f2f2df').rotation.x = 0.23;
    box(group, 0.08, 0.07, 2.8, 0.93, 0.32, 0, '#f2f2df').rotation.x = 0.23;
    return group;
  }
  if (kind === 'barrier') {
    box(group, 2, 0.72, 0.7, 0, 0.36, 0, '#bba775');
    for (let i = -1; i <= 1; i++) {
      const stripe = box(
        group,
        0.22,
        0.7,
        0.02,
        i * 0.57,
        0.36,
        0.36,
        '#303635',
      );
      stripe.rotation.z = -0.4;
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
