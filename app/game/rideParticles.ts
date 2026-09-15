import * as THREE from 'three';
import { TAIL_CONTACT } from './tailContact';

/** One fixed GPU buffer for exhaust, metal sparks and colored plastic chips. */
export function createRideParticles(scene: THREE.Scene, low: boolean) {
  const count = low ? 64 : 128;
  const positions = new Float32Array(count * 3),
    velocities = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3),
    sizes = new Float32Array(count);
  const opacity = new Float32Array(count),
    kinds = new Float32Array(count);
  const ages = new Float32Array(count),
    lives = new Float32Array(count);
  const geometry = new THREE.BufferGeometry();
  const attributes = {
    position: new THREE.BufferAttribute(positions, 3),
    color: new THREE.BufferAttribute(colors, 3),
    particleSize: new THREE.BufferAttribute(sizes, 1),
    particleOpacity: new THREE.BufferAttribute(opacity, 1),
    particleKind: new THREE.BufferAttribute(kinds, 1),
  };
  Object.entries(attributes).forEach(([key, attribute]) => {
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(key, attribute);
  });
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexColors: true,
    // These unlit tints retain the selected paint/display colors. They still
    // require the renderer's output conversion from THREE.Color's linear RGB.
    toneMapped: false,
    vertexShader: `attribute float particleSize; attribute float particleOpacity; attribute float particleKind;
      varying vec3 tint; varying float fade; varying float kind;
      void main(){vec4 p=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*p;
      gl_PointSize=clamp(particleSize*(particleKind>.5?850.:340.)/max(1.,-p.z),1.,48.);
      tint=color; fade=particleOpacity; kind=particleKind;}`,
    fragmentShader: `varying vec3 tint; varying float fade; varying float kind;
      void main(){vec2 p=gl_PointCoord*2.-1.; float edge;
      if(kind<.5){edge=1.-smoothstep(.12,1.,dot(p,p));}
      else if(kind<1.5){edge=1.-smoothstep(.10,.42,abs(p.x+p.y*.6));edge*=1.-smoothstep(.6,1.,abs(p.y));}
      else {edge=1.-smoothstep(.48,.7,max(abs(p.x),abs(p.y)));}
      if(edge*fade<.005)discard; gl_FragColor=vec4(tint,edge*fade);
      #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'ride-exhaust-and-scrape-particles';
  points.frustumCulled = false;
  scene.add(points);
  let index = 0,
    smokeCarry = 0,
    scrapeCarry = 0,
    rng = 273;
  const random = () => {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng / 4294967296;
  };
  const paint = new THREE.Color();
  const white = new THREE.Color('#ffffff');
  const spawn = (origin: THREE.Vector3, kind: number, paintColor: string) => {
    const i = index;
    index = (index + 1) % count;
    const offset = i * 3;
    positions[offset] = origin.x + (random() - 0.5) * 0.025;
    positions[offset + 1] = Math.max(0.03, origin.y);
    positions[offset + 2] = origin.z;
    velocities[offset] = (random() - 0.5) * (kind ? 3.4 : 0.17);
    velocities[offset + 1] = kind
      ? 0.9 + random() * 1.4
      : 0.12 + random() * 0.17;
    velocities[offset + 2] = kind ? 4 + random() * 5 : 0.3 + random() * 0.4;
    ages[i] = 0;
    lives[i] = kind ? 0.4 + random() * 0.3 : 0.6 + random() * 0.5;
    kinds[i] = kind;
    sizes[i] = kind ? 0.1 + random() * (kind === 1 ? 0.08 : 0.045) : 0.09;
    paint.set(kind === 0 ? '#87949b' : kind === 1 ? '#ffe4a0' : paintColor);
    if (kind === 2) paint.lerp(white, 0.22);
    colors[offset] = paint.r;
    colors[offset + 1] = paint.g;
    colors[offset + 2] = paint.b;
  };
  return {
    update(
      dt: number,
      active: boolean,
      emitting: boolean,
      speed: number,
      model: string,
      exhaust: THREE.Vector3,
      tail: THREE.Vector3,
      scrape: number,
      scrapeMaterial: 'metal' | 'plastic' | null,
      paintColor: string,
      reducedMotion: boolean,
    ) {
      if (!active || dt <= 0) return;
      const step = Math.min(dt, 0.05);
      if (emitting && !reducedMotion) {
        smokeCarry +=
          step * (model === '125' ? 10 : model === 'scooter' ? 8 : 3);
        while (smokeCarry >= 1) {
          spawn(exhaust, 0, paintColor);
          smokeCarry--;
        }
        scrapeCarry +=
          step * (scrape > 0 ? 0.4 + scrape * 0.6 : 0) * (low ? 56 : 90);
        while (scrapeCarry >= 1) {
          spawn(tail, scrapeMaterial === 'metal' ? 1 : 2, paintColor);
          scrapeCarry--;
        }
      }
      for (let i = 0; i < count; i++) {
        ages[i] += step;
        if (ages[i] >= lives[i]) {
          opacity[i] = 0;
          continue;
        }
        const at = i * 3,
          smoke = kinds[i] === 0;
        positions[at] += velocities[at] * step;
        positions[at + 1] += velocities[at + 1] * step;
        positions[at + 2] += (velocities[at + 2] + speed * 0.8) * step;
        if (!smoke) velocities[at + 1] -= step * 5;
        if (positions[at + 1] < 0.025) {
          positions[at + 1] = 0.025;
          velocities[at + 1] *= -0.18;
        }
        if (smoke) sizes[i] += step * 0.18;
        const remaining = 1 - ages[i] / lives[i];
        opacity[i] = smoke ? remaining * 0.18 : Math.sqrt(remaining);
      }
      Object.values(attributes).forEach((attribute) => {
        attribute.needsUpdate = true;
      });
    },
    dispose() {
      scene.remove(points);
      geometry.dispose();
      material.dispose();
    },
  };
}

/** Cache attachment objects once; the current world transform is used each frame. */
export function particleAnchors(body: THREE.Object3D, model: string) {
  const outlet = body.getObjectByName('open-silencer-outlet');
  const silencer = body.getObjectByName('single-exhaust') as
    | THREE.Mesh
    | undefined;
  const anchor = outlet ?? silencer ?? body;
  const end = new THREE.Vector3();
  if (!outlet && silencer) {
    silencer.geometry.computeBoundingBox();
    end.set(0, silencer.geometry.boundingBox!.max.y, 0);
  }
  const tail = new THREE.Vector3(
    ...(TAIL_CONTACT[model] ?? TAIL_CONTACT['450']).point,
  );
  return {
    copy(exhaust: THREE.Vector3, contact: THREE.Vector3) {
      anchor.updateWorldMatrix(true, false);
      exhaust.copy(end).applyMatrix4(anchor.matrixWorld);
      contact.copy(tail).applyMatrix4(body.matrixWorld);
      contact.y = Math.max(0.025, contact.y);
    },
  };
}
