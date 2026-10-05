import {
  Box3,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  SkinnedMesh,
  Vector3,
} from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { createRagdoll, type RagdollPose } from './ragdoll';
import type { Point } from './riderSkeleton';
import type { CrashDirection } from './crashTravel';

interface CrashBike {
  root: Object3D;
  body: Object3D;
  rider: Object3D;
  impactObstacle?: Object3D;
  animateSuspension(pitch: number, travel: number): void;
  animateCrashPose?(
    progress: number,
    side: number,
    dt: number,
    crashTime: number,
  ): void;
  animateAccessories?(motion: { reducedMotion?: boolean }, dt: number): void;
  captureRagdollPose?(): RagdollPose;
  applyRagdollPose?(pose: RagdollPose): void;
}

interface CrashOptions {
  cause: string;
  pitch: number;
  travel: number;
  reducedMotion: boolean;
  impactObstacle?: Object3D;
  collisionObstacles?: Object3D[];
  impactSpeed?: number;
  impactDirection?: CrashDirection;
  /** World X velocity at contact; the fall retains an existing lane change. */
  lateralVelocity?: number;
}

export const crashDuration = (cause: string, reducedMotion: boolean) =>
  cause === 'Ride ended' ? 0 : reducedMotion ? 0.18 : 1.2;

const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

/** Small relative motions sit on top of the road's continued forward travel. */
function crashMotion(options: CrashOptions, initialRoll: number) {
  const direction =
    options.impactDirection ??
    (/polizei.*gerammt/i.test(options.cause)
      ? 'rear'
      : options.impactObstacle || /collision/i.test(options.cause)
        ? 'front'
        : 'fall');
  const wheelie = /overrotated/i.test(options.cause);
  const speed = Math.max(0, Math.min(40, options.impactSpeed ?? 14));
  const lateral = Math.max(-2.2, Math.min(2.2, options.lateralVelocity ?? 0));
  // Falling follows the actual lean/sideways momentum, never the equipment.
  const side =
    Math.abs(initialRoll) > 0.025
      ? -Math.sign(initialRoll)
      : Math.abs(lateral) > 0.1
        ? Math.sign(lateral)
        : 1;
  const front = direction === 'front';
  const rear = direction === 'rear';
  const forward = wheelie
    ? 0.45 + speed * 0.025
    : (front ? 2.2 : rear ? 2.7 : 1.5) + speed * 0.055;
  return {
    direction,
    side,
    wheelie,
    fallTime: wheelie ? 0.88 : rear ? 0.82 : 0.74,
    lateralSlide: lateral * 0.16 + side * (rear ? 0.28 : 0.22),
    forwardSlide: (front ? 0.7 : rear ? 1.3 : 0.95) + speed * 0.025,
    velocity: [
      lateral * 0.42 + side * 0.48,
      rear ? 0.12 : 0,
      -forward,
    ] as Point,
    angularVelocity: [
      wheelie ? 1.05 : front ? -1.05 : -0.3,
      side * 0.08,
      -side * (rear ? 1.15 : 1.35),
    ] as Point,
  };
}

function shiftWorldZ(object: Object3D, distance: number) {
  if (!object.parent) {
    object.position.z += distance;
    return;
  }
  const parent = object.parent;
  parent.updateWorldMatrix(true, false);
  const start = parent.worldToLocal(new Vector3(0, 0, 0));
  const end = parent.worldToLocal(new Vector3(0, 0, distance));
  object.position.add(end.sub(start));
}

/** Exact support vertices of the posed geometry, cached once before the fall. */
function contacts(owner: Object3D, excluded?: Object3D) {
  owner.updateWorldMatrix(true, true);
  // SkinnedMesh refreshes its inverse bind transform in updateMatrixWorld,
  // including when this captures a crash before the current frame is rendered.
  owner.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(owner.matrixWorld).invert();
  const transform = new Matrix4(),
    local = new Matrix4(),
    instance = new Matrix4(),
    box = new Box3();
  const vertices: Vector3[] = [];
  const visit = (object: Object3D) => {
    if (object === excluded || !object.visible) return;
    if (object instanceof Mesh) {
      if (object instanceof SkinnedMesh) object.skeleton.update();
      local.multiplyMatrices(inverse, object.matrixWorld);
      const instances = object instanceof InstancedMesh ? object.count : 1;
      const count = object.geometry.getAttribute('position').count;
      for (let index = 0; index < instances; index++) {
        if (object instanceof InstancedMesh) {
          object.getMatrixAt(index, instance);
          transform.multiplyMatrices(local, instance);
        } else transform.copy(local);
        for (let vertex = 0; vertex < count; vertex++) {
          const point = object
            .getVertexPosition(vertex, new Vector3())
            .applyMatrix4(transform);
          vertices.push(point);
          box.expandByPoint(point);
        }
      }
    }
    for (const child of object.children) visit(child);
  };
  visit(owner);
  // The hull keeps exactly the same extrema in every direction without scanning
  // all garment, tread and spoke vertices on each animation frame.
  const hull = new ConvexHull().setFromPoints(vertices);
  const support = new Set<Vector3>();
  for (const face of hull.faces) {
    let edge = face.edge;
    do {
      support.add(edge.head().point);
      edge = edge.next;
    } while (edge !== face.edge);
  }
  return { points: [...support], center: box.getCenter(new Vector3()) };
}

function transformPose(
  pose: RagdollPose,
  matrix: Matrix4,
  rotation: Quaternion,
): RagdollPose {
  const transform = (value: Point) =>
    new Vector3(...value).applyMatrix4(matrix).toArray() as Point;
  return {
    hip: transform(pose.hip),
    shoulder: transform(pose.shoulder),
    head: transform(pose.head),
    orientation: rotation
      .clone()
      .multiply(new Quaternion(...pose.orientation))
      .normalize()
      .toArray(),
    limbs: pose.limbs.map(({ arm, leg }) => {
      const limb = (value: typeof arm) => ({
        start: transform(value.start),
        joint: transform(value.joint),
        end: transform(value.end),
      });
      return { arm: limb(arm), leg: limb(leg) };
    }),
  };
}

function shiftWorld(object: Object3D, movement: Vector3) {
  if (!object.parent) object.position.add(movement);
  else {
    object.parent.updateWorldMatrix(true, false);
    const start = object.parent.worldToLocal(new Vector3());
    object.position.add(
      object.parent.worldToLocal(movement.clone()).sub(start),
    );
  }
}

/** Suspension can change the initial cached hull. Measure its final road
 * contact once, after settling, while keeping the detached rider in place. */
function settleChassisContact(bike: CrashBike) {
  bike.body.updateWorldMatrix(true, true);
  bike.body.updateMatrixWorld(true);
  const point = new Vector3(), instance = new Matrix4(), transform = new Matrix4();
  let minimumY = Infinity;
  const visit = (object: Object3D) => {
    if (object === bike.rider || !object.visible) return;
    if (object instanceof Mesh) {
      if (object instanceof SkinnedMesh) object.skeleton.update();
      const instances = object instanceof InstancedMesh ? object.count : 1;
      const count = object.geometry.getAttribute('position').count;
      for (let i = 0; i < instances; i++) {
        transform.copy(object.matrixWorld);
        if (object instanceof InstancedMesh) {
          object.getMatrixAt(i, instance);
          transform.multiply(instance);
        }
        for (let vertex = 0; vertex < count; vertex++) {
          object.getVertexPosition(vertex, point).applyMatrix4(transform);
          minimumY = Math.min(minimumY, point.y);
        }
      }
    }
    object.children.forEach(visit);
  };
  visit(bike.body);
  const correction = Number.isFinite(minimumY) ? 0.025 - minimumY : 0;
  if (Math.abs(correction) > 1e-8) {
    shiftWorld(bike.root, point.set(0, correction, 0));
    shiftWorld(bike.rider, point.set(0, -correction, 0));
  }
  return correction;
}

/** Ground-shadow quads are drawings, not bodywork or rider collision surfaces. */
function solidObstacleBounds(object: Object3D) {
  object.updateWorldMatrix(true, true);
  const bounds = new Box3(),
    part = new Box3(),
    transform = new Matrix4(),
    instance = new Matrix4();
  object.traverseVisible((child) => {
    if (!(child instanceof Mesh) || child.name === 'traffic-contact-shadow')
      return;
    if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
    const count = child instanceof InstancedMesh ? child.count : 1;
    for (let i = 0; i < count; i++) {
      transform.copy(child.matrixWorld);
      if (child instanceof InstancedMesh) {
        child.getMatrixAt(i, instance);
        transform.multiply(instance);
      }
      part.copy(child.geometry.boundingBox!).applyMatrix4(transform);
      bounds.union(part);
    }
  });
  return bounds;
}

/** Project the chassis to the closest horizontal surface of each obstacle. */
function separateChassis(
  object: Object3D,
  bounds: Box3,
  obstacles: Box3[],
  impactBounds?: Box3,
  direction?: CrashDirection,
) {
  for (let iteration = 0; iteration < 3; iteration++) {
    for (const obstacle of obstacles) {
      if (!bounds.intersectsBox(obstacle)) continue;
      const candidates = [
        new Vector3(obstacle.min.x - bounds.max.x - 0.025, 0, 0),
        new Vector3(obstacle.max.x - bounds.min.x + 0.025, 0, 0),
        new Vector3(0, 0, obstacle.min.z - bounds.max.z - 0.025),
        new Vector3(0, 0, obstacle.max.z - bounds.min.z + 0.025),
      ];
      // At a known bumper contact, the shortest AABB overlap can be sideways.
      // Resolving that way instantly moves the whole motorcycle into a lane
      // beside the vehicle. Retain the actual contact normal instead.
      const bumper =
        obstacle === impactBounds &&
        (direction === 'front' || direction === 'rear');
      if (!bumper) candidates.sort((a, b) => a.lengthSq() - b.lengthSq());
      const correction = bumper
        ? candidates[direction === 'front' ? 3 : 2]
        : candidates[0];
      shiftWorld(object, correction);
      bounds.translate(correction);
    }
  }
}

/** The real rider is skinned by world-space joint physics independently of the sliding bike. */
function createPhysicalCrash(bike: CrashBike, options: CrashOptions) {
  const duration = crashDuration(options.cause, options.reducedMotion);
  const obstacleObjects = [
    ...new Set([
      ...(options.collisionObstacles ?? []),
      ...(options.impactObstacle ? [options.impactObstacle] : []),
    ]),
  ];
  const obstacles = obstacleObjects.map(solidObstacleBounds);
  const impactBounds = options.impactObstacle
    ? obstacles[obstacleObjects.indexOf(options.impactObstacle)]
    : undefined;
  const chassis = contacts(bike.body, bike.rider);
  const initialRoot = bike.root.position.clone();
  const initialRoll = bike.root.rotation.z,
    initialYaw = bike.root.rotation.y;
  const motion = crashMotion(options, initialRoll);
  const { side } = motion;
  bike.rider.updateWorldMatrix(true, true);
  const riderWorld = bike.rider.matrixWorld.clone();
  const riderInverse = riderWorld.clone().invert();
  const riderRotation = bike.rider.getWorldQuaternion(new Quaternion());
  const inverseRotation = riderRotation.clone().invert();
  const riderOrigin = bike.rider.getWorldPosition(new Vector3());
  const riderScale = bike.rider.getWorldScale(new Vector3());
  const initialPose = transformPose(
    bike.captureRagdollPose!(),
    riderWorld,
    riderRotation,
  );
  const ragdoll = createRagdoll(initialPose, {
    obstacles,
    scale: riderScale.x,
    velocity: motion.velocity,
    angularVelocity: motion.angularVelocity,
  });
  const bodyBounds = new Box3(),
    riderBounds = new Box3();
  const point = new Vector3(),
    focus = new Vector3();
  let elapsed = 0,
    initialized = false,
    settled = false;

  function bodyPose(time: number) {
    const fall = smooth(time / motion.fallTime);
    const slide = 1 - (1 - Math.min(1, time / 1.2)) ** 3;
    bike.root.position.set(
      initialRoot.x + motion.lateralSlide * slide,
      initialRoot.y * (1 - fall),
      initialRoot.z - motion.forwardSlide * slide,
    );
    bike.root.rotation.z = initialRoll + (-side * 1.46 - initialRoll) * fall;
    bike.root.rotation.y = initialYaw + side * 0.11 * fall;
    bike.animateSuspension(
      options.pitch * (1 - fall),
      options.travel * (1 - fall),
    );
    bike.body.updateWorldMatrix(true, false);
    bodyBounds.makeEmpty();
    for (const support of chassis.points)
      bodyBounds.expandByPoint(
        point.copy(support).applyMatrix4(bike.body.matrixWorld),
      );
    const lift = Math.max(0, 0.025 - bodyBounds.min.y);
    shiftWorld(bike.root, new Vector3(0, lift, 0));
    bodyBounds.translate(new Vector3(0, lift, 0));
    separateChassis(
      bike.root,
      bodyBounds,
      obstacles,
      impactBounds,
      motion.direction,
    );
    bike.body.updateWorldMatrix(true, false);
    // The rider remains under the bike for ownership/disposal, but its frame is
    // held in world space while physics positions every joint independently.
    const parent = bike.rider.parent;
    if (parent) {
      bike.rider.position.copy(parent.worldToLocal(riderOrigin.clone()));
      bike.rider.quaternion
        .copy(parent.getWorldQuaternion(new Quaternion()).invert())
        .multiply(riderRotation);
    }
  }

  function apply(pose: RagdollPose) {
    bike.applyRagdollPose!(transformPose(pose, riderInverse, inverseRotation));
    riderBounds.makeEmpty();
    for (const value of [
      pose.hip,
      pose.shoulder,
      pose.head,
      ...pose.limbs.flatMap(({ arm, leg }) => [
        arm.start,
        arm.joint,
        arm.end,
        leg.start,
        leg.joint,
        leg.end,
      ]),
    ])
      riderBounds.expandByPoint(point.set(...value));
    riderBounds.expandByScalar(0.15 * riderScale.x);
    focus
      .copy(bodyBounds.getCenter(new Vector3()))
      .add(riderBounds.getCenter(new Vector3()))
      .multiplyScalar(0.5);
  }

  function settle() {
    bike.animateAccessories?.({ reducedMotion: true }, 1 / 120);
    bodyBounds.translate(new Vector3(0, settleChassisContact(bike), 0));
    const support = contacts(bike.rider);
    riderBounds.makeEmpty();
    for (const value of support.points)
      riderBounds.expandByPoint(
        point.copy(value).applyMatrix4(bike.rider.matrixWorld),
      );
    // Only lower to the road when no vehicle supports the rider. A body resting
    // on the bonnet must remain on the bonnet at the end of the presentation.
    let floor = 0.0355;
    for (const obstacle of obstacles) {
      const overlaps =
        riderBounds.max.x > obstacle.min.x &&
        riderBounds.min.x < obstacle.max.x &&
        riderBounds.max.z > obstacle.min.z &&
        riderBounds.min.z < obstacle.max.z;
      if (overlaps && riderBounds.min.y > obstacle.max.y - 0.25)
        floor = Math.max(floor, obstacle.max.y + 0.0355);
    }
    const correction = floor - riderBounds.min.y;
    shiftWorld(bike.rider, new Vector3(0, correction, 0));
    riderBounds.translate(new Vector3(0, correction, 0));
    // Joint/capsule contacts have already separated the physical rider. Its
    // enclosing AABB may still overlap a vehicle corner; pushing that entire
    // box away here would teleport a correctly resting articulated body.
    focus
      .copy(bodyBounds.getCenter(new Vector3()))
      .add(riderBounds.getCenter(new Vector3()))
      .multiplyScalar(0.5);
    bike.root.updateMatrixWorld(true);
    settled = true;
  }

  function advance(dt: number, active: boolean) {
    if (duration === 0) return true;
    const delta =
      active && Number.isFinite(dt)
        ? Math.max(0, Math.min(0.1, dt, duration - elapsed))
        : 0;
    if (delta > 0) elapsed = Math.min(duration, elapsed + delta);
    if (settled || (!active && initialized)) return elapsed >= duration;
    initialized = true;
    if (options.reducedMotion) {
      // Simulate offscreen once, then expose one still pose for the short delay.
      for (let step = 0; step < 12; step++) ragdoll.advance(0.1);
      bodyPose(1.2);
      apply(ragdoll.pose());
      settle();
    } else {
      bodyPose(elapsed);
      apply(ragdoll.advance(delta));
      if (elapsed >= duration - 1e-9) {
        elapsed = duration;
        settle();
      }
    }
    return elapsed >= duration;
  }

  return {
    duration,
    focus,
    get elapsed() {
      return elapsed;
    },
    get cameraBlend() {
      return options.reducedMotion ? 1 : smooth(elapsed / 0.55);
    },
    advance,
  };
}

/** A short staged fall and slide, retaining every articulated joint and scale. */
export function createCrashAnimation(bike: CrashBike, options: CrashOptions) {
  if (bike.captureRagdollPose && bike.applyRagdollPose)
    return createPhysicalCrash(bike, options);
  const duration = crashDuration(options.cause, options.reducedMotion);
  options.impactObstacle?.updateWorldMatrix(true, true);
  const impactBounds = options.impactObstacle
    ? solidObstacleBounds(options.impactObstacle)
    : undefined;
  const chassis = contacts(bike.body, bike.rider);
  const initialRoot = bike.root.position.clone();
  const initialRoll = bike.root.rotation.z;
  const motion = crashMotion(options, initialRoll);
  const { side } = motion;
  const riderAtImpact = contacts(bike.rider);
  // Cache a conservative support envelope for both the riding and thrown
  // poses. This avoids scanning the full skinned rider every crash frame.
  bike.animateCrashPose?.(1, side, 1, 0.36);
  const riderThrown = contacts(bike.rider);
  bike.animateCrashPose?.(0, side, 1, 0);
  const riderBox = new Box3();
  const riderPoints = [...riderAtImpact.points, ...riderThrown.points];
  riderPoints.forEach((support) => riderBox.expandByPoint(support));
  const rider = {
    points: riderPoints,
    center: riderBox.getCenter(new Vector3()),
  };
  const initialRiderRotation = bike.rider.getWorldQuaternion(new Quaternion());
  const riderScale = bike.rider.getWorldScale(new Vector3());
  const initialPivot = bike.rider.localToWorld(rider.center.clone());
  const initialYaw = bike.root.rotation.y;
  const riderRotation = new Quaternion(),
    bodyRotation = new Quaternion();
  const finalRiderRotation = new Quaternion().setFromAxisAngle(
    new Vector3(0, 0, 1),
    -side * 1.48,
  );
  finalRiderRotation.premultiply(
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), side * 0.22),
  );
  const pivot = new Vector3(),
    origin = new Vector3(),
    point = new Vector3();
  const inverseBody = new Matrix4(),
    riderMatrix = new Matrix4();
  const bodyBounds = new Box3(),
    riderBounds = new Box3();
  const focus = new Vector3();
  let elapsed = 0;
  let finalGroundSettled = false;

  function advance(dt: number, active: boolean) {
    if (active && Number.isFinite(dt))
      elapsed = Math.min(duration, elapsed + Math.max(0, Math.min(dt, 0.1)));
    if (duration === 0) return true;
    if (finalGroundSettled) return elapsed >= duration;
    const fall = options.reducedMotion ? 1 : smooth(elapsed / motion.fallTime);
    bike.animateCrashPose?.(
      fall,
      side,
      options.reducedMotion ? 1 : active ? dt : 0,
      options.reducedMotion ? 1.2 : elapsed,
    );
    const slide = options.reducedMotion
      ? 1
      : 1 - (1 - Math.min(1, elapsed / duration)) ** 3;
    bike.root.position.set(
      initialRoot.x + motion.lateralSlide * slide,
      initialRoot.y * (1 - fall),
      initialRoot.z - motion.forwardSlide * slide,
    );
    bike.root.rotation.z = initialRoll + (-side * 1.46 - initialRoll) * fall;
    bike.root.rotation.y = initialYaw + side * 0.11 * fall;
    bike.animateSuspension(
      options.pitch * (1 - fall),
      options.travel * (1 - fall),
    );
    bike.body.updateWorldMatrix(true, false);
    bodyBounds.makeEmpty();
    for (const corner of chassis.points)
      bodyBounds.expandByPoint(
        point.copy(corner).applyMatrix4(bike.body.matrixWorld),
      );
    const groundLift = Math.max(0, 0.025 - bodyBounds.min.y);
    bike.root.position.y += groundLift;
    bodyBounds.min.y += groundLift;
    bodyBounds.max.y += groundLift;
    bike.body.updateWorldMatrix(true, false);

    // Traffic stays at its impact point. Let the bike travel into the contact,
    // then keep its chassis on the rider's side of that vehicle.
    if (impactBounds) {
      const blockedByVehicle = bodyBounds.intersectsBox(impactBounds);
      if (blockedByVehicle) {
        shiftWorldZ(bike.root, impactBounds.max.z - bodyBounds.min.z + 0.025);
        bike.body.updateWorldMatrix(true, false);
        bodyBounds.makeEmpty();
        for (const corner of chassis.points)
          bodyBounds.expandByPoint(
            point.copy(corner).applyMatrix4(bike.body.matrixWorld),
          );
      }
    }

    riderRotation.slerpQuaternions(
      initialRiderRotation,
      finalRiderRotation,
      fall,
    );
    pivot.set(
      initialPivot.x + side * 1.5 * slide,
      initialPivot.y * (1 - fall) + 0.27 * fall,
      initialPivot.z - 2.15 * slide,
    );
    origin
      .copy(rider.center)
      .multiply(riderScale)
      .applyQuaternion(riderRotation);
    origin.subVectors(pivot, origin);
    riderMatrix.compose(origin, riderRotation, riderScale);
    riderBounds.makeEmpty();
    for (const corner of rider.points)
      riderBounds.expandByPoint(point.copy(corner).applyMatrix4(riderMatrix));
    const riderLift = Math.max(0, 0.035 - riderBounds.min.y);
    origin.y += riderLift;
    riderBounds.min.y += riderLift;
    riderBounds.max.y += riderLift;
    if (impactBounds && riderBounds.intersectsBox(impactBounds)) {
      const separation = impactBounds.max.z - riderBounds.min.z + 0.035;
      origin.z += separation;
      riderBounds.min.z += separation;
      riderBounds.max.z += separation;
    }
    inverseBody.copy(bike.body.matrixWorld).invert();
    bike.rider.position.copy(origin).applyMatrix4(inverseBody);
    bike.body.getWorldQuaternion(bodyRotation).invert();
    bike.rider.quaternion.copy(bodyRotation).multiply(riderRotation);
    // Only the rider's outer transform moves; no bone, mesh or scale is changed.
    focus
      .copy(bodyBounds.min)
      .add(bodyBounds.max)
      .add(riderBounds.min)
      .add(riderBounds.max)
      .multiplyScalar(0.25);
    if (
      active &&
      (elapsed >= duration || options.reducedMotion) &&
      !finalGroundSettled
    ) {
      const chassisCorrection = settleChassisContact(bike);
      bodyBounds.translate(new Vector3(0, chassisCorrection, 0));
      focus.y += chassisCorrection * 0.5;
      const finalSupport = contacts(bike.rider).points;
      let minimumY = Infinity;
      for (const support of finalSupport)
        minimumY = Math.min(
          minimumY,
          support.applyMatrix4(bike.rider.matrixWorld).y,
        );
      const correction = 0.0355 - minimumY;
      if (Math.abs(correction) > 1e-6 && bike.rider.parent) {
        const parent = bike.rider.parent;
        const localOrigin = parent.worldToLocal(new Vector3(0, 0, 0));
        const localTarget = parent.worldToLocal(new Vector3(0, correction, 0));
        bike.rider.position.add(localTarget.sub(localOrigin));
        focus.y += correction * 0.5;
      }
      finalGroundSettled = true;
    }
    return elapsed >= duration;
  }

  return {
    duration,
    focus,
    get elapsed() {
      return elapsed;
    },
    get cameraBlend() {
      return options.reducedMotion ? 1 : smooth(elapsed / 0.55);
    },
    advance,
  };
}
