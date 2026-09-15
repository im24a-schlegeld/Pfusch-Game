import * as THREE from 'three';
import { SIGN_COLLECTIBLES, type SignId } from './signCollectibles';

interface SignViewState {
  active: boolean;
  id: SignId;
  lane: number;
  z: number;
}

/** A fixed pool. The six supplied bitmaps are shared by every pickup slot. */
export function makeSignCollectibleView(
  capacity: number,
  laneWidth: number,
  low = false,
) {
  const root = new THREE.Group();
  root.name = 'sign-collectibles';
  const backingMaterial = new THREE.MeshStandardMaterial({
    color: '#98a5ac',
    metalness: 0.62,
    roughness: 0.4,
  });
  let disposed = false;
  const definitions = SIGN_COLLECTIBLES.map((definition) => {
    const width = definition.shape === 'triangle' ? 1.17 : 1.05;
    const height = definition.shape === 'triangle' ? 1.02 : 1.05;
    const rounded = new THREE.Shape();
    const radius = 0.12,
      corner = width / 2 - radius;
    rounded.absarc(corner, corner, radius, 0, Math.PI / 2, false);
    rounded.absarc(-corner, corner, radius, Math.PI / 2, Math.PI, false);
    rounded.absarc(-corner, -corner, radius, Math.PI, Math.PI * 1.5, false);
    rounded.absarc(corner, -corner, radius, Math.PI * 1.5, Math.PI * 2, false);
    rounded.closePath();
    const geometry =
      definition.shape === 'circle'
        ? new THREE.CircleGeometry(width / 2, low ? 32 : 48)
        : definition.shape === 'rounded-square'
          ? new THREE.ShapeGeometry(rounded, 8)
          : new THREE.PlaneGeometry(width, height);
    const uv = geometry.getAttribute('uv');
    if (definition.shape === 'rounded-square') {
      const points = geometry.getAttribute('position');
      for (let i = 0; i < uv.count; i++)
        uv.setXY(i, points.getX(i) / width + 0.5, points.getY(i) / height + 0.5);
    }
    const [left, bottom, right, top] = definition.crop;
    for (let i = 0; i < uv.count; i++)
      uv.setXY(
        i,
        left + uv.getX(i) * (right - left),
        bottom + uv.getY(i) * (top - bottom),
      );
    const texture = new THREE.Texture();
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    const material = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      map: texture,
      side: THREE.DoubleSide,
      alphaTest: 0.35,
      toneMapped: false,
    });
    let backing: THREE.BufferGeometry;
    if (definition.shape === 'circle') {
      backing = new THREE.CylinderGeometry(width / 2, width / 2, 0.022, 32);
      backing.rotateX(Math.PI / 2);
    } else if (definition.shape === 'rounded-square') {
      backing = new THREE.ExtrudeGeometry(rounded, {
        depth: 0.022,
        bevelEnabled: false,
        curveSegments: 8,
      });
      backing.translate(0, 0, -0.011);
    } else if (definition.shape === 'triangle') {
      const triangle = new THREE.Shape();
      triangle.moveTo(-width / 2, -height / 2);
      triangle.lineTo(width / 2, -height / 2);
      triangle.lineTo(0, height / 2);
      triangle.closePath();
      backing = new THREE.ExtrudeGeometry(triangle, {
        depth: 0.022,
        bevelEnabled: false,
      });
      backing.translate(0, 0, -0.011);
    } else backing = new THREE.BoxGeometry(width, height, 0.022);
    const entry = {
      definition,
      geometry,
      backing,
      texture,
      material,
      ready: false,
    };
    // The originals remain byte-for-byte intact. Decode only a bounded bitmap
    // for the GPU, so the supplied 3840px H never allocates a 4K game texture.
    const maxSize = low ? 256 : 512;
    const scale = Math.min(1, maxSize / Math.max(...definition.sourceSize));
    const loader = new THREE.ImageBitmapLoader();
    loader.setOptions({
      imageOrientation: 'flipY',
      resizeWidth: Math.max(1, Math.round(definition.sourceSize[0] * scale)),
      resizeHeight: Math.max(1, Math.round(definition.sourceSize[1] * scale)),
      resizeQuality: 'high',
    });
    loader.load(definition.asset, (bitmap) => {
      if (disposed) {
        bitmap.close();
        return;
      }
      texture.image = bitmap;
      texture.needsUpdate = true;
      entry.ready = true;
    });
    return entry;
  });
  const lookup = new Map(
    definitions.map((entry) => [entry.definition.id, entry]),
  );
  const slots = Array.from({ length: capacity }, (_, index) => {
    const group = new THREE.Group();
    group.name = `sign-pickup-${index}`;
    const entry = definitions[0];
    const face = new THREE.Mesh(entry.geometry, entry.material);
    face.name = 'sign-original-artwork';
    face.position.z = 0.013;
    const backing = new THREE.Mesh(entry.backing, backingMaterial);
    backing.name = 'sign-metal-backing';
    group.add(backing, face);
    group.visible = false;
    root.add(group);
    return { group, face, backing, id: 'P' as SignId };
  });
  return {
    root,
    update(signs: readonly SignViewState[], elapsed: number) {
      if (disposed) return;
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i],
          sign = signs[i];
        const entry = sign ? lookup.get(sign.id) : undefined;
        slot.group.visible = !!sign?.active && !!entry?.ready;
        if (!slot.group.visible || !sign || !entry) continue;
        if (slot.id !== sign.id) {
          slot.face.geometry = entry.geometry;
          slot.face.material = entry.material;
          slot.backing.geometry = entry.backing;
          slot.id = sign.id;
        }
        slot.group.userData.signId = sign.id;
        slot.group.position.set(
          sign.lane * laneWidth,
          1.36 + Math.sin(elapsed * 2.1 + i * 0.8) * 0.07,
          -sign.z,
        );
        slot.group.rotation.set(-0.1, 0, entry.definition.rotation);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      for (const entry of definitions) {
        entry.geometry.dispose();
        entry.backing.dispose();
        entry.material.dispose();
        (entry.texture.image as ImageBitmap | null)?.close();
        entry.texture.dispose();
      }
      backingMaterial.dispose();
    },
  };
}
