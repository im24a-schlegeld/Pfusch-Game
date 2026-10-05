import { describe, expect, it } from 'vitest';
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { SUPERMOTO_LAMP_BULB, SUPERMOTO_LENS_FACE, SUPERMOTO_MASK_STRAP_ANCHORS, supermotoFrontFenderGeometry, supermotoHeadlightMaskGeometry } from '../app/game/supermotoBodywork';
import { supermotoLampGeometry, supermotoProjectorGeometry } from '../app/game/supermotoHeadlight';
describe('moulded Supermoto front fender and raked mask', () => {
    it('opens the reference vent on the viewers right and recesses all five projectors behind glass', () => {
        const finish = new MeshBasicMaterial({ side: DoubleSide });
        const parts = [supermotoHeadlightMaskGeometry(), supermotoLampGeometry('glass'),
            supermotoProjectorGeometry('lens'), supermotoLampGeometry('reflector')]
            .map(geometry => new Mesh(geometry, finish));
        const cast = (x: number, y: number, mesh: Mesh) => new Raycaster(new Vector3(x, y, -1), new Vector3(0, 0, 1)).intersectObject(mesh, false);
        try {
            expect(cast(-0.12, 1.089, parts[0])).toHaveLength(0);
            expect(cast(0.12, 1.089, parts[0]).length).toBeGreaterThan(0);
            for (const [x, y] of [[-0.026, 1.022], [0.026, 1.022], [0, 1.009], [-0.026, 0.994], [0.026, 0.994]]) {
                expect(cast(x, y, parts[0])).toHaveLength(0);
                const [glass, lens, housing] = parts.slice(1).map(part => cast(x, y, part)[0]?.point);
                expect(glass).toBeDefined();
                expect(lens).toBeDefined();
                expect(housing).toBeDefined();
                expect(lens.z - glass.z).toBeGreaterThan(0.002);
                expect(housing.z - lens.z).toBeGreaterThan(0.01);
            }
        }
        finally {
            parts.forEach(part => part.geometry.dispose());
            finish.dispose();
        }
    });
    it('forms the long curved reference blade and deep rear return as one closed thin surface', () => {
        const geometry = supermotoFrontFenderGeometry();
        const finish = new MeshBasicMaterial({ side: DoubleSide });
        const fender = new Mesh(geometry, finish);
        const topAt = (x: number, z: number) => {
            const hits = new Raycaster(new Vector3(x, 1.5, z), new Vector3(0, -1, 0))
                .intersectObject(fender, false);
            expect(hits.length).toBeGreaterThan(1);
            return hits[0].point.y;
        };
        try {
            const noseDrop = topAt(0, -0.800) - topAt(0, -1.090);
            expect(noseDrop).toBeGreaterThan(0.11);
            expect(noseDrop).toBeLessThan(0.14);
            // Both sides of the nose have material: this is a rounded broad blade,
            // not a zero-width spear. The shoulders taper smoothly into the tip.
            expect(topAt(0.015, -1.090)).toBeGreaterThan(0.805);
            expect(topAt(-0.015, -1.090)).toBeCloseTo(topAt(0.015, -1.090), 7);
            const wide = new Raycaster(new Vector3(0.094, 1.5, -0.860), new Vector3(0, -1, 0));
            const inset = new Raycaster(new Vector3(0.035, 1.5, -1.090), new Vector3(0, -1, 0));
            expect(wide.intersectObject(fender).length).toBeGreaterThan(0);
            expect(inset.intersectObject(fender)).toHaveLength(0);
            const ridge = topAt(0, -0.700), channel = topAt(0.047, -0.700);
            expect(ridge - channel).toBeGreaterThan(0.018);
            expect(topAt(0.065, -0.700) - channel).toBeGreaterThan(0.003);
            expect(topAt(0, -0.550)).toBeCloseTo(0.908, 5);
            expect(topAt(0, -0.800)).toBeGreaterThan(0.933);
            expect(topAt(0, -0.424)).toBeLessThan(0.685);
            geometry.computeBoundingBox();
            expect(geometry.boundingBox!.min.z).toBeLessThan(-1.09);
            expect(geometry.boundingBox!.max.x).toBeGreaterThan(0.095);
            const positions = geometry.getAttribute('position'), index = geometry.getIndex()!;
            expect(positions.count).toBeLessThan(2200);
            const uv = geometry.getAttribute('uv');
            const previous = new Map<number, Vector3>();
            for (let i = 0; i < positions.count / 2; i++) {
                const point = new Vector3().fromBufferAttribute(positions, i), column = uv.getX(i);
                const last = previous.get(column);
                if (last) {
                    expect(point.z - last.z, 'nose and side strips must never fold back').toBeGreaterThan(0);
                    if (point.z < -0.840)
                        expect(point.y - last.y, 'nose must descend without a curled lip').toBeGreaterThan(0);
                }
                previous.set(column, point);
            }
            const edges = new Map<string, number>();
            for (let i = 0; i < index.count; i += 3)
                for (let k = 0; k < 3; k++) {
                    const a = index.getX(i + k), b = index.getX(i + (k + 1) % 3);
                    const key = a < b ? `${a}/${b}` : `${b}/${a}`;
                    edges.set(key, (edges.get(key) ?? 0) + 1);
                }
            expect([...edges.values()].every(count => count === 2)).toBe(true);
        }
        finally {
            geometry.dispose();
            finish.dispose();
        }
    });
    it('keeps the raked mask straps on its actual back face and the bulb behind the lens', () => {
        const geometry = supermotoHeadlightMaskGeometry();
        const finish = new MeshBasicMaterial({ side: DoubleSide });
        const mask = new Mesh(geometry, finish);
        try {
            for (const [x, y, z] of SUPERMOTO_MASK_STRAP_ANCHORS)
                for (const side of [-1, 1]) {
                    const hits = new Raycaster(new Vector3(side * x, y, 0), new Vector3(0, 0, -1))
                        .intersectObject(mask, false);
                    expect(hits.length).toBeGreaterThan(0);
                    expect(hits[0].point.distanceTo(new Vector3(side * x, y, z))).toBeLessThan(0.002);
                }
            const [lower, upper] = [0.944, 1.145].map(y => new Raycaster(new Vector3(0.068, y, 0), new Vector3(0, 0, -1)).intersectObject(mask, false)[0]?.point);
            expect(lower).toBeDefined();
            expect(upper).toBeDefined();
            const rake = Math.atan((upper.z - lower.z) / (upper.y - lower.y)) * 180 / Math.PI;
            expect(rake).toBeGreaterThan(24);
            expect(rake).toBeLessThan(30);
            expect(SUPERMOTO_LAMP_BULB[2] - SUPERMOTO_LENS_FACE[2]).toBeCloseTo(0.045, 6);
        }
        finally {
            geometry.dispose();
            finish.dispose();
        }
    });
});
