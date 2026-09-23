import { Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { SUPERMOTO_SHOCK_BOTTOM, SUPERMOTO_SHOCK_TOP } from './supermotoFit';

type Point = readonly [number, number, number];
const xAxis = new Vector3(1, 0, 0);
const profiles: Record<
  string,
  { front: number; rebound: number; rear: number; pivot: Point }
> = {
  '125': { front: 0.065, rebound: 0.015, rear: 0, pivot: [0, 0.5, 0.04] },
  scooter: {
    front: 0.08,
    rebound: 0.022,
    rear: 0.66,
    pivot: [0, 0.322, 0.184],
  },
  '450': { front: 0.125, rebound: 0.035, rear: 0.72, pivot: [0, 0.5, 0.1] },
  '701': { front: 0.085, rebound: 0.025, rear: 0.68, pivot: [0, 0.51, 0.14] },
};
const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

/** Presentation load only: simulation height, jump arc and fixed-step physics stay unchanged. */
export function suspensionTarget(input: {
  landing: number;
  launch: number;
  forward: number;
  road: number;
  roughness: number;
  airborne: boolean;
}) {
  return input.airborne
    ? -0.025
    : input.landing * 0.17 +
        input.forward * 0.008 -
        input.launch * 0.012 +
        input.road * 0.003 +
        input.roughness * 0.025;
}

/** Both tires retain their physics contact; the chassis moves between their suspension mounts. */
export function activeSuspensionPose(
  model: string,
  pitch: number,
  travel: number,
  rear: number,
  front: number,
  radius: number,
  wheelieLoad = 0,
) {
  const profile = profiles[model] ?? profiles['125'];
  const wheelie = clamp(wheelieLoad, 0, 1);
  const frontTravel = clamp(
    travel - wheelie * 0.009,
    -profile.rebound,
    profile.front,
  );
  const rearTravel = profile.rear
    ? clamp(
        travel * profile.rear + wheelie * 0.018,
        -0.025,
        profile.front * 0.72,
      )
    : 0;
  const pivot = new Vector3(...profile.pivot);
  const rearCenter = new Vector3(0, radius, rear);
  const arm = rearCenter.clone().sub(pivot);
  const armLength = Math.hypot(arm.y, arm.z);
  const movedY = clamp(arm.y + rearTravel, -armLength + 1e-6, armLength - 1e-6);
  const rearAngle =
    profile.rear && rearTravel !== 0
      ? Math.atan2(Math.sqrt(armLength ** 2 - movedY ** 2), movedY) -
        Math.atan2(arm.z, arm.y)
      : 0;
  const rearPosition = pivot
    .clone()
    .sub(pivot.clone().applyAxisAngle(xAxis, rearAngle));
  const movedRear = rearCenter
    .clone()
    .applyAxisAngle(xAxis, rearAngle)
    .add(rearPosition);
  const angle = -(frontTravel - rearTravel) / (rear - front);
  const localPosition = rearCenter
    .clone()
    .sub(movedRear.applyAxisAngle(xAxis, angle));
  const axlePosition = localPosition
    .clone()
    .negate()
    .applyAxisAngle(xAxis, -angle);
  const position = localPosition.clone().applyAxisAngle(xAxis, pitch);
  position.y += radius * (1 - Math.cos(pitch)) + rear * Math.sin(pitch);
  return {
    pitch: pitch + angle,
    position,
    axleAngle: -angle,
    axlePosition,
    rearAngle,
    rearPosition,
    frontTravel,
    rearTravel,
  };
}

function rigParts(body: Group, names: ReadonlySet<string>) {
  // Keep the hierarchy and saved sticker surface paths unchanged.
  return body.children
    .filter((object) => names.has(object.name))
    .map((object) => {
      object.updateMatrix();
      return { object, rest: object.matrix.clone() };
    });
}

/** An axial affine transform compresses the actual coil while both eyelets remain attached. */
function shockRig(
  body: Group,
  names: ReadonlySet<string>,
  top: Point,
  bottom: Point,
) {
  const group = new Group();
  group.name = 'active-rear-shock';
  body.add(group);
  const parts = rigParts(body, names);
  group.matrixAutoUpdate = false;
  const origin = new Vector3(...top),
    end = new Vector3(...bottom);
  const axis = end.clone().sub(origin).normalize();
  const length = origin.distanceTo(end);
  const basis = new Matrix4().makeRotationFromQuaternion(
    new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis),
  );
  const inverseBasis = basis.clone().invert();
  const start = new Matrix4().makeTranslation(...top),
    finish = new Matrix4().makeTranslation(-top[0], -top[1], -top[2]);
  const direction = new Vector3(),
    moved = new Vector3(),
    rotation = new Quaternion(),
    stretch = new Matrix4(),
    rotationMatrix = new Matrix4();
  return (rearMatrix: Matrix4) => {
    moved.copy(end).applyMatrix4(rearMatrix);
    direction.subVectors(moved, origin);
    const ratio = direction.length() / length;
    rotation.setFromUnitVectors(axis, direction.normalize());
    stretch.makeScale(1, ratio, 1);
    group.matrix
      .copy(start)
      .multiply(rotationMatrix.makeRotationFromQuaternion(rotation))
      .multiply(basis)
      .multiply(stretch)
      .multiply(inverseBasis)
      .multiply(finish);
    group.matrixWorldNeedsUpdate = true;
    for (const { object, rest } of parts) {
      object.matrixAutoUpdate = false;
      object.matrix.multiplyMatrices(group.matrix, rest);
      object.matrixWorldNeedsUpdate = true;
    }
  };
}

const motorcycleRear = new Set([
  'rear-wheel',
  'box-section-swingarm',
  'brake-caliper',
  'brake-caliper-carrier',
  'brake-carrier-bolt',
  'rear-brake-torque-link',
  'rear-axle',
  'swingarm-crossmember',
  'shock-lower-link',
  'sport-shock-swingarm-bridge',
  'sport-rear-hugger',
  'sport-hugger-swingarm-foot',
]);
const scooterRear = new Set([
  'rear-wheel',
  'scooter-engine',
  'scooter-drive-case',
  'scooter-transmission-cover',
  'transmission-cover-bolt',
  'scooter-cooling-fan-housing',
  'scooter-cooling-fan-grille',
  'fan-grille-rib',
  'scooter-right-engine-arm',
  'rear-axle',
  'rear-shock-lower-mount',
  'scooter-rear-fender',
  'scooter-rear-mudflap',
  'rear-mudguard-mount',
  'scooter-exhaust-header',
  'single-exhaust',
  'scooter-exhaust-heat-shield',
  'exhaust-front-mount',
  'open-silencer-outlet',
]);

/** Build once; all frame updates use the existing bounded meshes and instances. */
export function createRearSuspension(body: Group, model: string) {
  const rear = new Group();
  rear.name = 'rear-suspension-axle';
  body.add(rear);
  const shockUpdates: ((matrix: Matrix4) => void)[] = [];
  const parts =
    model === '125'
      ? []
      : rigParts(body, model === 'scooter' ? scooterRear : motorcycleRear);
  const rearWheel = body.getObjectByName('rear-wheel');
  const axle = rearWheel?.position.z ?? 0.7;
  if (model === '450')
    shockUpdates.push(
      shockRig(
        body,
        new Set([
          'supermoto-shock-damper',
          'rear-shock-spring',
          'supermoto-shock-reservoir',
          'supermoto-shock-spring-seat',
          'supermoto-shock-eyelet',
        ]),
        SUPERMOTO_SHOCK_TOP,
        SUPERMOTO_SHOCK_BOTTOM,
      ),
    );
  if (model === '701')
    shockUpdates.push(
      shockRig(
        body,
        new Set([
          'sport-shock-damper',
          'sport-shock-piston',
          'sport-shock-spring-seat',
          'sport-shock-eyelet',
          'sport-rear-shock-spring',
        ]),
        [0, 0.73, 0.205],
        [0, 0.508, 0.335],
      ),
    );
  if (model === 'scooter') {
    shockUpdates.push(
      shockRig(
        body,
        new Set(['scooter-rear-damper', 'scooter-rear-spring']),
        [-0.147, 0.619, 0.467],
        [-0.135, 0.27, 0.563],
      ),
    );
    shockUpdates.push(
      shockRig(
        body,
        new Set(['exhaust-hanger']),
        [0.172, 0.525, 0.615],
        [0.24, 0.382, 0.633],
      ),
    );
  }
  const chains = body.children
    .filter(
      (object): object is InstancedMesh =>
        object instanceof InstancedMesh &&
        (object.name === 'left-drive-chain' || object.name === 'chain-rollers'),
    )
    .map((mesh) => ({
      mesh,
      matrices: Array.from({ length: mesh.count }, (_, i) => {
        const matrix = new Matrix4();
        mesh.getMatrixAt(i, matrix);
        return matrix;
      }),
    }));
  const p = new Vector3(),
    moved = new Vector3(),
    scale = new Vector3(),
    rotation = new Quaternion(),
    turn = new Quaternion(),
    matrix = new Matrix4();
  let previous = NaN;
  return {
    group: rear,
    update(angle: number, position: Vector3) {
      if (angle === previous) return;
      const oldAngle = Number.isFinite(previous) ? previous : 0;
      previous = angle;
      rear.rotation.x = angle;
      rear.position.copy(position);
      rear.updateMatrix();
      for (const { object, rest } of parts) {
        if (object === rearWheel) {
          object.position.setFromMatrixPosition(rest).applyMatrix4(rear.matrix);
          object.rotation.x += angle - oldAngle;
        } else {
          object.matrixAutoUpdate = false;
          object.matrix.multiplyMatrices(rear.matrix, rest);
          object.matrixWorldNeedsUpdate = true;
        }
      }
      for (const update of shockUpdates) update(rear.matrix);
      for (const chain of chains) {
        for (let i = 0; i < chain.matrices.length; i++) {
          chain.matrices[i].decompose(p, rotation, scale);
          const blend = clamp((p.z - 0.16) / Math.max(0.1, axle - 0.28), 0, 1);
          moved.copy(p).applyMatrix4(rear.matrix);
          p.lerp(moved, blend);
          turn.setFromAxisAngle(xAxis, angle * blend);
          rotation.premultiply(turn);
          matrix.compose(p, rotation, scale);
          chain.mesh.setMatrixAt(i, matrix);
        }
        chain.mesh.instanceMatrix.needsUpdate = true;
        chain.mesh.computeBoundingSphere();
      }
    },
  };
}
