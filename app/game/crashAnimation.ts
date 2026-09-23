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

interface CrashBike {
  root: Object3D;
  body: Object3D;
  rider: Object3D;
  animateSuspension(pitch: number, travel: number): void;
  animateCrashPose?(progress: number, side: number, dt: number): void;
}

export const crashDuration = (cause: string, reducedMotion: boolean) =>
  cause === 'Ride ended' ? 0 : reducedMotion ? 0.18 : 1.2;

const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

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

/** A short staged fall and slide, retaining every articulated joint and scale. */
export function createCrashAnimation(
  bike: CrashBike,
  options: {
    cause: string;
    pitch: number;
    travel: number;
    reducedMotion: boolean;
  },
) {
  const duration = crashDuration(options.cause, options.reducedMotion);
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
  bike.animateCrashPose?.(1, side, 1);
  const riderThrown = contacts(bike.rider);
  bike.animateCrashPose?.(0, side, 1);
  const riderBox = new Box3();
  const riderPoints = [...riderAtImpact.points, ...riderThrown.points];
  riderPoints.forEach((support) => riderBox.expandByPoint(support));
  const rider = { points: riderPoints, center: riderBox.getCenter(new Vector3()) };
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
    const fall = options.reducedMotion ? 1 : smooth(elapsed / 0.68);
    bike.animateCrashPose?.(fall, side, active ? dt : 0);
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
    if (active && elapsed >= duration && !finalGroundSettled) {
      const finalSupport = contacts(bike.rider).points;
      let minimumY = Infinity;
      for (const support of finalSupport)
        minimumY = Math.min(
          minimumY,
          support.applyMatrix4(bike.rider.matrixWorld).y,
        );
      const correction = 0.035 - minimumY;
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
