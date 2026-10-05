import { describe, expect, it } from 'vitest';
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { supermotoSeatGeometry } from '../app/game/supermotoSeat';
import { supermotoSideCoverGeometry } from '../app/game/supermotoBodywork';
describe('reference seat wedge and rounded rear shoulder', () => {
    it('retains the central riding surface with a pronounced triangular lower skirt and flatter rear seat', () => {
        const geometry = supermotoSeatGeometry(), material = new MeshBasicMaterial({ side: DoubleSide });
        const seat = new Mesh(geometry, material);
        seat.updateMatrixWorld(true);
        try {
            for (const [z, top] of [[-0.145, 1.010], [0.040, 0.997], [0.380, 0.993], [0.625, 1.010]]) {
                const hits = new Raycaster(new Vector3(0, 2, z), new Vector3(0, -1, 0)).intersectObject(seat, false);
                expect(hits.length).toBeGreaterThan(1);
                expect(hits[0].point.y, `reference seat upper surface at z=${z}`).toBeCloseTo(top, 6);
            }
            const bottom = (z: number) => new Raycaster(new Vector3(0, 0, z), new Vector3(0, 1, 0))
                .intersectObject(seat, false)[0].point.y;
            expect(bottom(0.380)).toBeCloseTo(0.903, 6);
            expect(bottom(0.220)).toBeLessThan(0.890);
            expect(bottom(-0.145)).toBeGreaterThan(0.963);
            expect(bottom(0.625)).toBeGreaterThan(0.976);
            expect(bottom(0.625) - bottom(0.220), 'rearward side of the V-shaped upholstery').toBeGreaterThan(0.085);
            expect(geometry.boundingBox!.max.x).toBeLessThan(0.102);
            expect(geometry.getAttribute('uv').count).toBe(geometry.getAttribute('position').count);
        }
        finally {
            material.dispose();
            geometry.dispose();
        }
    });
    it('turns each actual panel shoulder gradually from the saddle lip down into the broad side face', () => {
        for (const side of [-1, 1]) {
            const geometry = supermotoSideCoverGeometry(side), p = geometry.getAttribute('position');
            const row: Vector3[] = [];
            for (let i = 0; i < p.count / 2; i++)
                if (Math.abs(p.getZ(i) - 0.345) < 1e-6)
                    row.push(new Vector3(Math.abs(p.getX(i)), p.getY(i), p.getZ(i)));
            row.sort((a, b) => b.y - a.y);
            expect(row).toHaveLength(25);
            const angle = (i: number) => Math.atan2(row[i].y - row[i + 1].y, row[i + 1].x - row[i].x);
            expect(angle(0)).toBeLessThan(Math.PI / 4);
            expect(angle(7)).toBeGreaterThan(Math.PI / 3);
            expect(row[0].x).toBeLessThan(0.100);
            expect(row[0].y).toBeGreaterThan(0.912);
            expect(row[0].y).toBeLessThan(0.925);
            // The fuller lower bolster surrounds the unchanged rail; the remaining
            // exposed plastic still has a broad, visibly rounded shoulder.
            expect(row[8].x - row[0].x).toBeGreaterThan(0.038);
            geometry.dispose();
        }
    });
});
