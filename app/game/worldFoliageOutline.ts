import * as THREE from 'three';

export const WORLD_FOLIAGE_MAX_DRAWS = 3;

/** One exterior draw per tree form, sharing the existing geometry and every
 * instance transform. Coloured crowns write depth first so overlapping pine
 * tiers do not acquire black seams. Source pools own all borrowed buffers. */
export function makeWorldFoliageOutline(sources: readonly THREE.InstancedMesh[]) {
  if (sources.length > WORLD_FOLIAGE_MAX_DRAWS) throw new RangeError('World foliage contour draw budget exceeded');
  const viewport = new THREE.Vector2(390, 844);
  const material = new THREE.MeshBasicMaterial({ color: '#080a0e', side: THREE.BackSide,
    fog: true, depthTest: true, depthWrite: false, toneMapped: false });
  material.name = 'cartoon-world-foliage-outline';
  material.onBeforeCompile = shader => {
    shader.uniforms.cartoonWorldFoliageViewport = { value: viewport };
    shader.uniforms.cartoonWorldFoliageStroke = { value: 1.05 };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      uniform vec2 cartoonWorldFoliageViewport;
      uniform float cartoonWorldFoliageStroke;
      attribute vec3 cartoonWorldConeProfile;
      float worldFoliageCross(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }
      vec3 worldFoliageProject(vec3 point) {
        vec4 clip = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(point, 1.0);
        return vec3(clip.xy / max(clip.w, 0.1) * cartoonWorldFoliageViewport * 0.5, clip.w);
      }
      bool worldFoliageOutside(vec2 point, vec2 next, vec2 previous, vec2 apex) {
        return worldFoliageCross(next - point, previous - point) * worldFoliageCross(next - point, apex - point) < 0.0;
      }
      vec2 worldFoliageMiter(vec2 point, vec2 previous, vec2 next, vec2 centre) {
        vec2 a = previous - point, b = next - point;
        vec2 n1 = vec2(a.y, -a.x) / max(length(a), 0.00001);
        vec2 n2 = vec2(b.y, -b.x) / max(length(b), 0.00001);
        if (dot(n1, centre - point) > 0.0) n1 = -n1;
        if (dot(n2, centre - point) > 0.0) n2 = -n2;
        vec2 offset = (n1 + n2) * cartoonWorldFoliageStroke / max(0.01, 1.0 + dot(n1, n2));
        return offset * min(1.0, 4.0 * cartoonWorldFoliageStroke / max(length(offset), 0.00001));
      }
      vec2 worldFoliageConeOffset(vec3 point, vec2 fallback) {
        vec3 pixel = worldFoliageProject(point);
        vec3 apex = worldFoliageProject(vec3(0.0, 0.5, 0.0));
        vec3 centre = worldFoliageProject(vec3(0.0));
        if (pixel.z <= 0.1 || apex.z <= 0.1 || centre.z <= 0.1) return fallback;
        float sine = cartoonWorldConeProfile.y, cosine = cartoonWorldConeProfile.z;
        if (point.y > 0.49 && length(point.xz) < 0.001) {
          // The two rim tangencies are the apex's silhouette neighbours. All
          // duplicate tip vertices use the same miter, so facets stay joined.
          vec2 ring = vec2(0.0, 1.0);
          vec3 previous = worldFoliageProject(vec3(-sine, -0.5, cosine));
          vec3 current = worldFoliageProject(vec3(0.0, -0.5, 1.0));
          vec2 first = apex.xy, second = apex.xy;
          float found = 0.0;
          for (int i = 0; i < 10; i++) {
            if (float(i) >= cartoonWorldConeProfile.x) break;
            ring = vec2(ring.x * cosine + ring.y * sine, ring.y * cosine - ring.x * sine);
            vec3 next = worldFoliageProject(vec3(ring.x, -0.5, ring.y));
            if (previous.z <= 0.1 || current.z <= 0.1 || next.z <= 0.1) return fallback;
            bool nextOutside = worldFoliageOutside(current.xy, next.xy, previous.xy, apex.xy);
            bool previousOutside = worldFoliageOutside(current.xy, previous.xy, next.xy, apex.xy);
            if (nextOutside != previousOutside) {
              if (found < 0.5) first = current.xy;
              else second = current.xy;
              found += 1.0;
            }
            previous = current; current = next;
          }
          if (found > 1.5 && found < 2.5) return worldFoliageMiter(pixel.xy, first, second, centre.xy);
        } else if (length(point.xz) > 0.9) {
          vec3 previous = worldFoliageProject(vec3(point.x * cosine - point.z * sine, -0.5, point.z * cosine + point.x * sine));
          vec3 next = worldFoliageProject(vec3(point.x * cosine + point.z * sine, -0.5, point.z * cosine - point.x * sine));
          if (previous.z <= 0.1 || next.z <= 0.1) return fallback;
          bool nextOutside = worldFoliageOutside(pixel.xy, next.xy, previous.xy, apex.xy);
          bool previousOutside = worldFoliageOutside(pixel.xy, previous.xy, next.xy, apex.xy);
          if (!(nextOutside && previousOutside))
            return worldFoliageMiter(pixel.xy, previousOutside ? apex.xy : previous.xy, nextOutside ? apex.xy : next.xy, centre.xy);
        }
        return fallback;
      }`)
      .replace('#include <project_vertex>', `#include <project_vertex>
      // Convex unit crowns use centre-outward normals. This keeps duplicated
      // faceted vertices together instead of opening triangle-sized gaps.
      vec3 foliageNormal = normalize(position);
      mat3 foliageInstance = mat3(instanceMatrix);
      foliageNormal /= vec3(dot(foliageInstance[0], foliageInstance[0]), dot(foliageInstance[1], foliageInstance[1]), dot(foliageInstance[2], foliageInstance[2]));
      foliageNormal = normalize(normalMatrix * foliageInstance * foliageNormal);
      vec2 projectedNormal = (projectionMatrix * vec4(foliageNormal, 0.0)).xy;
      vec2 direction = projectedNormal * cartoonWorldFoliageViewport;
      direction /= max(length(direction), 0.00001);
      vec2 pixelOffset = direction * smoothstep(0.025, 0.12, length(projectedNormal)) * cartoonWorldFoliageStroke;
      // A single radial offset becomes subpixel along steep pine edges. The
      // projected corner intersection preserves the same perpendicular width.
      if (cartoonWorldConeProfile.x > 2.0) pixelOffset = worldFoliageConeOffset(position, pixelOffset);
      gl_Position.xy += pixelOffset * (2.0 / cartoonWorldFoliageViewport) * gl_Position.w;
      gl_Position.z += 0.00001 * gl_Position.w;`);
  };
  material.customProgramCacheKey = () => 'pfusch-world-foliage-outline-v2';
  const shells = sources.map(source => {
    if (!source.geometry.getAttribute('cartoonWorldConeProfile')) {
      const segments = source.geometry instanceof THREE.ConeGeometry ? source.geometry.parameters.radialSegments : 0;
      const profile = new Float32Array(source.geometry.getAttribute('position').count * 3);
      for (let i = 0; i < profile.length; i += 3) {
        profile[i] = segments;
        profile[i + 1] = segments ? Math.sin(2 * Math.PI / segments) : 0;
        profile[i + 2] = segments ? Math.cos(2 * Math.PI / segments) : 0;
      }
      source.geometry.setAttribute('cartoonWorldConeProfile', new THREE.BufferAttribute(profile, 3));
    }
    const shell = new THREE.InstancedMesh(source.geometry, material, source.instanceMatrix.count);
    shell.name = `${source.name}-outline`;
    shell.userData.cartoonWorldFoliageOutline = true;
    shell.instanceMatrix = source.instanceMatrix;
    shell.count = source.count;
    shell.visible = source.visible;
    shell.frustumCulled = false;
    shell.castShadow = false;
    shell.receiveShadow = false;
    shell.layers.mask = source.layers.mask;
    shell.renderOrder = 1;
    shell.raycast = () => {};
    // Instancing affects the source's vertices, not its child matrixWorld.
    // This parent therefore supplies exactly the source pool's world transform.
    source.add(shell);
    return shell;
  });
  let disposed = false;
  return {
    sync() {
      if (disposed) return;
      for (let i = 0; i < shells.length; i++) {
        shells[i].count = sources[i].count;
        shells[i].visible = sources[i].visible;
      }
    },
    resize(width: number, height: number) {
      if (!disposed && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)
        viewport.set(width, height);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const shell of shells) shell.removeFromParent();
      material.dispose();
      // Neither geometry.dispose nor InstancedMesh.dispose: the latter would
      // release the source pool's shared instanceMatrix GPU buffer.
    },
  };
}
