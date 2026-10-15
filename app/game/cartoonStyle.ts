import * as THREE from 'three';

const applied = new WeakMap<THREE.Material, THREE.Material['onBeforeCompile']>();
const rimTireColor = new THREE.Color('#16181a');
const tireMaterialName = /(?:^|[_-])(?:tire|tyre)(?=$|[_:-])/i;

export function isRubberTirePart(mesh: THREE.Mesh) {
  return mesh.name === 'tire' || /(?:^|[_-])(?:tire|tyre)(?=$|[_:-])/i.test(mesh.userData.importedPart ?? '');
}

/** Imported wheels revolve around local X. Only the inward radial wall gets
 * the recess shade; axial cast faces and the outward rim lip stay untouched.
 * Use the supplied smooth normals, without changing them or the wheel mesh. */
function prepareRimShading(geometry: THREE.BufferGeometry) {
  if (geometry.getAttribute('cartoonRimRecess')) return;
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  const recess = new THREE.BufferAttribute(new Float32Array(position.count), 1);
  if (normal) for (let i = 0; i < position.count; i++) {
    const y = position.getY(i), z = position.getZ(i);
    const nx = normal.getX(i), ny = normal.getY(i), nz = normal.getZ(i);
    const length = Math.hypot(y, z) * Math.hypot(nx, ny, nz);
    const inward = length > 0.00001 ? -(ny * y + nz * z) / length : 0;
    recess.setX(i, THREE.MathUtils.smoothstep(inward, 0.2, 0.65));
  }
  geometry.setAttribute('cartoonRimRecess', recess);
}

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
  const smoothRoad = material.userData.pfuschSmoothRoadLighting === true;
  const hero = material.userData.pfuschCartoonHero === true;
  const rim = hero && material.userData.rimPalette === true;
  const rimTireBand = rim && material.userData.rimTireBand === true;
  const wheelHardware = hero && material.userData.importedWheelHardware === true;
  const rubberTire = hero && (material.userData.rubberTire === true || tireMaterialName.test(material.name));
  // The rim's shape is shaded below; grazing-angle ink on its narrow bevels
  // produced irregular black patches. The existing geometry outline remains.
  const ink = material.transparent || !contour || rim || wheelHardware || rubberTire ? '0.0' : '0.92';
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    // Carbon/colour changes can wrap a previously styled shader. Never apply
    // cel shading twice, and never replace that artwork's existing hook.
    if (shader.fragmentShader.includes('// PFUSCH_CARTOON')) return;
    shader.uniforms.cartoonFacingInkStrength = { value: Number(ink) };
    shader.uniforms.cartoonGarmentInkStrength = { value: hero && !material.transparent ? 0.92 : 0 };
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
      '#include <common>\nuniform float cartoonFacingInkStrength;\nuniform float cartoonGarmentInkStrength;');
    if (hero) {
      shader.vertexShader = shader.vertexShader.replace('#include <common>',
        '#include <common>\nattribute float cartoonGarmentEdge;\nvarying float vCartoonGarmentEdge;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCartoonGarmentEdge = cartoonGarmentEdge;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
        '#include <common>\nvarying float vCartoonGarmentEdge;');
    }
    if (rim) {
      shader.vertexShader = shader.vertexShader.replace('#include <common>',
        '#include <common>\nattribute float cartoonRimRecess;\nvarying float vCartoonRimRecess;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCartoonRimRecess = cartoonRimRecess;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
        '#include <common>\nvarying float vCartoonRimRecess;');
    }
    if (rimTireBand) {
      shader.uniforms.cartoonRimTireColor = { value: rimTireColor };
      shader.vertexShader = shader.vertexShader.replace('#include <common>',
        '#include <common>\nattribute vec2 cartoonRimTirePosition;\nvarying vec2 vCartoonRimTirePosition;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCartoonRimTirePosition = cartoonRimTirePosition;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
        '#include <common>\nvarying vec2 vCartoonRimTirePosition;\nuniform vec3 cartoonRimTireColor;');
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
      ${rimTireBand ? `// Source outer lip is tire finish even during color/carbon previews.
      float vCartoonRimTireBand = smoothstep(0.166, 0.178, length(vCartoonRimTirePosition));
      diffuseColor.rgb = mix(diffuseColor.rgb, cartoonRimTireColor, vCartoonRimTireBand);` : ''}
      vec3 cartoonDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
      float cartoonBase = max(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.025);
      float cartoonLight = dot(cartoonDiffuse, vec3(0.2126, 0.7152, 0.0722)) / cartoonBase;
      float cartoonBand = mix(0.24, 0.52, smoothstep(0.16, 0.21, cartoonLight));
      cartoonBand = mix(cartoonBand, 0.80, smoothstep(0.48, 0.54, cartoonLight));
      cartoonBand = mix(cartoonBand, 1.08, smoothstep(0.94, 1.02, cartoonLight));
      ${hero ? `cartoonBand = mix(0.36, 0.72, smoothstep(0.27, 0.32, cartoonLight));
      cartoonBand = mix(cartoonBand, 1.10, smoothstep(0.83, 0.90, cartoonLight));` : ''}
      ${rim ? `
      // Ambient light can saturate every normal into the brightest hero band.
      // Keep rim form readable using the existing key light's direction, then
      // darken only its inward barrel. Broad transitions avoid triangle noise.
      vec3 cartoonRimDirection = normalize((viewMatrix * vec4(-0.35, 0.88, 0.32, 0.0)).xyz);
      #if NUM_DIR_LIGHTS > 0
        cartoonRimDirection = normalize(directionalLights[ 0 ].direction);
      #endif
      float cartoonRimDirectional = dot(normal, cartoonRimDirection);
      float cartoonRimBand = mix(0.48, 0.76, smoothstep(-0.10, 0.18, cartoonRimDirectional));
      cartoonRimBand = mix(cartoonRimBand, 1.04, smoothstep(0.45, 0.70, cartoonRimDirectional));
      cartoonBand = min(cartoonBand, 1.0) * cartoonRimBand * mix(1.0, 0.70, vCartoonRimRecess);
      ` : ''}
      vec3 cartoonTint = mix(vec3(1.0), cartoonDiffuse / max(max(cartoonDiffuse.r, cartoonDiffuse.g), max(cartoonDiffuse.b, 0.001)), 0.12);
      outgoingLight = diffuseColor.rgb * cartoonTint * cartoonBand + totalEmissiveRadiance;
      ${!hero ? `// Continuous real spotlight irradiance on roadway and tunnel walls.
      // Preserve painted surfaces and their independent outlines; hero stays cel-shaded.
      outgoingLight = cartoonDiffuse + totalEmissiveRadiance;` : ''}
      ${smoothRoad ? `// PFUSCH_ROAD_FORWARD_BEAM: asphalt only; spot lights alone control this pool.
      // The actual headlight position, cone and strength come from Three's
      // existing lighting uniforms, so daylight (intensity 0) stays unchanged.
      // Avoid a second bright disk by fading up beyond the first few metres.
      vec3 pfuschRoadForwardFill = vec3(0.0);
      #if NUM_SPOT_LIGHTS > 0
        for (int pfuschLampIndex = 0; pfuschLampIndex < NUM_SPOT_LIGHTS; pfuschLampIndex++) {
          vec3 pfuschToLamp = spotLights[pfuschLampIndex].position + vViewPosition;
          float pfuschLightRange = length(pfuschToLamp);
          float pfuschSpotCos = dot(pfuschToLamp / max(pfuschLightRange, 0.001),
                                   spotLights[pfuschLampIndex].direction);
          float pfuschBeamEdge = smoothstep(spotLights[pfuschLampIndex].coneCos,
                                           spotLights[pfuschLampIndex].penumbraCos,
                                           pfuschSpotCos);
          float pfuschFarRoad = smoothstep(4.0, 10.0, pfuschLightRange) *
                                (1.0 - smoothstep(40.0, 72.0, pfuschLightRange));
          pfuschRoadForwardFill += spotLights[pfuschLampIndex].color *
                                   (0.034 * pfuschBeamEdge * pfuschFarRoad);
        }
      #endif
      // Calibrated, bounded diffuse fill; no emissive override of the road paint.
      outgoingLight += diffuseColor.rgb * min(pfuschRoadForwardFill, vec3(1.45));` : ''}
      float cartoonFacing = abs(dot(normal, normalize(vViewPosition)));
      float cartoonWidth = min(0.12, max(0.025, fwidth(cartoonFacing) * 1.15));
      float cartoonInk = (1.0 - smoothstep(0.045, 0.045 + cartoonWidth, cartoonFacing)) * cartoonFacingInkStrength;
      ${hero ? `
      // The cuff is a real fabric/skin boundary even when it faces the camera.
      // Screen derivatives keep this surface stroke narrow on every bike pose.
      float garmentEdgeWidth = max(fwidth(vCartoonGarmentEdge), 0.00001);
      cartoonInk = max(cartoonInk, (1.0 - smoothstep(garmentEdgeWidth * 0.35, garmentEdgeWidth * 1.35, vCartoonGarmentEdge)) * cartoonGarmentInkStrength);
      ` : ''}
      ${boxInk ? `
      vec3 cartoonFace = max(vec3(0.5) - abs(vCartoonBox.xyz), vec3(0.0));
      float cartoonEdge = min(max(cartoonFace.x, cartoonFace.y), min(max(cartoonFace.y, cartoonFace.z), max(cartoonFace.z, cartoonFace.x)));
      float cartoonEdgeWidth = max(fwidth(cartoonEdge) * 0.85, 0.00001);
      cartoonInk = max(cartoonInk, (1.0 - smoothstep(cartoonEdgeWidth * 0.35, cartoonEdgeWidth * 1.35, cartoonEdge)) * vCartoonBox.w * cartoonFacingInkStrength);
      ` : ''}
      // Emissive lamps retain their signal colours; ink never masks a light.
      float cartoonEmission = clamp(max(totalEmissiveRadiance.r, max(totalEmissiveRadiance.g, totalEmissiveRadiance.b)), 0.0, 1.0);
      outgoingLight = mix(outgoingLight, vec3(0.004, 0.006, 0.009), cartoonInk * (1.0 - cartoonEmission));
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey = () => `${previousKey}:pfusch-cartoon-v1:${boxInk ? 'box' : 'round'}:${ink}:${hero ? 'hero' : 'world'}${rim ? ':rim-v1' : ''}${rimTireBand ? ':tire-band-v2' : ''}${smoothRoad ? ':smooth-road-v1' : ''}`;
  material.userData.pfuschCartoon = true;
  material.userData.pfuschCartoonRimShading = rim;
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
    if (isRubberTirePart(object)) {
      // Imported rubber already has a dedicated named material. Legacy wheels
      // may share plain rubber with hoses/belts; isolate only that tire finish.
      const mark = (material: THREE.Material) => {
        if (!(material instanceof THREE.MeshStandardMaterial) || tireMaterialName.test(material.name) || material.userData.rubberTire) return material;
        const own = material.clone(); own.userData.rubberTire = true; return own;
      };
      object.material = Array.isArray(object.material) ? object.material.map(mark) : mark(object.material);
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.some(material => material.userData.rimPalette === true)) prepareRimShading(object.geometry);
    if (!object.geometry.getAttribute('cartoonGarmentEdge')) {
      const positions = object.geometry.getAttribute('position');
      const edge = new THREE.BufferAttribute(new Float32Array(positions.count).fill(1), 1);
      const uv = object.geometry.getAttribute('uv');
      // These authored UVs reach zero only at the exposed cuff/hem. The
      // open trouser cuff needs the same surface ink across the ankle skin;
      // its backface shell covers only the leg's outer silhouette.
      if (uv && /^(garment-sleeve|tailored-garment|continuous-trouser-leg)$/.test(object.name))
        for (let i = 0; i < edge.count; i++) edge.setX(i, Math.max(0, uv.getY(i)));
      object.geometry.setAttribute('cartoonGarmentEdge', edge);
    }
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      material.userData.pfuschCartoonHero = true;
      material.normalMap = null;
      material.bumpMap = null;
      if (material instanceof THREE.MeshPhysicalMaterial) material.clearcoatNormalMap = null;
      // A bent sleeve, trouser fold or overlapping shoulder can face away from
      // the camera while still lying inside the visible garment. Facing-angle
      // ink mislabelled these smooth interiors as black seams, especially on
      // the Sport's leaning rear pose. Keep the actual outer shells and authored
      // cuff/hem ink; the original printed texture is unaffected.
      const smoothRiderSurface = object instanceof THREE.SkinnedMesh ||
        /garment|hood|trouser|stand-collar|rider-(boot|glove)|imported-cap-shell|carried-crossbody-bag/.test(object.name);
      applyCartoonMaterial(material, false, !smoothRiderSurface);
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
