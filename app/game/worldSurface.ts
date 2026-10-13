import type { MeshStandardMaterial } from 'three';

/** Broad painted patches follow route metres as cells recycle. No grain or
 * high-frequency noise: both quality levels use the same clean colour fields.
 */
export function addWorldSurfaceDetail(
  material: MeshStandardMaterial,
  origin: { value: number },
  kind: 'asphalt' | 'rock' | 'ground',
  _low: boolean,
) {
  material.customProgramCacheKey = () =>
    `pfusch-painted-surface-${kind}-3`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.pfuschSurfaceOrigin = origin;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float pfuschSurfaceOrigin;\nvarying vec3 vPfuschSurface;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
      vec3 pfuschSurfacePoint = transformed;
      #ifdef USE_INSTANCING
        pfuschSurfacePoint = (instanceMatrix * vec4(pfuschSurfacePoint, 1.0)).xyz;
      #endif
      vPfuschSurface = vec3(pfuschSurfacePoint.xy, pfuschSurfaceOrigin - pfuschSurfacePoint.z);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
      varying vec3 vPfuschSurface;
      `,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
      vec2 pfuschSurfaceUV = ${kind === 'rock' ? 'vec2(vPfuschSurface.x + vPfuschSurface.z * 0.63, vPfuschSurface.y * 0.83 + vPfuschSurface.z * 0.19)' : 'vPfuschSurface.xz'};
      float pfuschMacro = sin(pfuschSurfaceUV.x * ${kind === 'asphalt' ? '2.2' : '0.18'} + sin(pfuschSurfaceUV.y * 0.035));
      float pfuschSurfaceShade = mix(${kind === 'asphalt' ? '0.95, 1.02' : '0.94, 1.04'}, smoothstep(0.20, 0.24, pfuschMacro));
      diffuseColor.rgb *= pfuschSurfaceShade;`,
      );
  };
}
