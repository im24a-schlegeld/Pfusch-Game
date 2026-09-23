import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import type { LimbPose } from './riderMotion';
import { solveJoint, type Point } from './riderSkeleton';

export interface RagdollPose {
  hip: Point;
  shoulder: Point;
  head: Point;
  /** Torso orientation in the same coordinate space as the joint positions. */
  orientation: [number, number, number, number];
  limbs: Array<{ arm: LimbPose; leg: LimbPose }>;
}

interface Particle {
  position: Vector3;
  previous: Vector3;
  radius: number;
  inverseMass: number;
  upwardLimit: number;
}

interface Bone {
  start: number;
  joint: number;
  end: number;
  upper: number;
  lower: number;
}

const STEP = 1 / 120;
const GROUND = 0.035;
const tuple = (value: Vector3) => value.toArray() as Point;

/**
 * A small fixed-step position-based ragdoll. Seven shape-matched torso points
 * carry eight independently moving limb joints. Its output always reconstructs
 * the original two-bone lengths; collisions never resize the rider.
 */
export function createRagdoll(
  initial: RagdollPose,
  options: {
    obstacles?: readonly Box3[];
    velocity?: Point;
    angularVelocity?: Point;
    scale?: number;
  } = {},
) {
  const scale = options.scale ?? 1;
  const obstacles = (options.obstacles ?? []).map((box) => box.clone());
  const particles: Particle[] = [];
  const bones: Bone[] = [];
  const orientation = new Quaternion(...initial.orientation).normalize();
  const inverseOrientation = orientation.clone().invert();
  const hip = new Vector3(...initial.hip);
  const velocity = new Vector3(...(options.velocity ?? [1.3, 0.45, -2.6]));
  const angular = new Vector3(
    ...(options.angularVelocity ?? [-0.65, 0.2, -2.8]),
  );
  const add = (position: Point, radius: number, inverseMass: number) => {
    const point = new Vector3(...position);
    const motion = angular.clone().cross(point.clone().sub(hip)).add(velocity);
    const index = particles.length;
    particles.push({
      position: point,
      previous: point.clone().addScaledVector(motion, -STEP),
      radius: radius * scale,
      inverseMass,
      upwardLimit: Math.max(0.6, Math.min(2, motion.y + 0.5)),
    });
    return index;
  };
  add(initial.hip, 0.15, 0.2);
  add(initial.shoulder, 0.15, 0.2);
  add(initial.head, 0.19, 0.18);
  for (const { arm, leg } of initial.limbs) {
    add(arm.start, 0.095, 0.2);
    add(leg.start, 0.095, 0.2);
  }
  const torsoCount = particles.length;
  const center = new Vector3();
  for (let i = 0; i < torsoCount; i++) center.add(particles[i].position);
  center.divideScalar(torsoCount);
  const rest = particles.map(({ position }) =>
    position.clone().sub(center).applyQuaternion(inverseOrientation),
  );
  initial.limbs.forEach(({ arm, leg }, side) => {
    for (const [limb, start, radius] of [
      [arm, 3 + side * 2, 0.065],
      [leg, 4 + side * 2, 0.09],
    ] as const) {
      const joint = add(limb.joint, radius, 0.85);
      const end = add(limb.end, radius, 1);
      // Different inertia at each joint releases the riding contact naturally.
      particles[end].previous.x -= (side ? 1 : -1) * STEP * 0.55;
      particles[joint].previous.y += STEP * 0.25;
      bones.push({
        start,
        joint,
        end,
        upper: particles[start].position.distanceTo(particles[joint].position),
        lower: particles[joint].position.distanceTo(particles[end].position),
      });
    }
  });

  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3();
  const delta = new Vector3(),
    normal = new Vector3(),
    nearest = new Vector3();
  const matrix = new Matrix4(),
    turn = new Quaternion();
  const columns = [new Vector3(), new Vector3(), new Vector3()];
  const covariance = [new Vector3(), new Vector3(), new Vector3()];
  let accumulator = 0;
  let elapsed = 0;

  function rigidTorso() {
    center.set(0, 0, 0);
    for (let i = 0; i < torsoCount; i++) center.add(particles[i].position);
    center.divideScalar(torsoCount);
    covariance.forEach((column) => column.set(0, 0, 0));
    for (let i = 0; i < torsoCount; i++) {
      delta.subVectors(particles[i].position, center);
      covariance[0].addScaledVector(delta, rest[i].x);
      covariance[1].addScaledVector(delta, rest[i].y);
      covariance[2].addScaledVector(delta, rest[i].z);
    }
    // Stable polar decomposition retains rotation while making the whole torso
    // rigid. Contacts at a shoulder or hip consequently rotate the torso.
    for (let iteration = 0; iteration < 5; iteration++) {
      matrix.makeRotationFromQuaternion(orientation);
      columns.forEach((column, index) =>
        column.setFromMatrixColumn(matrix, index),
      );
      a.set(0, 0, 0);
      let denominator = 1e-9;
      for (let index = 0; index < 3; index++) {
        a.add(b.crossVectors(columns[index], covariance[index]));
        denominator += columns[index].dot(covariance[index]);
      }
      a.divideScalar(Math.abs(denominator));
      const angle = a.length();
      if (angle < 1e-9) break;
      turn.setFromAxisAngle(a.divideScalar(angle), Math.min(angle, 0.35));
      orientation.premultiply(turn).normalize();
    }
    for (let i = 0; i < torsoCount; i++)
      particles[i].position
        .copy(rest[i])
        .applyQuaternion(orientation)
        .add(center);
  }

  function distance(first: number, second: number, length: number) {
    const p = particles[first],
      q = particles[second];
    delta.subVectors(q.position, p.position);
    const actual = delta.length();
    if (actual < 1e-9) return;
    delta.multiplyScalar(
      (actual - length) / (actual * (p.inverseMass + q.inverseMass)),
    );
    p.position.addScaledVector(delta, p.inverseMass);
    q.position.addScaledVector(delta, -q.inverseMass);
  }

  /** Sphere contact projection, including an interior point's nearest face. */
  function contact(point: Vector3, radius: number, approach?: Vector3) {
    const before = a.copy(point);
    if (point.y < GROUND + radius) point.y = GROUND + radius;
    for (const box of obstacles) {
      nearest.copy(point).clamp(box.min, box.max);
      normal.subVectors(point, nearest);
      const length = normal.length();
      if (length >= radius) continue;
      if (length > 1e-8)
        point.addScaledVector(normal, (radius - length) / length);
      else {
        const distances = [
          point.x - box.min.x,
          box.max.x - point.x,
          Infinity,
          // A side/rear collision must resolve against that side. Choosing
          // the roof merely because it is closer launches embedded riders.
          approach && approach.y >= box.max.y ? box.max.y - point.y : Infinity,
          point.z - box.min.z,
          box.max.z - point.z,
        ];
        const face = distances.indexOf(Math.min(...distances));
        if (face === 0) point.x = box.min.x - radius;
        else if (face === 1) point.x = box.max.x + radius;
        else if (face === 2) point.y = box.min.y - radius;
        else if (face === 3) point.y = box.max.y + radius;
        else if (face === 4) point.z = box.min.z - radius;
        else point.z = box.max.z + radius;
      }
    }
    return b.subVectors(point, before);
  }

  function contacts() {
    for (const particle of particles) {
      const correction = contact(
        particle.position,
        particle.radius,
        particle.previous,
      );
      // Penetration repair changes position, not momentum. Otherwise even a
      // modest overlap turns into a large upward speed on the next fixed step.
      particle.previous.add(correction);
    }
    // Capsule samples stop the middle of a shin/forearm passing through an edge
    // even when its two joints happen to be outside the vehicle.
    for (const bone of bones) {
      for (const [first, second] of [
        [bone.start, bone.joint],
        [bone.joint, bone.end],
      ]) {
        const p = particles[first],
          q = particles[second];
        for (const weight of [0.25, 0.5, 0.75]) {
          c.copy(p.position).lerp(q.position, weight);
          const correction = contact(c, Math.min(p.radius, q.radius));
          const denominator =
            p.inverseMass * (1 - weight) ** 2 + q.inverseMass * weight ** 2;
          p.position.addScaledVector(
            correction,
            (p.inverseMass * (1 - weight)) / denominator,
          );
          q.position.addScaledVector(
            correction,
            (q.inverseMass * weight) / denominator,
          );
          p.previous.addScaledVector(
            correction,
            (p.inverseMass * (1 - weight)) / denominator,
          );
          q.previous.addScaledVector(
            correction,
            (q.inverseMass * weight) / denominator,
          );
        }
      }
    }
  }

  function exactLimbs() {
    for (const bone of bones) {
      const start = particles[bone.start].position;
      const joint = particles[bone.joint].position;
      const end = particles[bone.end].position;
      delta.subVectors(end, start);
      const reach = Math.max(
        Math.abs(bone.upper - bone.lower) + 1e-5,
        Math.min(bone.upper + bone.lower - 1e-5, delta.length()),
      );
      if (delta.lengthSq() < 1e-10) delta.set(0, -1, 0);
      end.copy(delta.setLength(reach).add(start));
      joint.set(
        ...solveJoint(
          tuple(start),
          tuple(end),
          bone.upper,
          bone.lower,
          tuple(a.subVectors(joint, start)),
        ),
      );
    }
  }

  function step() {
    const damping = Math.exp(-0.45 * STEP);
    for (const particle of particles) {
      delta
        .subVectors(particle.position, particle.previous)
        .multiplyScalar(damping);
      particle.previous.copy(particle.position);
      particle.position.add(delta);
      particle.position.y -= 9.81 * STEP * STEP;
    }
    for (let iteration = 0; iteration < 14; iteration++) {
      rigidTorso();
      for (const bone of bones) {
        distance(bone.start, bone.joint, bone.upper);
        distance(bone.joint, bone.end, bone.lower);
      }
      contacts();
    }
    rigidTorso();
    exactLimbs();
    // Contact friction consumes tangential energy. Incoming normal velocity is
    // reflected slightly, so a rider hits a bonnet instead of tunnelling in.
    for (const particle of particles) {
      delta.subVectors(particle.position, particle.previous);
      // Joint constraints can transfer impact energy but may not create an
      // upward blast. Keep a small physical rebound and bound extreme overlaps.
      delta.y = Math.min(delta.y, particle.upwardLimit * STEP);
      if (delta.lengthSq() > (12 * STEP) ** 2) delta.setLength(12 * STEP);
      const groundContact =
        particle.position.y < GROUND + particle.radius + 0.012;
      let touching = groundContact;
      normal.set(0, 1, 0);
      for (const box of obstacles) {
        nearest.copy(particle.position).clamp(box.min, box.max);
        c.subVectors(particle.position, nearest);
        if (c.lengthSq() < (particle.radius + 0.012) ** 2) {
          touching = true;
          if (c.lengthSq() > 1e-10) normal.copy(c).normalize();
        }
      }
      if (touching) {
        const incoming = delta.dot(normal);
        if (incoming < 0) delta.addScaledVector(normal, -1.12 * incoming);
        delta.multiplyScalar(0.82);
      }
      particle.previous.copy(particle.position).sub(delta);
    }
    elapsed += STEP;
  }

  function pose(): RagdollPose {
    return {
      hip: tuple(particles[0].position),
      shoulder: tuple(particles[1].position),
      head: tuple(particles[2].position),
      orientation: orientation.toArray(),
      limbs: initial.limbs.map((_, side) => {
        const limb = (bone: Bone): LimbPose => ({
          start: tuple(particles[bone.start].position),
          joint: tuple(particles[bone.joint].position),
          end: tuple(particles[bone.end].position),
        });
        return { arm: limb(bones[side * 2]), leg: limb(bones[side * 2 + 1]) };
      }),
    };
  }

  return {
    get elapsed() {
      return elapsed;
    },
    get particleCount() {
      return particles.length;
    },
    pose,
    advance(dt: number) {
      if (Number.isFinite(dt)) accumulator += Math.max(0, Math.min(0.1, dt));
      while (accumulator + 1e-10 >= STEP) {
        step();
        accumulator -= STEP;
      }
      return pose();
    },
  };
}
