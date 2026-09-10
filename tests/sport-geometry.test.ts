import { describe, expect, it } from 'vitest';
import { SPORT_GEOMETRY as bike, sportTireGeometry } from '../app/game/sportGeometry';

describe('Sport road wheel proportions', () => {
  it('uses a 1441 mm wheelbase and 17 inch rims with different front/rear tire sections', () => {
    expect(bike.rearAxle - bike.frontAxle).toBeCloseTo(1.441, 8);
    expect(bike.rimRadius * 2 / 0.0254).toBeCloseTo(17, 8);
    expect(bike.frontRadius).toBeCloseTo(0.2999, 8);
    expect(bike.rearRadius).toBeCloseTo(0.3204, 8);
  });
  it('mounts the generated tires at ground level and keeps the wide rear crown outside its rim', () => {
    for (const rear of [false, true]) {
      const geometry = sportTireGeometry(rear);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      const radius = rear ? bike.rearRadius : bike.frontRadius;
      const width = rear ? bike.rearWidth : bike.frontWidth;
      expect(box.min.y + radius).toBeCloseTo(0, 3);
      expect(box.max.y).toBeCloseTo(radius, 3);
      expect(box.max.x - box.min.x).toBeCloseTo(width, 2);
      // There must be an open hub/rim region, never the old undersized torus hole.
      const points = geometry.getAttribute('position');
      for (let i = 0; i < points.count; i++) {
        expect(Math.hypot(points.getY(i), points.getZ(i))).toBeGreaterThan(0.211);
      }
      geometry.dispose();
    }
  });
});
