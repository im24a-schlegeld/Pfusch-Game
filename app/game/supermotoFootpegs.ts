import * as THREE from 'three';
import { supermotoFootpegSurfaces, type FitPoint } from './supermotoFit';

/** Called instead of the original cylinder peg, once for each Supermoto side. */
export function addSupermotoFootpeg(
  body: THREE.Group,
  side: number,
  contact: FitPoint,
  alloy: THREE.MeshStandardMaterial,
  dark: THREE.MeshStandardMaterial,
) {
  const group = new THREE.Group();
  group.name = 'rider-footpeg';
  group.userData.side = side;
  group.userData.contact = [side * contact[0], contact[1], contact[2]];
  group.userData.version = 'supermoto-fit-v37';
  const finish = alloy.clone();
  finish.metalness = 0.72;
  finish.roughness = 0.44;
  for (const part of supermotoFootpegSurfaces(side, contact)) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(part.positions, 3));
    geometry.setIndex(part.indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, part.finish === 'alloy' ? finish : dark);
    mesh.name = `supermoto-footpeg-${part.name}`;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  body.add(group);
  return group;
}
