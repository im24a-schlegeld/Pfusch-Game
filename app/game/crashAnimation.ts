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
}

export const crashDuration = (cause: string, reducedMotion: boolean) =>
  cause === 'Ride ended' ? 0 : reducedMotion ? 0.18 : 1.2;

const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

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

/** Project the chassis to the closest horizontal surface of each obstacle. */
function separateChassis(object: Object3D, bounds: Box3, obstacles: Box3[]) {
  for (let iteration = 0; iteration < 3; iteration++) {
    for (const obstacle of obstacles) {
      if (!bounds.intersectsBox(obstacle)) continue;
      const candidates = [
        new Vector3(obstacle.min.x - bounds.max.x - 0.025, 0, 0),
        new Vector3(obstacle.max.x - bounds.min.x + 0.025, 0, 0),
        new Vector3(0, 0, obstacle.min.z - bounds.max.z - 0.025),
        new Vector3(0, 0, obstacle.max.z - bounds.min.z + 0.025),
      ];
      candidates.sort((a, b) => a.lengthSq() - b.lengthSq());
      shiftWorld(object, candidates[0]);
      bounds.translate(candidates[0]);
    }
  }
}

/** The real rider is skinned by world-space joint physics independently of the sliding bike. */
function createPhysicalCrash(bike: CrashBike, options: CrashOptions) {
  const duration = crashDuration(options.cause, options.reducedMotion);
  const obstacles = [
    ...new Set([
      ...(options.collisionObstacles ?? []),
      ...(options.impactObstacle ? [options.impactObstacle] : []),
    ]),
  ].map((object) => {
    object.updateWorldMatrix(true, true);
    return new Box3().setFromObject(object);
  });
  const chassis = contacts(bike.body, bike.rider);
  const initialRoot = bike.root.position.clone();
  const initialRoll = bike.root.rotation.z,
    initialYaw = bike.root.rotation.y;
  const side =
    !bike.rider.getObjectByName('carried-cap') && initialRoll > 0.025 ? -1 : 1;
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
  const speed = Math.max(0, Math.min(40, options.impactSpeed ?? 14));
  const ragdoll = createRagdoll(initialPose, {
    obstacles,
    scale: riderScale.x,
    velocity: [side * 1.4, 0.35, -Math.min(4.3, 1.5 + speed * 0.07)],
    angularVelocity: [-0.7, side * 0.2, -side * 2.85],
  });
  const bodyBounds = new Box3(),
    riderBounds = new Box3();
  const point = new Vector3(),
    focus = new Vector3();
  let elapsed = 0,
    initialized = false,
    settled = false;

  function bodyPose(time: number) {
    const fall = smooth(time / 0.68);
    const slide = 1 - (1 - Math.min(1, time / 1.2)) ** 3;
    bike.root.position.set(
      initialRoot.x + side * 0.45 * slide,
      initialRoot.y * (1 - fall),
      initialRoot.z - 1.25 * slide,
    );
    bike.root.rotation.z = initialRoll + (-side * 1.46 - initialRoll) * fall;
    bike.root.rotation.y = initialYaw + side * 0.16 * fall;
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
    separateChassis(bike.root, bodyBounds, obstacles);
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
    separateChassis(bike.rider, riderBounds, obstacles);
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
    ? new Box3().setFromObject(options.impactObstacle)
    : undefined;
  const chassis = contacts(bike.body, bike.rider);
  const initialRoot = bike.root.position.clone();
  const initialRoll = bike.root.rotation.z;
  // Keep the left hip's hanging cap on the upper side of this staged fall, so
  // gravity can keep acting on it without pushing its brim through the road.
  const cap = bike.rider.getObjectByName('carried-cap');
  const side = !cap && initialRoll > 0.025 ? -1 : 1;
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
    const fall = options.reducedMotion ? 1 : smooth(elapsed / 0.68);
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
      initialRoot.x + side * 0.45 * slide,
      initialRoot.y * (1 - fall),
      initialRoot.z - 1.25 * slide,
    );
    bike.root.rotation.z = initialRoll + (-side * 1.46 - initialRoll) * fall;
    bike.root.rotation.y = initialYaw + side * 0.16 * fall;
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
