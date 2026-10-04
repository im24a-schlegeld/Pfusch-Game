import { describe, expect, it, vi } from 'vitest';
import {
  Box3,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import { activeSuspensionPose } from '../app/game/activeSuspension';
import { CHAIN_DRIVE } from '../app/game/driveGeometry';
import { SUPERMOTO_CHASSIS } from '../app/game/supermotoFit';
import { SUPERMOTO_WHEELS } from '../app/game/supermotoWheelDimensions';
import { SUPERMOTO_SHOCK_LOWER_MOUNT } from '../app/game/supermotoShockMount';
import { makeBike } from '../app/game/vehicle';
import { newPlayer } from '../app/domain/progression';
import { envelope, faces, gap, triangleGap } from './helpers/solidClearance';
import {
  SUPERMOTO_SWINGARM,
  SUPERMOTO_PIVOT_BEARING,
  supermotoSwingarmGeometry,
  supermotoSwingarmSection,
  supermotoSwingarmBridgeGeometry,
} from '../app/game/supermotoSwingarm';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(), fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(), accessoryMaterial: () => new MeshStandardMaterial(),
}));

const dimensions = SUPERMOTO_SWINGARM;
const axleLineY = (z: number) => dimensions.pivotY + (dimensions.axleY - dimensions.pivotY)
  * (z - dimensions.pivotZ) / (dimensions.axleZ - dimensions.pivotZ);
function spar(side: number) {
  const mesh = new Mesh(
    supermotoSwingarmGeometry(side),
    new MeshStandardMaterial(),
  );
  mesh.updateMatrixWorld(true);
  return mesh;
}
function through(mesh: Mesh, y: number, z: number) {
  return new Raycaster(
    new Vector3(1, y, z),
    new Vector3(-1, 0, 0),
  ).intersectObject(mesh, false);
}

function surfaceGap(a: Mesh, b: Mesh, inverse: Matrix4, threshold: number) {
  const boundsGap = gap(envelope(a, inverse), envelope(b, inverse));
  if (boundsGap > threshold) return boundsGap;
  let minimum = Infinity;
  const target = faces(b, inverse);
  for (const source of faces(a, inverse)) for (const other of target) {
    if (gap(source.bounds, other.bounds) > Math.min(minimum, threshold)) continue;
    minimum = Math.min(minimum, triangleGap(source.triangle, other.triangle));
  }
  return minimum;
}

/** Rasterize the actual projected triangle union. A convex hull fills the
 * open axle fork and the pivot bore, so it is not the side silhouette. */
function sideSilhouetteArea(points: Vector2[]) {
  const turn = (a: Vector2, b: Vector2, c: Vector2) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const min = new Vector2(Infinity, Infinity), max = new Vector2(-Infinity, -Infinity);
  for (const p of points) { min.min(p); max.max(p); }
  const triangles = [];
  for (let i = 0; i < points.length; i += 3) {
    const [a, b, c] = points.slice(i, i + 3);
    if (Math.abs(turn(a, b, c)) > 1e-12) triangles.push([a, b, c]);
  }
  const step = max.clone().sub(min).divide(new Vector2(160, 80));
  let cells = 0;
  for (let x = 0; x < 160; x++) for (let y = 0; y < 80; y++) {
    const p = new Vector2(min.x + (x + 0.5) * step.x, min.y + (y + 0.5) * step.y);
    if (triangles.some(([a, b, c]) => {
      const t = [turn(a, b, p), turn(b, c, p), turn(c, a, p)];
      return t.every(n => n >= 0) || t.every(n => n <= 0);
    })) cells++;
  }
  return cells * step.x * step.y;
}

describe('faceted Supermoto swingarm', () => {
  it('forms a broad U bridge joined to both arms, with a scalloped wheel opening and clearance throughout travel', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    const arms = bike.body.getObjectsByProperty('name', 'box-section-swingarm') as Mesh[];
    const bridge = new Mesh(supermotoSwingarmBridgeGeometry(), new MeshStandardMaterial());
    const tire = bike.wheels[1].getObjectByName('tire') as Mesh;
    const cases: Mesh[] = [];
    bike.body.traverse(part => { if (part instanceof Mesh && part.name.startsWith('engine-')) cases.push(part); });
    const geometryBounds = bridge.geometry.boundingBox!;
    expect(geometryBounds.max.x - geometryBounds.min.x).toBeGreaterThan(0.22);
    expect(geometryBounds.max.z - geometryBounds.min.z).toBeGreaterThan(0.06);
    bridge.updateMatrixWorld(true);
    const fromAbove = (x: number, z: number) => new Raycaster(new Vector3(x, 1, z), new Vector3(0, -1, 0)).intersectObject(bridge, false);
    expect(fromAbove(0, 0.25).length).toBeGreaterThan(0);
    expect(fromAbove(0, 0.285)).toHaveLength(0);
    expect(fromAbove(0.10, 0.285).length).toBeGreaterThan(0);
    for (const pitch of [0, 0.85]) for (const travel of [-0.20, 0, 0.20]) {
      bike.animateSuspension(pitch, travel, pitch > 0 ? 1 : 0);
      bike.root.updateMatrixWorld(true);
      bridge.matrixWorld.copy(arms[0].matrixWorld);
      const inverse = bike.body.matrixWorld.clone().invert();
      for (const arm of arms)
        expect(surfaceGap(bridge, arm, inverse, 0.001), 'bridge enters the arm castings').toBeLessThan(0.001);
      expect(surfaceGap(bridge, tire, inverse, 0.05), 'arch clears enlarged rear tyre').toBeGreaterThan(0.05);
      for (const part of cases)
        expect(surfaceGap(bridge, part, inverse, 0.003), `bridge/${part.name}`).toBeGreaterThan(0.003);
      for (const name of ['supermoto-shock-lower-pin', 'shock-lower-link'])
        for (const part of bike.body.getObjectsByProperty('name', name) as Mesh[])
          expect(surfaceGap(bridge, part, inverse, 0.003), name).toBeGreaterThan(0.003);
    }
    bridge.geometry.dispose();
  });

  it('has deep inner casting pockets with a solid diagonal web and continuous edge rails', () => {
    for (const side of [-1, 1]) {
      const mesh = spar(side);
      const z = 0.46, y = supermotoSwingarmSection(z).centerY + 0.014;
      const insideX = (height: number, longitudinal = z) => new Raycaster(
        new Vector3(-side, height, longitudinal), new Vector3(side, 0, 0),
      ).intersectObject(mesh, false)[0].point.x * side;
      const centerY = axleLineY(z);
      expect(insideX(centerY) - insideX(centerY + 0.028)).toBeCloseTo(0.010, 6);
      // The solid web separates the two pockets instead of leaving a large open sheet.
      const webZ = 0.542, webY = axleLineY(webZ);
      expect(insideX(webY, webZ)).toBeLessThan(insideX(y));
      mesh.geometry.dispose();
    }
  });
  it('seats the rotating necks inside real fixed frame pickups with coaxial hollow races, spacers and a through pin', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    bike.root.updateMatrixWorld(true);
    const inverse = bike.body.matrixWorld.clone().invert();
    const named = (name: string) => bike.body.getObjectsByProperty('name', name) as Mesh[];
    const arms = named('box-section-swingarm'), races = named('supermoto-swingarm-pivot-race');
    const carriers = named('supermoto-frame-pivot-carrier'), spacers = named('supermoto-pivot-bearing-spacer');
    const washers = named('supermoto-pivot-retaining-washer');
    const pin = named('swingarm-pivot')[0] as Mesh<CylinderGeometry>;
    expect(arms).toHaveLength(2); expect(races).toHaveLength(2);
    expect(carriers).toHaveLength(2); expect(spacers).toHaveLength(2);
    expect(washers).toHaveLength(2); expect(named('supermoto-pivot-pin-head')).toHaveLength(2);
    expect(pin.geometry.parameters.radiusTop).toBeCloseTo(0.010, 8);
    const sameSide = (parts: Mesh[], side: number) => parts.find(part => envelope(part, inverse).getCenter(new Vector3()).x * side > 0)!;
    for (const side of [-1, 1]) {
      const arm = sameSide(arms, side), race = sameSide(races, side), carrier = sameSide(carriers, side);
      const spacer = sameSide(spacers, side), washer = sameSide(washers, side);
      expect(race.parent).toBe(arm);
      expect(carrier.geometry.getAttribute('uv').count).toBe(carrier.geometry.getAttribute('position').count);
      const probe = new Mesh(arm.geometry, new MeshStandardMaterial()); probe.updateMatrixWorld(true);
      const outer = new Raycaster(new Vector3(side, dimensions.pivotY + 0.022, dimensions.pivotZ), new Vector3(-side, 0, 0)).intersectObject(probe, false)[0].point.x * side;
      const inner = new Raycaster(new Vector3(-side, dimensions.pivotY + 0.022, dimensions.pivotZ), new Vector3(side, 0, 0)).intersectObject(probe, false)[0].point.x * side;
      expect(inner).toBeCloseTo(0.067, 5); expect(outer).toBeCloseTo(0.095, 5);
      const seatProbe = new Mesh(carrier.geometry, new MeshStandardMaterial()); seatProbe.updateMatrixWorld(true);
      expect(through(seatProbe, dimensions.pivotY, dimensions.pivotZ)).toHaveLength(0);
      const seat = new Raycaster(new Vector3(-side, dimensions.pivotY + 0.013, dimensions.pivotZ), new Vector3(side, 0, 0)).intersectObject(seatProbe, false)[0].point.x * side;
      expect(seat).toBeCloseTo(0.1305, 5);
      expect(seat - outer, 'entire rotating neck lies inboard of the ORIGINAL fixed pickup').toBeGreaterThan(0.035);
      const raceBounds = envelope(race, inverse), xs = [raceBounds.min.x * side, raceBounds.max.x * side];
      expect(Math.min(...xs)).toBeGreaterThan(inner);
      expect(Math.max(...xs)).toBeLessThan(outer);
      expect(SUPERMOTO_SWINGARM.pivotBoreRadius - SUPERMOTO_PIVOT_BEARING.raceOuterRadius).toBeCloseTo(0.0003, 8);
      expect(SUPERMOTO_PIVOT_BEARING.raceInnerRadius - pin.geometry.parameters.radiusTop).toBeCloseTo(0.0004, 8);
      const raceProbe = new Mesh(race.geometry, new MeshStandardMaterial()); raceProbe.updateMatrixWorld(true);
      expect(through(raceProbe, dimensions.pivotY, dimensions.pivotZ)).toHaveLength(0);
      expect(through(raceProbe, dimensions.pivotY + 0.014, dimensions.pivotZ).length).toBeGreaterThan(0);
      expect(surfaceGap(race, spacer, inverse, 0.0005), 'race seats against fixed thrust spacer').toBeLessThan(0.0005);
      expect(surfaceGap(spacer, carrier, inverse, 0.0005), 'spacer bridges the root to the pickup').toBeLessThan(0.0005);
      expect(surfaceGap(washer, carrier, inverse, 0.0005), 'retainer seats on the outside pickup face').toBeLessThan(0.0005);
      for (const name of ['supermoto-frame-main-spar', 'supermoto-frame-merge-branch'])
        expect(surfaceGap(carrier, sameSide(named(name), side), inverse, 0.001), `pickup weld to ${name}`).toBeLessThan(0.001);
    }
    for (const pitch of [0, 0.85]) for (const travel of [-0.20, 0, 0.20]) {
      bike.animateSuspension(pitch, travel, pitch > 0 ? 1 : 0); bike.root.updateMatrixWorld(true);
      const inversePose = bike.body.matrixWorld.clone().invert();
      for (const race of races) {
        expect(race.matrixWorld.equals(race.parent!.matrixWorld)).toBe(true);
        const transform = inversePose.clone().multiply(race.matrixWorld);
        const axis = new Vector3(0, dimensions.pivotY, dimensions.pivotZ).applyMatrix4(transform);
        expect(axis.distanceTo(new Vector3(0, dimensions.pivotY, dimensions.pivotZ))).toBeLessThan(1e-7);
      }
      const pinCenter = new Vector3().applyMatrix4(pin.matrixWorld).applyMatrix4(inversePose);
      expect(pinCenter.distanceTo(new Vector3(0, dimensions.pivotY, dimensions.pivotZ))).toBeLessThan(1e-7);
    }
  });

  it('keeps the complete moving necks and bearing races clear of every engine case detail over full travel', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    const moving = ['box-section-swingarm', 'supermoto-swingarm-pivot-race']
      .flatMap(name => bike.body.getObjectsByProperty('name', name)) as Mesh[];
    const cases: Mesh[] = [];
    bike.body.traverse(part => { if (part instanceof Mesh && part.name.startsWith('engine-')) cases.push(part); });
    expect(cases.some(part => part.name === 'engine-clutch-fastener')).toBe(true);
    expect(cases.some(part => part.name === 'engine-clutch-cover')).toBe(true);
    for (const pitch of [0, 0.85]) for (const travel of [-0.20, 0, 0.20]) {
      bike.animateSuspension(pitch, travel, pitch > 0 ? 1 : 0); bike.root.updateMatrixWorld(true);
      const inverse = bike.body.matrixWorld.clone().invert();
      for (const arm of moving) for (const part of cases)
        expect(surfaceGap(arm, part, inverse, 0.001), `${arm.name}/${part.name}, ${pitch}/${travel}`).toBeGreaterThan(0.001);
    }
  });
  it('has broad planar side faces and closed, outward-wound chamfers instead of a rounded loft', () => {
    const geometry = supermotoSwingarmGeometry(1);
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    const indices = geometry.getIndex()!;
    const normal = new Vector3();
    let planarSideProjection = 0,
      signedVolume = 0;
    const edges = new Map<string, { count: number; orientation: number }>();
    const silhouette: Vector2[] = [];
    const key = (point: Vector3) =>
      point
        .toArray()
        .map((value) => Math.round(value * 1e6))
        .join(',');
    for (let index = 0; index < indices.count; index += 3) {
      const a = new Vector3().fromBufferAttribute(
        positions,
        indices.getX(index),
      );
      const b = new Vector3().fromBufferAttribute(
        positions,
        indices.getX(index + 1),
      );
      const c = new Vector3().fromBufferAttribute(
        positions,
        indices.getX(index + 2),
      );
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
        const vertexNormal = new Vector3().fromBufferAttribute(
          normals,
          indices.getX(index + offset),
        );
        expect(vertexNormal.dot(normal)).toBeGreaterThan(0.99999);
      }
      signedVolume += a.dot(new Vector3().crossVectors(b, c)) / 6;
      silhouette.push(
        new Vector2(a.z, a.y),
        new Vector2(b.z, b.y),
        new Vector2(c.z, c.y),
      );
      for (const [p, q] of [
        [a, b],
        [b, c],
        [c, a],
      ]) {
        const pKey = key(p),
          qKey = key(q);
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
      expect(through(mesh, dimensions.pivotY, dimensions.pivotZ)).toHaveLength(
        0,
      );
      expect(
        through(mesh, dimensions.pivotY + 0.022, dimensions.pivotZ).length,
      ).toBeGreaterThan(0);
      expect(through(mesh, dimensions.axleY, dimensions.axleZ)).toHaveLength(0);
      expect(
        through(mesh, dimensions.axleY, dimensions.axleZ + 0.017),
      ).toHaveLength(0);
      expect(
        through(mesh, dimensions.axleY + 0.02, dimensions.axleZ).length,
      ).toBeGreaterThan(0);
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
        expect(top).toBeDefined(); expect(bottom).toBeDefined();
        return top.point.y - bottom.point.y;
      });
      // The old 56 mm neck visibly pinched above/below the pivot. Keep the
      // full side-profile load path right through the lateral inset.
      for (const depth of depths.slice(0, 4)) expect(depth).toBeGreaterThan(0.085);
      expect(depths[0]).toBeGreaterThan(depths[3]);
      expect(depths[4]).toBeLessThan(0.065);
      expect(supermotoSwingarmSection(0.212).centerX).toBeCloseTo(0.081, 8);
      expect(SUPERMOTO_SHOCK_LOWER_MOUNT.bridge[1]).toBeCloseTo(0.42109887432188065, 9);
      const z = 0.45;
      const y = dimensions.pivotY + (dimensions.axleY - dimensions.pivotY)
        * (z - dimensions.pivotZ) / (dimensions.axleZ - dimensions.pivotZ);
      const faceX = (height: number) => new Raycaster(new Vector3(side, height, z),
        new Vector3(-side, 0, 0)).intersectObject(mesh, false)[0].point.x * side;
      expect(faceX(y + 0.029) - faceX(y)).toBeCloseTo(0.003, 6);
      mesh.geometry.dispose();
    }
  });

  it('keeps the complete forged solids clear of tyre, every chain instance, shock and direct mount through travel', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    const arms = bike.body.getObjectsByProperty('name', 'box-section-swingarm') as Mesh[];
    const bridge = new Mesh(supermotoSwingarmBridgeGeometry(), new MeshStandardMaterial());
    bridge.name = 'swingarm-forward-crossmember';
    const tire = bike.wheels[1].getObjectByName('tire') as Mesh;
    const mechanism = new Set<Mesh>();
    const movingRoots = ['supermoto-shock-damper', 'supermoto-shock-reservoir',
      'supermoto-shock-spring-seat', 'supermoto-shock-eyelet', 'rear-shock-spring',
      'supermoto-shock-lower-pin', 'shock-lower-link']
      .flatMap(name => bike.body.getObjectsByProperty('name', name));
    for (const root of movingRoots) root.traverse(part => {
      if (part instanceof Mesh) mechanism.add(part);
    });
    // Upper barrel, both reservoir caps and the reservoir neck move as real
    // children. Include their complete surfaces, not only parent cylinders.
    expect([...mechanism].filter(part => part.name === 'supermoto-shock-upper-body')).toHaveLength(1);
    expect([...mechanism].filter(part => part.name === 'supermoto-shock-reservoir-cap')).toHaveLength(2);
    expect([...mechanism].filter(part => part.name === 'supermoto-shock-reservoir-neck')).toHaveLength(1);
    expect([...mechanism].filter(part => part.name === 'supermoto-shock-lower-pin')).toHaveLength(1);
    expect([...mechanism].filter(part => part.name === 'shock-lower-link')).toHaveLength(2);
    const chains = ['left-drive-chain', 'chain-rollers']
      .map(name => bike.body.getObjectByName(name) as InstancedMesh);
    expect(arms).toHaveLength(2); expect(mechanism.size).toBeGreaterThan(12);
    const instance = new Matrix4();
    const bearingParts = ['supermoto-swingarm-pivot-race', 'supermoto-pivot-bearing-spacer', 'swingarm-pivot']
      .flatMap(name => bike.body.getObjectsByProperty('name', name)) as Mesh[];
    for (const pitch of [0, 0.85]) for (const travel of [-0.20, 0, 0.20]) {
      bike.animateSuspension(pitch, travel, pitch > 0 ? 1 : 0);
      bike.root.updateMatrixWorld(true);
      bridge.matrixWorld.copy(arms[0].matrixWorld);
      const inverse = bike.body.matrixWorld.clone().invert();
      const chainInstances = chains.flatMap(chain => {
        expect(chain).toBeInstanceOf(InstancedMesh);
        const parts: { part: Mesh; bounds: Box3; faces: ReturnType<typeof faces> }[] = [];
        for (let i = 0; i < chain.count; i++) {
          chain.getMatrixAt(i, instance);
          const part = new Mesh(chain.geometry, chain.material);
          part.matrixWorld.copy(chain.matrixWorld).multiply(instance);
          parts.push({ part, bounds: envelope(part, inverse), faces: faces(part, inverse) });
        }
        return parts;
      });
      // The neck now crosses the chain's X plane BETWEEN its two runs.
      // Measure every actual link, roller and spindle surface, not a box
      // spanning the large empty area enclosed by the complete chain loop.
      for (const part of [...arms, bridge, ...bearingParts]) {
        const bounds = envelope(part, inverse), source = faces(part, inverse);
        let minimum = Infinity;
        let nearest = '';
        for (const target of chainInstances) {
          if (gap(bounds, target.bounds) > 0.006) continue;
          for (const a of source) {
            if (gap(a.bounds, target.bounds) > Math.min(minimum, 0.006)) continue;
            for (const b of target.faces) {
              if (gap(a.bounds, b.bounds) > Math.min(minimum, 0.006)) continue;
              const separation = triangleGap(a.triangle, b.triangle);
              if (separation < minimum) {
                minimum = separation;
                nearest = `beam ${a.triangle.getMidpoint(new Vector3()).toArray()} / link ${b.triangle.getMidpoint(new Vector3()).toArray()}`;
              }
            }
          }
        }
        expect(minimum, `${part.name} to complete chain, ${pitch}/${travel}: ${nearest}`).toBeGreaterThan(0.006);
      }
      for (const arm of arms) {
        const bounds = envelope(arm, inverse), armFaces = faces(arm, inverse);
        expect(surfaceGap(arm, tire, inverse, 0.05), `rear tyre, pitch ${pitch}, travel ${travel}`).toBeGreaterThan(0.05);
        for (const part of mechanism) {
          if (gap(bounds, envelope(part, inverse)) > 0.003) continue;
          let minimum = Infinity;
          const partFaces = faces(part, inverse);
          for (const a of armFaces) for (const b of partFaces) {
            if (gap(a.bounds, b.bounds) > Math.min(minimum, 0.003)) continue;
            minimum = Math.min(minimum, triangleGap(a.triangle, b.triangle));
          }
          expect(minimum, `${part.name}, pitch ${pitch}, travel ${travel}`).toBeGreaterThan(0.003);
        }
      }
    }
    bridge.geometry.dispose();
  });

  it('leaves the original chain passage and ample tire clearance with symmetric, tapered spars', () => {
    const left = supermotoSwingarmGeometry(-1);
    const right = supermotoSwingarmGeometry(1);
    const leftBounds = left.boundingBox!;
    const rightBounds = right.boundingBox!;
    expect(leftBounds.min.x).toBeCloseTo(-rightBounds.max.x, 7);
    expect(leftBounds.max.x).toBeCloseTo(-rightBounds.min.x, 7);
    // Only the rear section runs alongside the tyre. The inboard roots are
    // ahead of it and are checked against the real tread surface above.
    const rearBounds = new Box3(), positions = right.getAttribute('position');
    for (let i = 0; i < positions.count; i++) if (positions.getZ(i) > 0.45)
      rearBounds.expandByPoint(new Vector3().fromBufferAttribute(positions, i));
    expect(rearBounds.min.x - SUPERMOTO_WHEELS.rear.tireWidth / 2).toBeGreaterThan(0.05);
    expect(rearBounds.min.x + CHAIN_DRIVE.planeX - CHAIN_DRIVE.chainHalfWidth).toBeGreaterThan(0.006);
    expect(rightBounds.max.x).toBeLessThan(0.191);
    const mesh = new Mesh(right, new MeshStandardMaterial());
    mesh.updateMatrixWorld(true);
    const widths = [0.212, 0.5, 0.66].map((z) => {
      const t =
        (z - dimensions.pivotZ) / (dimensions.axleZ - dimensions.pivotZ);
      const y = dimensions.pivotY + (dimensions.axleY - dimensions.pivotY) * t - (z < 0.25 ? 0.010 : 0);
      const outer = through(mesh, y, z)[0].point.x;
      const inner = new Raycaster(
        new Vector3(-1, y, z),
        new Vector3(1, 0, 0),
      ).intersectObject(mesh, false)[0].point.x;
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
      const pose = activeSuspensionPose(
        '450',
        0,
        travel,
        SUPERMOTO_CHASSIS.rearAxle,
        SUPERMOTO_CHASSIS.frontAxle,
        SUPERMOTO_CHASSIS.rearRadius,
      );
      const motion = new Matrix4()
        .makeRotationX(pose.rearAngle)
        .setPosition(pose.rearPosition);
      expect(pivot.clone().applyMatrix4(motion).distanceTo(pivot)).toBeLessThan(
        1e-10,
      );
      mesh.matrix.copy(motion);
      mesh.updateMatrixWorld(true);
      const movedAxle = axle.clone().applyMatrix4(motion);
      expect(through(mesh, pivot.y, pivot.z)).toHaveLength(0);
      expect(through(mesh, movedAxle.y, movedAxle.z)).toHaveLength(0);
      expect(movedAxle.distanceTo(pivot)).toBeCloseTo(
        axle.distanceTo(pivot),
        10,
      );
    }
    mesh.geometry.dispose();
  });
});
