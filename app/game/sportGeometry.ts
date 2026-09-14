import * as THREE from 'three';

// Yamaha R1 2024 factory wheelbase/tire sizes; metres before display scale.
export const SPORT_GEOMETRY = Object.freeze({
  frontAxle: -0.72,
  rearAxle: 0.685,
  rimRadius: (17 * 0.0254) / 2,
  frontRadius: (17 * 0.0254) / 2 + 0.12 * 0.7,
  rearRadius: (17 * 0.0254) / 2 + 0.19 * 0.55,
  frontWidth: 0.12,
  rearWidth: 0.19,
  forkTopY: 1.02,
  forkTopZ: -0.413,
});

/** A road tire has a broad crown and thin sidewalls around a full-size rim.
 * A circular torus incorrectly makes wider rear tires radially thicker too. */
export function sportTireGeometry(rear: boolean) {
  const radius = rear ? SPORT_GEOMETRY.rearRadius : SPORT_GEOMETRY.frontRadius;
  return roadTireGeometry(
    radius,
    rear ? SPORT_GEOMETRY.rearWidth : SPORT_GEOMETRY.frontWidth,
  );
}

export function roadTireGeometry(
  radius: number,
  width: number,
  beadRadius = SPORT_GEOMETRY.rimRadius,
) {
  const half = width / 2;
  const bead = beadRadius;
  const profile = new THREE.SplineCurve([
    new THREE.Vector2(bead - 0.003, -half * 0.68),
    new THREE.Vector2(bead + 0.012, -half * 0.93),
    new THREE.Vector2(radius - 0.045, -half),
    new THREE.Vector2(radius - 0.017, -half * 0.82),
    new THREE.Vector2(radius - 0.004, -half * 0.43),
    new THREE.Vector2(radius, 0),
    new THREE.Vector2(radius - 0.004, half * 0.43),
    new THREE.Vector2(radius - 0.017, half * 0.82),
    new THREE.Vector2(radius - 0.045, half),
    new THREE.Vector2(bead + 0.012, half * 0.93),
    new THREE.Vector2(bead - 0.003, half * 0.68),
  ]);
  const points = profile.getPoints(40);
  points.push(points[0].clone());
  const geometry = new THREE.LatheGeometry(points, 80);
  geometry.rotateZ(Math.PI / 2);
  return geometry;
}
