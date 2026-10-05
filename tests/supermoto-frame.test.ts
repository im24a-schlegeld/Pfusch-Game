import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { supermotoLowerFrameGeometry, supermotoLowerFramePath, SUPERMOTO_PIVOT_FRAME_JOINT } from '../app/game/supermotoFrame';
describe('compact Supermoto engine cradle', () => {
    it('keeps both frame joints fixed and bends without sagging below the sump', () => {
        for (const side of [-1, 1]) {
            const path = supermotoLowerFramePath(side);
            expect(path
                .getPoint(0)
                .distanceTo(new Vector3(side * SUPERMOTO_PIVOT_FRAME_JOINT[0], SUPERMOTO_PIVOT_FRAME_JOINT[1], SUPERMOTO_PIVOT_FRAME_JOINT[2]))).toBeLessThan(1e-8);
            expect(path.getPoint(1).distanceTo(new Vector3(0, 0.65, -0.29))).toBeLessThan(1e-8);
            const geometry = supermotoLowerFrameGeometry(side);
            expect(geometry.boundingBox!.min.y).toBeGreaterThan(0.371);
            // The previous free spline dipped well below its own control points.
            for (let step = 0; step <= 200; step++) {
                const point = path.getPointAt(step / 200);
                expect(point.y).toBeGreaterThanOrEqual(0.39 - 1e-8);
                expect(point.z).toBeGreaterThanOrEqual(-0.35 - 1e-8);
                expect(point.z).toBeLessThanOrEqual(0.18 + 1e-8);
            }
            geometry.dispose();
        }
    });
    it('sweeps smoothly from the broad sump floor up around the front of the engine', () => {
        for (const side of [-1, 1]) {
            const samples = supermotoLowerFramePath(side).getSpacedPoints(512);
            const forwardFloor = samples.filter((point) => point.z < 0.05 && point.z > -0.06);
            expect(forwardFloor.length).toBeGreaterThan(20);
            for (const point of forwardFloor) {
                expect(point.y).toBeCloseTo(0.39, 5);
                expect(side * point.x).toBeGreaterThan(0.13);
            }
            // A gradual outward sweep replaces the square corner. It must never
            // double back toward the engine or dip below the sump floor.
            const frontLeg = samples.filter((point) => point.z < -0.07);
            expect(frontLeg.length).toBeGreaterThan(50);
            for (let i = 1; i < frontLeg.length; i++) {
                expect(frontLeg[i].y).toBeGreaterThan(frontLeg[i - 1].y);
                expect(frontLeg[i].z).toBeLessThan(frontLeg[i - 1].z);
                if (i > 1) {
                    const before = frontLeg[i - 1].clone().sub(frontLeg[i - 2]);
                    const after = frontLeg[i].clone().sub(frontLeg[i - 1]);
                    expect(before.angleTo(after)).toBeLessThan(0.04);
                }
            }
            // The paired rails retain a broad cradle without crossing each other.
            expect(samples.every((point) => side * point.x >= -1e-8)).toBe(true);
        }
    });
});
