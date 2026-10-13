import * as THREE from 'three';

export const WORLD_FOLIAGE_MAX_DRAWS = 2;

/** One exterior draw per crown form, sharing the existing geometry and every
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
      uniform float cartoonWorldFoliageStroke;`)
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
      gl_Position.xy += direction * smoothstep(0.025, 0.12, length(projectedNormal)) * (2.0 * cartoonWorldFoliageStroke / cartoonWorldFoliageViewport) * gl_Position.w;
      gl_Position.z += 0.00001 * gl_Position.w;`);
  };
  material.customProgramCacheKey = () => 'pfusch-world-foliage-outline-v1';
  const shells = sources.map(source => {
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
