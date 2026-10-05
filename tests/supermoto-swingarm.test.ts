import { describe, expect, it } from 'vitest';
import { Box3, Matrix4, Mesh, MeshStandardMaterial, Raycaster, Vector2, Vector3 } from 'three';
import { activeSuspensionPose } from '../app/game/activeSuspension';
import { SUPERMOTO_CHAIN_DRIVE as CHAIN_DRIVE } from '../app/game/driveGeometry';
import { SUPERMOTO_CHASSIS } from '../app/game/supermotoFit';
import { SUPERMOTO_WHEELS } from '../app/game/supermotoWheelDimensions';
import { SUPERMOTO_SHOCK_LOWER_MOUNT } from '../app/game/supermotoShockMount';
import { SUPERMOTO_SWINGARM, SUPERMOTO_PIVOT_BEARING, supermotoSwingarmGeometry, supermotoSwingarmSection } from '../app/game/supermotoSwingarm';
const dimensions = SUPERMOTO_SWINGARM;
const axleLineY = (z: number) => dimensions.pivotY + (dimensions.axleY - dimensions.pivotY)
    * (z - dimensions.pivotZ) / (dimensions.axleZ - dimensions.pivotZ);
function spar(side: number) {
    const mesh = new Mesh(supermotoSwingarmGeometry(side), new MeshStandardMaterial());
    mesh.updateMatrixWorld(true);
    return mesh;
}
function through(mesh: Mesh, y: number, z: number) {
    return new Raycaster(new Vector3(1, y, z), new Vector3(-1, 0, 0)).intersectObject(mesh, false);
}
/** Rasterize the actual projected triangle union. A convex hull fills the
 * open axle fork and the pivot bore, so it is not the side silhouette. */
function sideSilhouetteArea(points: Vector2[]) {
    const turn = (a: Vector2, b: Vector2, c: Vector2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const min = new Vector2(Infinity, Infinity), max = new Vector2(-Infinity, -Infinity);
    for (const p of points) {
        min.min(p);
        max.max(p);
    }
    const triangles = [];
    for (let i = 0; i < points.length; i += 3) {
        const [a, b, c] = points.slice(i, i + 3);
        if (Math.abs(turn(a, b, c)) > 1e-12)
            triangles.push([a, b, c]);
    }
    const step = max.clone().sub(min).divide(new Vector2(160, 80));
    let cells = 0;
    for (let x = 0; x < 160; x++)
        for (let y = 0; y < 80; y++) {
            const p = new Vector2(min.x + (x + 0.5) * step.x, min.y + (y + 0.5) * step.y);
            if (triangles.some(([a, b, c]) => {
                const t = [turn(a, b, p), turn(b, c, p), turn(c, a, p)];
                return t.every(n => n >= 0) || t.every(n => n <= 0);
            }))
                cells++;
        }
    return cells * step.x * step.y;
}
describe('faceted Supermoto swingarm', () => {
    it('sweeps gradually outwards with no short lateral dogleg while retaining the full-height side profile', () => {
        const start = SUPERMOTO_PIVOT_BEARING.flareStartZ;
        const end = SUPERMOTO_PIVOT_BEARING.flareEndZ;
        const step = 0.01;
        expect(end - start).toBeGreaterThan(0.40);
        let previous = supermotoSwingarmSection(start).centerX, previousSlope = 0;
        for (let z = start + step; z < end + step / 2; z += step) {
            const x = supermotoSwingarmSection(z).centerX;
            const slope = (x - previous) / step;
            expect(x).toBeGreaterThanOrEqual(previous);
            expect(slope).toBeLessThan(0.43);
            expect(Math.abs(slope - previousSlope)).toBeLessThan(0.041);
            previous = x;
            previousSlope = slope;
        }
    });
    it('has deep inner casting pockets with a solid diagonal web and continuous edge rails', () => {
        for (const side of [-1, 1]) {
            const mesh = spar(side);
            const z = 0.46, y = supermotoSwingarmSection(z).centerY + 0.014;
            const insideX = (height: number, longitudinal = z) => new Raycaster(new Vector3(-side, height, longitudinal), new Vector3(side, 0, 0)).intersectObject(mesh, false)[0].point.x * side;
            const centerY = axleLineY(z);
            expect(insideX(centerY) - insideX(centerY + 0.028)).toBeCloseTo(0.010, 6);
            // The solid web separates the two pockets instead of leaving a large open sheet.
            const webZ = 0.542, webY = axleLineY(webZ);
            // Compare recess depth relative to each local beam centre; the long
            // lateral sweep deliberately puts these stations at different X.
            const webFace = insideX(webY, webZ) - supermotoSwingarmSection(webZ).centerX;
            const pocketFace = insideX(y) - supermotoSwingarmSection(z).centerX;
            expect(pocketFace - webFace).toBeGreaterThan(0.008);
            mesh.geometry.dispose();
        }
    });
    it('has broad planar side faces and closed, outward-wound chamfers instead of a rounded loft', () => {
        const geometry = supermotoSwingarmGeometry(1);
        const positions = geometry.getAttribute('position');
        const normals = geometry.getAttribute('normal');
        const indices = geometry.getIndex()!;
        const normal = new Vector3();
        let planarSideProjection = 0, signedVolume = 0;
        const edges = new Map<string, {
            count: number;
            orientation: number;
        }>();
        const silhouette: Vector2[] = [];
        const key = (point: Vector3) => point
            .toArray()
            .map((value) => Math.round(value * 1e6))
            .join(',');
        for (let index = 0; index < indices.count; index += 3) {
            const a = new Vector3().fromBufferAttribute(positions, indices.getX(index));
            const b = new Vector3().fromBufferAttribute(positions, indices.getX(index + 1));
            const c = new Vector3().fromBufferAttribute(positions, indices.getX(index + 2));
            normal.subVectors(b, a).cross(new Vector3().subVectors(c, a));
            const faceArea = normal.length() / 2;
            expect(faceArea).toBeGreaterThan(1e-10);
            normal.normalize();
            // Vertical side plates remain planar even where they turn laterally
            // into the frame. Their normal is horizontal; bevels and edge rails
            // are not plates. Do not assume a nearly longitudinal side face.
            if (Math.abs(normal.y) < 0.0001 && Math.abs(normal.x) > 0.65)
                planarSideProjection += faceArea * Math.abs(normal.x);
            for (const offset of [0, 1, 2]) {
                const vertexNormal = new Vector3().fromBufferAttribute(normals, indices.getX(index + offset));
                expect(vertexNormal.dot(normal)).toBeGreaterThan(0.99999);
            }
            signedVolume += a.dot(new Vector3().crossVectors(b, c)) / 6;
            silhouette.push(new Vector2(a.z, a.y), new Vector2(b.z, b.y), new Vector2(c.z, c.y));
            for (const [p, q] of [
                [a, b],
                [b, c],
                [c, a],
            ]) {
                const pKey = key(p), qKey = key(q);
                const edge = [pKey, qKey].sort().join('|');
                const previous = edges.get(edge) ?? { count: 0, orientation: 0 };
                edges.set(edge, {
                    count: previous.count + 1,
                    orientation: previous.orientation + (pKey < qKey ? 1 : -1),
                });
            }
        }
        // Compare flat plate coverage with its visible SIDE silhouette, not all
        // exterior + internal machined surfaces. Bore walls add real surface area
        // but cannot make an otherwise planar side panel look like a round tube.
        const silhouetteArea = sideSilhouetteArea(silhouette);
        expect(planarSideProjection / (2 * silhouetteArea)).toBeGreaterThan(0.75);
        expect(signedVolume).toBeGreaterThan(0.001);
        expect([...edges].filter(([, edge]) => edge.count !== 2 || edge.orientation !== 0)).toEqual([]);
        geometry.dispose();
    });
    it('keeps the fixed pivot bore and rear axle slot genuinely open with material around both mounts', () => {
        for (const side of [-1, 1]) {
            const mesh = spar(side);
            expect(through(mesh, dimensions.pivotY, dimensions.pivotZ)).toHaveLength(0);
            expect(through(mesh, dimensions.pivotY + 0.022, dimensions.pivotZ).length).toBeGreaterThan(0);
            expect(through(mesh, dimensions.axleY, dimensions.axleZ)).toHaveLength(0);
            expect(through(mesh, dimensions.axleY, dimensions.axleZ + 0.017)).toHaveLength(0);
            expect(through(mesh, dimensions.axleY + 0.02, dimensions.axleZ).length).toBeGreaterThan(0);
            expect(through(mesh, dimensions.axleY, dimensions.axleZ + 0.028)).toHaveLength(0);
            expect(through(mesh, dimensions.axleY + 0.022, dimensions.axleZ + 0.028).length).toBeGreaterThan(0);
            // The crossmember clears the tire and still enters a solid side panel.
            expect(through(mesh, SUPERMOTO_SHOCK_LOWER_MOUNT.bridge[1], SUPERMOTO_SHOCK_LOWER_MOUNT.bridge[2]).length).toBeGreaterThan(0);
            mesh.geometry.dispose();
        }
    });
    it('retains a full-height pivot beam while tucking only its lateral position inside the frame', () => {
        for (const side of [-1, 1]) {
            const mesh = spar(side);
            const depths = [0.23, 0.28, 0.34, 0.40, 0.63].map(z => {
                const centerX = side * supermotoSwingarmSection(z).centerX;
                const top = new Raycaster(new Vector3(centerX, 1, z), new Vector3(0, -1, 0)).intersectObject(mesh, false)[0];
                const bottom = new Raycaster(new Vector3(centerX, 0, z), new Vector3(0, 1, 0)).intersectObject(mesh, false)[0];
                expect(top).toBeDefined();
                expect(bottom).toBeDefined();
                return top.point.y - bottom.point.y;
            });
            // The old 56 mm neck visibly pinched above/below the pivot. Keep the
            // full side-profile load path right through the lateral inset.
            for (const depth of depths.slice(0, 4))
                expect(depth).toBeGreaterThan(0.085);
            expect(depths[0]).toBeGreaterThan(depths[3]);
            expect(depths[4]).toBeLessThan(0.065);
            expect(supermotoSwingarmSection(0.212).centerX).toBeCloseTo(0.047, 8);
            expect(SUPERMOTO_SHOCK_LOWER_MOUNT.bridge[1]).toBeCloseTo(0.42109887432188065, 9);
            const z = 0.45;
            const y = dimensions.pivotY + (dimensions.axleY - dimensions.pivotY)
                * (z - dimensions.pivotZ) / (dimensions.axleZ - dimensions.pivotZ);
            const faceX = (height: number) => new Raycaster(new Vector3(side, height, z), new Vector3(-side, 0, 0)).intersectObject(mesh, false)[0].point.x * side;
            expect(faceX(y + 0.029) - faceX(y)).toBeCloseTo(0.003, 6);
            mesh.geometry.dispose();
        }
    });
    it('leaves the original chain passage and ample tire clearance with symmetric, tapered spars', () => {
        const left = supermotoSwingarmGeometry(-1);
        const right = supermotoSwingarmGeometry(1);
        const leftBounds = left.boundingBox!;
        const rightBounds = right.boundingBox!;
        expect(leftBounds.min.x).toBeCloseTo(-rightBounds.max.x, 7);
        expect(leftBounds.max.x).toBeCloseTo(-rightBounds.min.x, 7);
        // The parallel axle region has a simple lateral corridor. The gradual
        // forward sweep is checked against real tread triangles above.
        const rearBounds = new Box3(), positions = right.getAttribute('position');
        for (let i = 0; i < positions.count; i++)
            if (positions.getZ(i) > SUPERMOTO_PIVOT_BEARING.flareEndZ)
                rearBounds.expandByPoint(new Vector3().fromBufferAttribute(positions, i));
        expect(rearBounds.min.x - SUPERMOTO_WHEELS.rear.tireWidth / 2).toBeGreaterThan(0.05);
        expect(rearBounds.min.x + CHAIN_DRIVE.planeX - CHAIN_DRIVE.chainHalfWidth).toBeGreaterThan(0.006);
        expect(rightBounds.max.x).toBeLessThan(0.191);
        const mesh = new Mesh(right, new MeshStandardMaterial());
        mesh.updateMatrixWorld(true);
        const widths = [0.212, 0.5, 0.66].map((z) => {
            const t = (z - dimensions.pivotZ) / (dimensions.axleZ - dimensions.pivotZ);
            const y = dimensions.pivotY + (dimensions.axleY - dimensions.pivotY) * t - (z < 0.25 ? 0.010 : 0);
            const outer = through(mesh, y, z)[0].point.x;
            const inner = new Raycaster(new Vector3(-1, y, z), new Vector3(1, 0, 0)).intersectObject(mesh, false)[0].point.x;
            return outer - inner;
        });
        expect(widths[0]).toBeLessThan(widths[1]);
        expect(widths[1]).toBeGreaterThan(widths[2]);
        expect(widths[0]).toBeGreaterThan(0.024);
        expect(widths[0]).toBeLessThan(0.029);
        // Deep inner casting pockets retain a substantial load-bearing web.
        expect(widths[2]).toBeGreaterThan(0.025);
        left.dispose();
        right.dispose();
    });
    it('keeps the bore and axle slot coaxial with the fixed pivot and rear wheel throughout suspension travel', () => {
        const mesh = spar(1);
        const pivot = new Vector3(0, dimensions.pivotY, dimensions.pivotZ);
        const axle = new Vector3(0, dimensions.axleY, dimensions.axleZ);
        mesh.matrixAutoUpdate = false;
        for (const travel of [-0.025, 0, 0.06, 0.12]) {
            const pose = activeSuspensionPose('450', 0, travel, SUPERMOTO_CHASSIS.rearAxle, SUPERMOTO_CHASSIS.frontAxle, SUPERMOTO_CHASSIS.rearRadius);
            const motion = new Matrix4()
                .makeRotationX(pose.rearAngle)
                .setPosition(pose.rearPosition);
            expect(pivot.clone().applyMatrix4(motion).distanceTo(pivot)).toBeLessThan(1e-10);
            mesh.matrix.copy(motion);
            mesh.updateMatrixWorld(true);
            const movedAxle = axle.clone().applyMatrix4(motion);
            expect(through(mesh, pivot.y, pivot.z)).toHaveLength(0);
            expect(through(mesh, movedAxle.y, movedAxle.z)).toHaveLength(0);
            expect(movedAxle.distanceTo(pivot)).toBeCloseTo(axle.distanceTo(pivot), 10);
        }
        mesh.geometry.dispose();
    });
});
