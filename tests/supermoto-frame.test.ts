import { describe, expect, it, vi } from 'vitest';
import {
  CylinderGeometry,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Raycaster,
  TubeGeometry,
  Triangle,
  Vector3,
} from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeBike } from '../app/game/vehicle';
import { SUPERMOTO_SWINGARM } from '../app/game/supermotoSwingarm';
import {
  supermotoLowerFrameGeometry,
  supermotoLowerFramePath,
  SUPERMOTO_PIVOT_FRAME_JOINT,
} from '../app/game/supermotoFrame';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

describe('compact Supermoto engine cradle', () => {
  it('keeps the actual fixed bearing branches and moving forward bridge clear through full suspension travel', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    const finish = new MeshBasicMaterial({ side: DoubleSide });
    const frameNames = [
      'supermoto-frame-main-spar',
      'supermoto-frame-merge-branch',
      'supermoto-rear-subframe',
      'supermoto-frame-central-up-tube',
      'supermoto-steering-neck-gusset',
      'supermoto-cradle-crossmember',
    ];
    const frames = frameNames.flatMap((name) =>
      bike.body.getObjectsByProperty('name', name),
    ) as Mesh[];
    const arms = bike.body.getObjectsByProperty(
      'name',
      'box-section-swingarm',
    ) as Mesh[];
    const bridge = bike.body.getObjectByName(
      'swingarm-forward-crossmember',
    ) as Mesh<CylinderGeometry>;
    const cases: Mesh[] = [];
    bike.body.traverse((object) => {
      if (
        object instanceof Mesh &&
        /engine-(crankcase|clutch-cover|ignition-cover|water-jacket|cylinder-head|output-shaft)/.test(
          object.name,
        )
      )
        cases.push(object);
    });
    const direction = new Vector3(0.719, 0.417, 0.557).normalize();
    const proxy = (object: Mesh) => {
      const mesh = new Mesh(object.geometry, finish);
      mesh.name = object.name;
      mesh.matrixWorld.copy(object.matrixWorld);
      return mesh;
    };
    const clear = (point: Vector3, target: Mesh, source: string) => {
      const hits = new Raycaster(point, direction)
        .intersectObject(target, false)
        .map((hit) => hit.distance)
        .filter((distance, i, all) => !i || distance - all[i - 1] > 1e-6);
      expect(
        hits.length % 2,
        `${source} in ${target.name}: ${point.toArray().join(',')}`,
      ).toBe(0);
    };
    const triangles = (meshes: Mesh[]) =>
      meshes.flatMap((mesh) => {
        const points = mesh.geometry.getAttribute('position');
        const indices = mesh.geometry.getIndex();
        const result: Triangle[] = [];
        const at = (index: number) =>
          new Vector3()
            .fromBufferAttribute(points, indices ? indices.getX(index) : index)
            .applyMatrix4(mesh.matrixWorld);
        for (
          let index = 0;
          index < (indices?.count ?? points.count);
          index += 3
        )
          result.push(new Triangle(at(index), at(index + 1), at(index + 2)));
        return result;
      });
    const nearest = new Vector3();
    const distance = (point: Vector3, surfaces: Triangle[]) => {
      let closest = Infinity;
      for (const face of surfaces) {
        face.closestPointToPoint(point, nearest);
        closest = Math.min(closest, nearest.distanceTo(point));
      }
      return closest;
    };
    // The fixed main spar must enter the actual pivot sleeve, not merely
    // point toward its centre while its circular tube end floats beside it.
    for (const side of [-1, 1]) {
      const main = frames.find(
        (part) =>
          part.name === 'supermoto-frame-main-spar' &&
          Math.sign(
            part.geometry
              .getAttribute('position')
              .getX(part.geometry.getAttribute('position').count - 1),
          ) === side,
      )!;
      const points = main.geometry.getAttribute('position');
      let weldRadius = Infinity;
      for (let index = 0; index < points.count; index++) {
        const point = new Vector3().fromBufferAttribute(points, index);
        if (Math.abs(point.x) > 0.19) continue;
        weldRadius = Math.min(
          weldRadius,
          Math.hypot(point.y - 0.5, point.z - 0.1),
        );
      }
      expect(weldRadius).toBeLessThan(0.0329);
    }
    let armGap = Infinity,
      caseGap = Infinity,
      bridgeFrameGap = Infinity;
    let armGapContext = '';
    for (const travel of [-0.025, 0, 0.06, 0.12]) {
      bike.animateSuspension(0, travel);
      bike.root.updateMatrixWorld(true);
      const armProbes = arms.map(proxy),
        caseProbes = cases.map(proxy);
      const armSurfaces = triangles(arms),
        caseSurfaces = travel === 0 ? triangles(cases) : [];
      const frameSurfaces = triangles(frames);
      const scale = bike.body.matrixWorld.getMaxScaleOnAxis();
      for (const frame of frames) {
        const points = frame.geometry.getAttribute('position');
        for (let index = 0; index < points.count; index++) {
          const point = new Vector3()
            .fromBufferAttribute(points, index)
            .applyMatrix4(frame.matrixWorld);
          for (const target of [...armProbes, ...caseProbes])
            clear(point, target, frame.name);
          if (points.getY(index) < 0.65 && points.getZ(index) > 0.03) {
            const gap = distance(point, armSurfaces) / scale;
            if (gap < armGap) {
              armGap = gap;
              armGapContext = `${frame.name}, travel ${travel}, local vertex ${points.getX(index)},${points.getY(index)},${points.getZ(index)}`;
            }
            if (caseSurfaces.length)
              caseGap = Math.min(
                caseGap,
                distance(point, caseSurfaces) / scale,
              );
          }
        }
      }
      // Sample the entire bridge surface, including its midspan, not only
      // cylinder vertices located at its two ends outside the engine width.
      const params = bridge.geometry.parameters;
      for (let along = 0; along <= 16; along++)
        for (let around = 0; around < 24; around++) {
          const angle = (around / 24) * Math.PI * 2;
          const point = new Vector3(
            Math.cos(angle) * params.radiusTop,
            (along / 16 - 0.5) * params.height,
            Math.sin(angle) * params.radiusTop,
          ).applyMatrix4(bridge.matrixWorld);
          for (const target of caseProbes) clear(point, target, bridge.name);
          bridgeFrameGap = Math.min(
            bridgeFrameGap,
            distance(point, frameSurfaces) / scale,
          );
        }
      const chain = bike.body.getObjectByName(
        'left-drive-chain',
      ) as InstancedMesh;
      const instance = new Matrix4();
      const chainProbe = new Mesh(chain.geometry, finish);
      chainProbe.name = 'left-drive-chain';
      for (const frame of frames.filter(
        (part) => part.name !== 'supermoto-rear-subframe',
      )) {
        const points = frame.geometry.getAttribute('position');
        for (let index = 0; index < points.count; index += 2) {
          const point = new Vector3()
            .fromBufferAttribute(points, index)
            .applyMatrix4(frame.matrixWorld);
          const local = point
            .clone()
            .applyMatrix4(bike.body.matrixWorld.clone().invert());
          if (local.x > -0.095 || local.x < -0.13 || local.z > 0.3) continue;
          for (let link = 0; link < chain.count; link++) {
            chain.getMatrixAt(link, instance);
            chainProbe.matrixWorld.multiplyMatrices(
              chain.matrixWorld,
              instance,
            );
            clear(point, chainProbe, frame.name);
          }
        }
      }
      const rear = bike.body.getObjectByName('rear-suspension-axle')!;
      const bridgePosition = new Vector3(
        0,
        SUPERMOTO_SWINGARM.forwardBridgeY,
        SUPERMOTO_SWINGARM.forwardBridgeZ,
      ).applyMatrix4(rear.matrix);
      const actual = bridge
        .getWorldPosition(new Vector3())
        .applyMatrix4(bike.body.matrixWorld.clone().invert());
      // The original crossmember ends are slightly asymmetric in X.
      expect(
        actual.distanceTo(bridgePosition.clone().setX(-0.002)),
      ).toBeLessThan(1e-8);
    }
    expect(armGap, armGapContext).toBeGreaterThan(0.001);
    expect(caseGap).toBeGreaterThan(0.001);
    expect(bridgeFrameGap).toBeGreaterThan(0.001);
    finish.dispose();
  });

  it('keeps both frame joints fixed and bends without sagging below the sump', () => {
    for (const side of [-1, 1]) {
      const path = supermotoLowerFramePath(side);
      expect(
        path
          .getPoint(0)
          .distanceTo(
            new Vector3(
              side * SUPERMOTO_PIVOT_FRAME_JOINT[0],
              SUPERMOTO_PIVOT_FRAME_JOINT[1],
              SUPERMOTO_PIVOT_FRAME_JOINT[2],
            ),
          ),
      ).toBeLessThan(1e-8);
      expect(
        path.getPoint(1).distanceTo(new Vector3(0, 0.625, -0.35)),
      ).toBeLessThan(1e-8);
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

  it('keeps the real lower pipes outside the new engine cases and header', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    bike.root.updateMatrixWorld(true);
    const finish = new MeshBasicMaterial({ side: DoubleSide });
    const engineNames = new Set([
      'engine-crankcase',
      'engine-clutch-cover',
      'engine-ignition-cover',
      'engine-water-jacket',
      'engine-cylinder-head',
    ]);
    const probes: Mesh[] = [];
    bike.body.traverse((object) => {
      if (!(object instanceof Mesh) || !engineNames.has(object.name)) return;
      const probe = new Mesh(object.geometry, finish);
      probe.name = object.name;
      probe.matrixWorld.copy(object.matrixWorld);
      probes.push(probe);
    });
    expect(probes.length).toBeGreaterThanOrEqual(5);
    // The header is an open-ended tube, so odd/even ray containment cannot
    // classify its volume. Measure its real authored bore axis instead.
    const header = bike.body.getObjectByName(
      'connected-exhaust-pipe',
    ) as Mesh<TubeGeometry>;
    const headerPath = header.geometry.parameters.path
      .getSpacedPoints(512)
      .map((point) => point.applyMatrix4(header.matrixWorld));
    const headerRadius =
      header.geometry.parameters.radius *
      header.matrixWorld.getMaxScaleOnAxis();
    const direction = new Vector3(0.719, 0.417, 0.557).normalize();
    try {
      for (const pipe of bike.body.getObjectsByProperty(
        'name',
        'supermoto-frame-merge-branch',
      ) as Mesh[]) {
        const positions = pipe.geometry.getAttribute('position');
        for (let index = 0; index < positions.count; index += 2) {
          const point = new Vector3()
            .fromBufferAttribute(positions, index)
            .applyMatrix4(pipe.matrixWorld);
          expect(
            Math.min(...headerPath.map((center) => center.distanceTo(point))),
          ).toBeGreaterThan(headerRadius + 0.002);
          for (const probe of probes) {
            const hits = new Raycaster(point, direction)
              .intersectObject(probe, false)
              .map((hit) => hit.distance)
              .filter(
                (distance, i, all) => i === 0 || distance - all[i - 1] > 1e-6,
              );
            expect(
              hits.length % 2,
              `cradle must not penetrate ${probe.name}`,
            ).toBe(0);
          }
        }
      }
    } finally {
      finish.dispose();
    }
  });

  it('keeps the complete moving shock bridge ahead of the actual rear tire', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    const tire = bike.wheels[1].getObjectByName('tire') as Mesh;
    tire.geometry.computeBoundingBox();
    const radius = tire.geometry.boundingBox!.max.y;
    const halfWidth = tire.geometry.boundingBox!.max.x;
    const members = ['swingarm-crossmember', 'shock-lower-link'].map(
      (name) => bike.body.getObjectByName(name) as Mesh,
    );
    for (const travel of [-0.025, 0, 0.12]) {
      bike.animateSuspension(0, travel);
      bike.root.updateMatrixWorld(true);
      const inverse = tire.matrixWorld.clone().invert();
      for (const member of members) {
        const points = member.geometry.getAttribute('position');
        let samples = 0;
        for (let index = 0; index < points.count; index++) {
          const point = new Vector3()
            .fromBufferAttribute(points, index)
            .applyMatrix4(member.matrixWorld)
            .applyMatrix4(inverse);
          if (Math.abs(point.x) > halfWidth) continue;
          expect(
            Math.hypot(point.y, point.z) - radius,
            `${member.name} must clear rear tread`,
          ).toBeGreaterThan(0.004);
          samples++;
        }
        // The bridge only has cylinder vertices at its outer ends; measure
        // the midspan ring too, where the tire actually crosses its sweep.
        if (!samples && member.geometry instanceof CylinderGeometry) {
          const radius = Math.max(
            member.geometry.parameters.radiusTop,
            member.geometry.parameters.radiusBottom,
          );
          for (let step = 0; step < 16; step++) {
            const point = new Vector3(
              Math.cos((step / 16) * Math.PI * 2) * radius,
              0,
              Math.sin((step / 16) * Math.PI * 2) * radius,
            )
              .applyMatrix4(member.matrixWorld)
              .applyMatrix4(inverse);
            expect(
              Math.hypot(point.y, point.z) - tire.geometry.boundingBox!.max.y,
            ).toBeGreaterThan(0.004);
          }
        }
      }
    }
  });
});
