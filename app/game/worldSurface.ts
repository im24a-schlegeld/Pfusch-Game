import type { MeshStandardMaterial } from 'three';

/** Material-only detail, anchored to route metres as cells are recycled.
 * Asphalt uses the existing three-sine pattern for longer worn wheel tracks;
 * low quality retains the same shader work and skips grain as before.
 */
export function addWorldSurfaceDetail(
  material: MeshStandardMaterial,
  origin: { value: number },
  kind: 'asphalt' | 'rock' | 'ground',
  low: boolean,
) {
  material.customProgramCacheKey = () =>
    `pfusch-surface-${kind}-${low ? 'low' : 'normal'}-2`;
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
      float pfuschGrain(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
      vec2 pfuschSurfaceUV = ${kind === 'rock' ? 'vec2(vPfuschSurface.x + vPfuschSurface.z * 0.63, vPfuschSurface.y * 0.83 + vPfuschSurface.z * 0.19)' : 'vPfuschSurface.xz'};
      float pfuschMacro = sin(pfuschSurfaceUV.x * ${kind === 'asphalt' ? '3.25' : '1.73'} + sin(pfuschSurfaceUV.y * ${kind === 'asphalt' ? '0.035' : '0.61'})) * sin(pfuschSurfaceUV.y * ${kind === 'asphalt' ? '0.18' : '1.17'});
      float pfuschSurfaceShade = 1.0 + pfuschMacro * ${kind === 'asphalt' ? '0.10' : '0.045'};
      ${
        low
          ? ''
          : `
      vec2 pfuschFineUV = pfuschSurfaceUV * ${kind === 'asphalt' ? '42.0' : '16.0'};
      vec2 pfuschFootprint = fwidth(pfuschFineUV);
      float pfuschFineWeight = 1.0 - smoothstep(0.3, 1.4, max(pfuschFootprint.x, pfuschFootprint.y));
      pfuschSurfaceShade += (pfuschGrain(floor(pfuschFineUV)) - 0.5) * pfuschFineWeight * ${kind === 'asphalt' ? '0.07' : '0.10'};
      `
      }
      diffuseColor.rgb *= pfuschSurfaceShade;`,
      );
  };
}
