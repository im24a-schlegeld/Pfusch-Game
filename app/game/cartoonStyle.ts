import * as THREE from 'three';

const applied = new WeakMap<THREE.Material, THREE.Material['onBeforeCompile']>();

/** Cel light and ink are part of the existing material pass: no fullscreen
 * effects, outline copies, extra lights or per-frame geometry allocations.
 * Keep texture/alpha channels intact so real clothing prints stay recognizable.
 */
export function applyCartoonMaterial(material: THREE.Material, boxInk = false, contour = true) {
  if (!(material instanceof THREE.MeshStandardMaterial)) return;
  material.metalness = Math.min(material.metalness, 0.12);
  material.roughness = Math.max(material.roughness, 0.82);
  material.envMapIntensity = Math.min(material.envMapIntensity, 0.3);
  if (applied.get(material) === material.onBeforeCompile) return;
  const before = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.call(material);
  const ink = material.transparent || !contour ? '0.0' : '0.92';
  const hero = material.userData.pfuschCartoonHero === true;
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    // Carbon/colour changes can wrap a previously styled shader. Never apply
    // cel shading twice, and never replace that artwork's existing hook.
    if (shader.fragmentShader.includes('// PFUSCH_CARTOON')) return;
    if (hero) {
      shader.vertexShader = shader.vertexShader.replace('#include <common>',
        '#include <common>\nattribute float cartoonGarmentEdge;\nvarying float vCartoonGarmentEdge;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCartoonGarmentEdge = cartoonGarmentEdge;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
        '#include <common>\nvarying float vCartoonGarmentEdge;');
    }
    if (boxInk) {
      shader.vertexShader = shader.vertexShader.replace('#include <common>',
        '#include <common>\nattribute vec4 cartoonBox;\nvarying vec4 vCartoonBox;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCartoonBox = cartoonBox;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
        '#include <common>\nvarying vec4 vCartoonBox;');
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      // PFUSCH_CARTOON
      vec3 cartoonDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
      float cartoonBase = max(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.025);
      float cartoonLight = dot(cartoonDiffuse, vec3(0.2126, 0.7152, 0.0722)) / cartoonBase;
      float cartoonBand = mix(0.24, 0.52, smoothstep(0.16, 0.21, cartoonLight));
      cartoonBand = mix(cartoonBand, 0.80, smoothstep(0.48, 0.54, cartoonLight));
      cartoonBand = mix(cartoonBand, 1.08, smoothstep(0.94, 1.02, cartoonLight));
      ${hero ? `cartoonBand = mix(0.36, 0.72, smoothstep(0.27, 0.32, cartoonLight));
      cartoonBand = mix(cartoonBand, 1.10, smoothstep(0.83, 0.90, cartoonLight));` : ''}
      vec3 cartoonTint = mix(vec3(1.0), cartoonDiffuse / max(max(cartoonDiffuse.r, cartoonDiffuse.g), max(cartoonDiffuse.b, 0.001)), 0.12);
      outgoingLight = diffuseColor.rgb * cartoonTint * cartoonBand + totalEmissiveRadiance;
      float cartoonFacing = abs(dot(normal, normalize(vViewPosition)));
      float cartoonWidth = min(0.12, max(0.025, fwidth(cartoonFacing) * 1.15));
      float cartoonInk = 1.0 - smoothstep(0.045, 0.045 + cartoonWidth, cartoonFacing);
      ${hero ? `
      // The cuff is a real fabric/skin boundary even when it faces the camera.
      // Screen derivatives keep this surface stroke narrow on every bike pose.
      float garmentEdgeWidth = max(fwidth(vCartoonGarmentEdge), 0.00001);
      cartoonInk = max(cartoonInk, 1.0 - smoothstep(garmentEdgeWidth * 0.35, garmentEdgeWidth * 1.35, vCartoonGarmentEdge));
      ` : ''}
      ${boxInk ? `
      vec3 cartoonFace = max(vec3(0.5) - abs(vCartoonBox.xyz), vec3(0.0));
      float cartoonEdge = min(max(cartoonFace.x, cartoonFace.y), min(max(cartoonFace.y, cartoonFace.z), max(cartoonFace.z, cartoonFace.x)));
      float cartoonEdgeWidth = max(fwidth(cartoonEdge) * 0.85, 0.00001);
      cartoonInk = max(cartoonInk, (1.0 - smoothstep(cartoonEdgeWidth * 0.35, cartoonEdgeWidth * 1.35, cartoonEdge)) * vCartoonBox.w);
      ` : ''}
      // Emissive lamps retain their signal colours; ink never masks a light.
      float cartoonEmission = clamp(max(totalEmissiveRadiance.r, max(totalEmissiveRadiance.g, totalEmissiveRadiance.b)), 0.0, 1.0);
      outgoingLight = mix(outgoingLight, vec3(0.004, 0.006, 0.009), cartoonInk * ${ink} * (1.0 - cartoonEmission));
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey = () => `${previousKey}:pfusch-cartoon-v1:${boxInk ? 'box' : 'round'}:${ink}:${hero ? 'hero' : 'world'}`;
  material.userData.pfuschCartoon = true;
  material.needsUpdate = true;
  applied.set(material, material.onBeforeCompile);
}

export function applyCartoonStyle(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material])
      applyCartoonMaterial(material);
  });
}

/** Keep the actual clothing artwork, but remove microscopic surface relief and
 * use three clear light bands on the foreground rider and motorcycle. */
export function applyCartoonHeroStyle(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.userData.cartoonOutline) return;
    if (!object.geometry.getAttribute('cartoonGarmentEdge')) {
      const positions = object.geometry.getAttribute('position');
      const edge = new THREE.BufferAttribute(new Float32Array(positions.count).fill(1), 1);
      const uv = object.geometry.getAttribute('uv');
      if (uv && /^(garment-sleeve|tailored-garment)$/.test(object.name))
        for (let i = 0; i < edge.count; i++) edge.setX(i, Math.max(0, uv.getY(i)));
      object.geometry.setAttribute('cartoonGarmentEdge', edge);
    }
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      material.userData.pfuschCartoonHero = true;
      material.normalMap = null;
      material.bumpMap = null;
      if (material instanceof THREE.MeshPhysicalMaterial) material.clearcoatNormalMap = null;
      // The decimated sneaker has disconnected upper/sole/lace surfaces.
      // Their retained local normals are unsuitable for facing-angle ink;
      // its outer backface shell still provides the readable shoe silhouette.
      applyCartoonMaterial(material, false, object.name !== 'rider-boot');
    }
  });
}

/** Shared world boxes carry local face coordinates for one-pixel ink edges.
 * Other pooled primitives use zero weights and keep their curved silhouette.
 */
export function prepareCartoonGeometry(geometry: THREE.BufferGeometry, box: boolean) {
  const position = geometry.getAttribute('position');
  const attribute = new THREE.BufferAttribute(new Float32Array(position.count * 4), 4);
  if (box) for (let i = 0; i < position.count; i++)
    attribute.setXYZW(i, position.getX(i), position.getY(i), position.getZ(i), 1);
  geometry.setAttribute('cartoonBox', attribute);
}
