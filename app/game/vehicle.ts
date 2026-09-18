import * as THREE from 'three';
import { addSupermotoRearProtection } from './supermotoRearProtection';
import type { Player, Product } from '../domain/types';
import {
  garmentMaterial,
  sleeveMaterial,
  accessoryMaterial,
  fabricMaterial,
} from './garmentTexture';
import {
  BIKE_CONTACTS,
  POSES,
  RIDER_DIMENSIONS,
  type RiderPose,
} from './riderSkeleton';
import { BIKE_MODEL_SCALES } from './vehicleScale';
import { riderMotionPose, type RiderMotion } from './riderMotion';
import { skinLimb } from './limbSkin';
import { torsoDrape, sleeveFolds } from './clothShape';
import {
  addGarmentPockets,
  addWindbreakerDetails,
  addGarmentZip,
  foldGarmentHem,
  sleeveSeams,
} from './garmentDetails';
import { applyRibbedTrim } from './garmentTrim';
import {
  SPORT_GEOMETRY,
  sportTireGeometry,
  roadTireGeometry,
} from './sportGeometry';
import {
  brakeRotorGeometry,
  makeDrive,
  makeBeltDrive,
  CHAIN_DRIVE,
} from './driveGeometry';
import { suspensionPose } from './bikeMotion';
import { makeSportBodywork } from './sportBodywork';
import { motorcycleRim } from './wheelDetails';
import { makeScooter } from './scooterGeometry';
import { createMotocrossHelmet } from './motocrossHelmet';
import {
  createCarriedCapMotion,
  type CarriedCapMotionInput,
} from './carriedCapMotion';
import { SUPERMOTO_SHROUD, SUPERMOTO_SIDE_COVER, SUPERMOTO_TAIL_FENDER } from './supermotoFit';
import { addSupermotoFootpeg } from './supermotoFootpegs';
import { addCleanCrossbody, addIgnitionKey, updateCrossbodyMotion } from './vehicleAccessories';
import { finishSupermotoSuspension } from './v39SuspensionFinish';
import { fitRearExitExhaust, finishWheelColors, fairShoulder, blackSprings, darkenWardrobe, tiltHandlebarBack } from './v40ModelFinish';

type Point = [number, number, number];
type Ring = [number, number, number, number]; // axis coordinate, half width, half depth, center offset
const V = (p: Point) => new THREE.Vector3(...p);
function material(color: string, metalness = 0, roughness = 0.68) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness });
}
function mesh(
  parent: THREE.Object3D,
  g: THREE.BufferGeometry,
  m: THREE.Material,
) {
  g.computeVertexNormals();
  const o = new THREE.Mesh(g, m);
  o.castShadow = true;
  o.receiveShadow = true;
  parent.add(o);
  return o;
}
/** Shaped cross sections with smooth normals. Used for tailored fabric and bodywork. */
function loft(
  parent: THREE.Object3D,
  rings: Ring[],
  color: THREE.Material,
  axis: 'y' | 'z' = 'y',
  segments = 24,
) {
  if (rings.length > 2) {
    const profile = new THREE.CatmullRomCurve3(
      rings.map((r) => new THREE.Vector3(r[0], r[1], r[2])),
      false,
      'catmullrom',
      0.25,
    );
    const centers = new THREE.CatmullRomCurve3(
      rings.map((r) => new THREE.Vector3(r[0], r[3], 0)),
      false,
      'catmullrom',
      0.25,
    );
    const steps = (rings.length - 1) * 4;
    rings = Array.from({ length: steps + 1 }, (_, i) => {
      const p = profile.getPoint(i / steps),
        c = centers.getPoint(i / steps);
      return [p.x, Math.max(0.002, p.y), Math.max(0.002, p.z), c.y] as Ring;
    });
  }
  const uvs: number[] = [];
  const vertices: number[] = [],
    indices: number[] = [];
  for (const [a, w, d, offset] of rings)
    for (let j = 0; j <= segments; j++) {
      const t = (j / segments) * Math.PI * 2 - Math.PI / 2;
      const x = Math.sin(t) * w,
        b = Math.cos(t) * d;
      vertices.push(
        x,
        axis === 'y' ? a : b + offset,
        axis === 'y' ? b + offset : a,
      );
      uvs.push(
        j / segments,
        (a - rings[0][0]) / (rings[rings.length - 1][0] - rings[0][0]),
      );
    }
  for (let r = 0; r < rings.length - 1; r++)
    for (let j = 0; j < segments; j++) {
      const a = r * (segments + 1) + j,
        b = a + segments + 1;
      if (axis === 'y') indices.push(a, a + 1, b, b, a + 1, b + 1);
      else indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  for (const [r, reverse] of [
    [0, axis === 'y'],
    [rings.length - 1, axis !== 'y'],
  ] as const) {
    const first = r * (segments + 1);
    for (let j = 1; j < segments - 1; j++)
      indices.push(
        first,
        first + (reverse ? j + 1 : j),
        first + (reverse ? j : j + 1),
      );
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  return mesh(parent, g, color);
}
function tube(
  parent: THREE.Object3D,
  points: Point[],
  radii: number[],
  m: THREE.Material,
  segments = 20,
  sides = 12,
  flatten = 1,
  outside = 0,
) {
  const curve = new THREE.CatmullRomCurve3(points.map(V));
  const frames = curve.computeFrenetFrames(segments, false);
  const uvs: number[] = [];
  const vertices: number[] = [],
    indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments,
      p = curve.getPointAt(t);
    const scaled = t * (radii.length - 1),
      r = THREE.MathUtils.lerp(
        radii[Math.floor(scaled)],
        radii[Math.min(radii.length - 1, Math.ceil(scaled))],
        scaled % 1,
      );
    for (let j = 0; j <= sides; j++) {
      const angle = (j / sides - 0.5) * Math.PI * 2;
      let normal = frames.normals[i],
        binormal = frames.binormals[i];
      if (outside) {
        const tangent = frames.tangents[i];
        normal = new THREE.Vector3(outside, 0, 0)
          .addScaledVector(tangent, -outside * tangent.x)
          .normalize();
        binormal = new THREE.Vector3()
          .crossVectors(tangent, normal)
          .normalize();
      }
      const point = p
        .clone()
        .addScaledVector(normal, Math.cos(angle) * r)
        .addScaledVector(binormal, Math.sin(angle) * r * flatten);
      vertices.push(point.x, point.y, point.z);
      uvs.push(j / sides, 1 - t);
    }
  }
  for (let i = 0; i < segments; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j,
        b = a + sides + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  return mesh(parent, g, m);
}
function rod(
  parent: THREE.Object3D,
  a: Point,
  b: Point,
  r: number,
  m: THREE.Material,
) {
  const direction = V(b).sub(V(a));
  const o = mesh(
    parent,
    new THREE.CylinderGeometry(r, r, direction.length(), 16),
    m,
  );
  o.position.copy(V(a).add(V(b)).multiplyScalar(0.5));
  o.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
  return o;
}
function oval(
  parent: THREE.Object3D,
  pos: Point,
  scale: Point,
  m: THREE.Material,
) {
  const o = mesh(parent, new THREE.SphereGeometry(1, 24, 16), m);
  o.position.set(...pos);
  o.scale.set(...scale);
  return o;
}
/** Thin shaped bodywork with real edge thickness, triangulated in its side elevation. */
function sidePanel(
  parent: THREE.Object3D,
  side: number,
  outline: Point[],
  m: THREE.Material,
  thickness = 0.012,
) {
  const triangles = THREE.ShapeUtils.triangulateShape(
    outline.map((p) => new THREE.Vector2(p[2], p[1])),
    [],
  );
  const vertices: number[] = [],
    indices: number[] = [];
  for (const layer of [-1, 1])
    for (const p of outline)
      vertices.push(side * (p[0] + (layer * thickness) / 2), p[1], p[2]);
  const n = outline.length;
  for (const [a, b, c] of triangles) indices.push(a, b, c, a + n, c + n, b + n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(i, j, i + n, j, j + n, i + n);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setIndex(indices);
  const finish = m.clone();
  finish.side = THREE.DoubleSide;
  return mesh(parent, g, finish);
}
function makeFender(
  parent: THREE.Object3D,
  tireRadius: number,
  z: number,
  m: THREE.MeshStandardMaterial,
) {
  const positions: number[] = [],
    indices: number[] = [];
  const arc = 40,
    across = 8;
  // Every point lies at least 0.038 m outside the tire's circumscribed radius.
  const clearance = 0.038,
    thickness = 0.008;
  for (let layer = 0; layer < 2; layer++)
    for (let i = 0; i <= arc; i++)
      for (let j = 0; j <= across; j++) {
        const angle = -1.03 + (i / arc) * 2.28;
        const x = (j / across - 0.5) * 0.102;
        const r =
          tireRadius +
          clearance +
          layer * thickness +
          (1 - (x / 0.051) ** 2) * 0.005;
        positions.push(
          x,
          tireRadius + Math.cos(angle) * r,
          z + Math.sin(angle) * r,
        );
      }
  const stride = (arc + 1) * (across + 1);
  for (let layer = 0; layer < 2; layer++)
    for (let i = 0; i < arc; i++)
      for (let j = 0; j < across; j++) {
        const a = layer * stride + i * (across + 1) + j,
          b = a + across + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
  for (let i = 0; i < arc; i++)
    for (const j of [0, across]) {
      const a = i * (across + 1) + j,
        b = a + across + 1;
      indices.push(a, b, a + stride, b, b + stride, a + stride);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  const finish = m.clone();
  finish.side = THREE.DoubleSide;
  const fender = mesh(parent, geometry, finish);
  fender.name = 'moped-mudguard';
  fender.userData.tireClearance = clearance;
  for (const side of [-1, 1])
    rod(
      parent,
      [side * 0.068, tireRadius, z],
      [side * 0.053, tireRadius + 0.29, z + 0.1],
      0.006,
      m,
    );
}
/** Wheel-concentric shell: the old flattened tube crossed through the tire at its front tip. */
function makeSportFender(
  parent: THREE.Object3D,
  radius: number,
  z: number,
  paint: THREE.MeshStandardMaterial,
) {
  const positions: number[] = [],
    indices: number[] = [];
  const arcs = 48,
    across = 12,
    stride = (arcs + 1) * (across + 1);
  for (let layer = 0; layer < 2; layer++)
    for (let i = 0; i <= arcs; i++)
      for (let j = 0; j <= across; j++) {
        const t = i / arcs,
          u = (j / across) * 2 - 1,
          angle = -0.55 + t * 1.72;
        const r = radius + 0.015 + 0.008 * (1 - u * u) + layer * 0.005;
        positions.push(
          u * 0.076 * (0.7 + 0.3 * Math.sin(Math.PI * t)),
          radius + Math.cos(angle) * r,
          z + Math.sin(angle) * r,
        );
      }
  for (let layer = 0; layer < 2; layer++)
    for (let i = 0; i < arcs; i++)
      for (let j = 0; j < across; j++) {
        const a = layer * stride + i * (across + 1) + j,
          b = a + across + 1;
        if (layer) indices.push(a, a + 1, b, b, a + 1, b + 1);
        else indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
  for (let i = 0; i < arcs; i++)
    for (const j of [0, across]) {
      const a = i * (across + 1) + j,
        b = a + across + 1;
      indices.push(a, a + stride, b, b, a + stride, b + stride);
    }
  for (const i of [0, arcs])
    for (let j = 0; j < across; j++) {
      const a = i * (across + 1) + j;
      indices.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  const finish = paint.clone();
  finish.side = THREE.DoubleSide;
  const fender = mesh(parent, geometry, finish);
  fender.name = 'sport-front-fender';
  fender.userData.tireClearance = 0.015;
  for (const side of [-1, 1])
    sidePanel(
      parent,
      side,
      [
        [0.076, radius + 0.302, z - 0.012],
        [0.079, radius + 0.279, z + 0.109],
        [0.106, radius + 0.13, z + 0.062],
        [0.106, radius + 0.132, z + 0.012],
      ],
      paint,
      0.006,
    ).name = 'fender-fork-cheek';
}
function makeHelmet(
  parent: THREE.Object3D,
  center: Point,
  style: Player['helmet'],
  color: string,
) {
  if (style === 'motocross') {
    const helmet = createMotocrossHelmet(color);
    helmet.position.set(...center);
    helmet.scale.setScalar(1.065);
    helmet.rotation.x = -0.07;
    parent.add(helmet);
    return helmet;
  }
  const shell = material(color, 0.14, 0.31),
    glass = material('#122027', 0.44, 0.14),
    trim = material('#202727', 0.1, 0.65);
  const profile = new THREE.CatmullRomCurve3(
    [
      [-0.145, 0.079, 0.128],
      [-0.115, 0.101, 0.173],
      [-0.067, 0.12, 0.164],
      [0, 0.127, 0.143],
      [0.055, 0.123, 0.145],
      [0.11, 0.1, 0.103],
      [0.144, 0.052, 0.054],
      [0.154, 0.003, 0.004],
    ].map((p) => new THREE.Vector3(...p)),
    false,
    'catmullrom',
    0.35,
  );
  const positions: number[] = [],
    groups: number[][] = [[], [], []];
  const levels = 112;
  // Align mesh rows with the visor outline itself. More grid cells alone leave
  // stair-stepped material boundaries when the curved outline crosses rows.
  const angles = [
    ...Array.from({ length: 161 }, (_, j) => (j / 160) * Math.PI * 2),
    Math.PI - 1.74,
    Math.PI - 1.68,
    Math.PI + 1.68,
    Math.PI + 1.74,
  ].sort((a, b) => a - b);
  const sides = angles.length - 1;
  const samples = profile.getPoints(256);
  const rearProfile = new THREE.SplineCurve([
    new THREE.Vector2(-0.145, 0.102),
    new THREE.Vector2(-0.12, 0.13),
    new THREE.Vector2(-0.07, 0.146),
    new THREE.Vector2(0, 0.153),
    new THREE.Vector2(0.06, 0.14),
    new THREE.Vector2(0.11, 0.105),
    new THREE.Vector2(0.144, 0.05),
    new THREE.Vector2(0.154, 0.004),
  ]).getPoints(256);
  const rearDepth = (y: number) => {
    let lo = 0,
      hi = rearProfile.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (rearProfile[mid].x < y) lo = mid;
      else hi = mid;
    }
    return THREE.MathUtils.lerp(
      rearProfile[lo].y,
      rearProfile[hi].y,
      (y - rearProfile[lo].x) / (rearProfile[hi].x - rearProfile[lo].x),
    );
  };
  const atHeight = (y: number) => {
    let lo = 0,
      hi = samples.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].x < y) lo = mid;
      else hi = mid;
    }
    return samples[lo]
      .clone()
      .lerp(samples[hi], (y - samples[lo].x) / (samples[hi].x - samples[lo].x));
  };
  for (let i = 0; i <= levels; i++) {
    for (let j = 0; j <= sides; j++) {
      const a = angles[j],
        front = Math.cos(a) < 0;
      const theta = Math.abs(a - Math.PI);
      const corner = THREE.MathUtils.smoothstep(theta, 1, 1.74);
      const lower = -0.049 + corner * 0.017,
        upper = 0.045 - corner * 0.012;
      const y =
        i <= 28
          ? THREE.MathUtils.lerp(-0.145, lower - 0.006, i / 28)
          : i <= 31
            ? THREE.MathUtils.lerp(lower - 0.006, lower, (i - 28) / 3)
            : i <= 66
              ? THREE.MathUtils.lerp(lower, upper, (i - 31) / 35)
              : i <= 69
                ? THREE.MathUtils.lerp(upper, upper + 0.006, (i - 66) / 3)
                : THREE.MathUtils.lerp(upper + 0.006, 0.154, (i - 69) / 43);
      const p = atHeight(y);
      // The shell profile dipped inward between chin and brow. Give the visor
      // its own shallow convex section: only 2.5 mm outside the edge chord.
      const visorT = THREE.MathUtils.clamp(
        (p.x - lower) / (upper - lower),
        0,
        1,
      );
      const visorDepth =
        THREE.MathUtils.lerp(atHeight(lower).z, atHeight(upper).z, visorT) +
        0.0025 * 4 * visorT * (1 - visorT);
      const depth = front
        ? i >= 31 && i <= 66
          ? visorDepth
          : p.z
        : rearDepth(p.x);
      positions.push(
        Math.sin(a) * p.y,
        p.x,
        Math.cos(a) * depth + (front ? -0.005 : 0.006),
      );
    }
  }
  for (let i = 0; i < levels; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j,
        b = a + sides + 1,
        y = (positions[a * 3 + 1] + positions[b * 3 + 1]) * 0.5;
      const theta = Math.abs((angles[j] + angles[j + 1]) / 2 - Math.PI);
      let group = 0;
      if (theta < 1.74 && i >= 28 && i < 69)
        group = theta < 1.68 && i >= 31 && i < 66 ? 1 : 2;
      if (theta < 0.4 && y > -0.116 && y < -0.098) group = 2;
      if (theta > 0.65 && theta < 1.05 && y > -0.1 && y < -0.087) group = 2;
      if (theta > 0.23 && theta < 0.42 && y > 0.074 && y < 0.086) group = 2;
      if (y < -0.134) group = 2;
      groups[group].push(a, a + 1, b, b, a + 1, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const indices: number[] = [];
  for (let i = 0; i < groups.length; i++) {
    g.addGroup(indices.length, groups[i].length, i);
    indices.push(...groups[i]);
  }
  g.setIndex(indices);
  g.computeVertexNormals();
  const helmet = new THREE.Mesh(g, [shell, glass, trim]);
  helmet.position.set(...center);
  helmet.scale.setScalar(1.065);
  helmet.rotation.x = -0.07;
  helmet.name = 'full-face-helmet';
  helmet.userData.helmetStyle = style;
  helmet.castShadow = true;
  helmet.receiveShadow = true;
  parent.add(helmet);
  return helmet;
}
export function makeBike(player: Player, products: Product[]) {
  if (player.bike === 'scooter') {
    const scooter = makeScooter(player, products, makeRider);
    const key = addIgnitionKey(scooter.body, player, products, BIKE_CONTACTS.scooter.grip);
    return { ...scooter, animateAccessories(input: CarriedCapMotionInput, dt: number) {
      scooter.animateAccessories(input, dt); key?.update(input, dt);
    }};
  }
  const root = new THREE.Group();
  root.scale.setScalar(1.45);
  const body = new THREE.Group();
  root.add(body);
  const frontAssembly = new THREE.Group();
  frontAssembly.name = 'front-suspension-axle';
  body.add(frontAssembly);
  const bikeId = player.bike as keyof typeof POSES;
  const pose = BIKE_CONTACTS[bikeId] ?? BIKE_CONTACTS['125'];
  const riderPose = POSES[bikeId] ?? POSES['125'];
  const modelScale = BIKE_MODEL_SCALES[bikeId] ?? 1;
  const rubber = material('#111719', 0, 0.97),
    alloy = material('#a3abad', 0.82, 0.28),
    dark = material('#20282b', 0.55, 0.44),
    seat = material('#171c20', 0, 0.9),
    paint = material(player.paint, 0.18, 0.32),
    rim = material(player.rims, 0.7, 0.35),
    engine = material('#596265', 0.75, 0.46);
  const moped = player.bike === '125',
    sport = player.bike === '701';
  const supermotoWheelScale = 1.05;
  const rear = moped ? 0.55 : sport ? SPORT_GEOMETRY.rearAxle : 0.76,
    front = moped ? -0.7 : sport ? SPORT_GEOMETRY.frontAxle : -0.77,
    radius = moped
      ? 0.305
      : sport
        ? SPORT_GEOMETRY.frontRadius
        : 0.2999 * supermotoWheelScale,
    rearRadius = moped
      ? radius
      : sport
        ? SPORT_GEOMETRY.rearRadius
        : 0.3119 * supermotoWheelScale;
  const wheels: THREE.Group[] = [];
  for (const [i, z] of [front, rear].entries()) {
    const wheel = new THREE.Group();
    wheel.name = i === 0 ? 'front-wheel' : 'rear-wheel';
    wheel.position.set(0, i === 0 ? radius : rearRadius, z);
    (i === 0 ? frontAssembly : body).add(wheel);
    wheels.push(wheel);
    const width = moped
      ? 0.034
      : sport
        ? i === 1
          ? 0.077
          : 0.056
        : i === 1
          ? 0.063
          : 0.05;
    const tire = mesh(
      wheel,
      sport
        ? sportTireGeometry(i === 1)
        : moped
          ? new THREE.TorusGeometry(radius - width, width, 12, 48)
          : roadTireGeometry(
              i === 0 ? radius : rearRadius,
              i === 0 ? 0.12 : 0.16,
              SPORT_GEOMETRY.rimRadius * supermotoWheelScale,
            ),
      rubber,
    );
    tire.name = 'tire';
    if (moped) tire.rotation.y = Math.PI / 2;
    const rimRadius = moped
      ? radius - width * 1.85
      : SPORT_GEOMETRY.rimRadius * (sport ? 1 : supermotoWheelScale);
    for (const x of moped ? [0] : [-width * 0.81, width * 0.81]) {
      const lip = mesh(
        wheel,
        new THREE.TorusGeometry(
          rimRadius,
          moped ? 0.015 : sport ? 0.011 : 0.014,
          12,
          72,
        ),
        rim,
      );
      lip.rotation.y = Math.PI / 2;
      lip.position.x = x;
    }
    rod(wheel, [-0.06, 0, 0], [0.06, 0, 0], 0.055, dark);
    if (!moped)
      motorcycleRim(wheel, sport, rimRadius, width * 0.81, rim, alloy);
    const spokes = 5;
    for (let k = 0; moped && k < spokes; k++) {
      const a = (k / spokes) * Math.PI * 2;
      rod(
        wheel,
        [0, 0, 0],
        [
          0,
          Math.sin(a) * (rimRadius - 0.006),
          Math.cos(a) * (rimRadius - 0.006),
        ],
        0.014,
        rim,
      );
    }
    if (!moped) {
      const discMaterial = alloy.clone();
      discMaterial.side = THREE.DoubleSide;
      for (const x of i === 0
        ? sport
          ? [-0.085, 0.085]
          : [-0.085]
        : [0.105]) {
        const outer = i === 0 ? (sport ? 0.16 : 0.155) : 0.11;
        const disc = mesh(wheel, brakeRotorGeometry(outer), discMaterial);
        disc.position.x = x;
        for (let bolt = 0; bolt < 6; bolt++) {
          const a = (bolt * Math.PI) / 3;
          rod(
            wheel,
            [x, Math.sin(a) * 0.046, Math.cos(a) * 0.046],
            [
              x,
              Math.sin(a + 0.14) * outer * 0.72,
              Math.cos(a + 0.14) * outer * 0.72,
            ],
            0.009,
            dark,
          );
        }
        oval(
          i === 0 ? frontAssembly : body,
          [x, wheel.position.y + outer * 0.35, z + outer * 0.78],
          [0.024, 0.055, 0.034],
          dark,
        ).name = 'brake-caliper';
        // The caliper is carried by the fork/axle, not by the spinning rotor.
        // Keep the carrier just outboard of the disc and inside the caliper.
        const support = i === 0 ? frontAssembly : body;
        const plateX = Math.abs(x) + 0.009;
        const caliperY = wheel.position.y + outer * 0.35;
        const caliperZ = z + outer * 0.78;
        sidePanel(
          support,
          Math.sign(x),
          [
            [plateX, wheel.position.y - 0.018, z - 0.014],
            [plateX, wheel.position.y + 0.032, z - 0.014],
            [plateX, caliperY + 0.034, caliperZ - 0.006],
            [plateX, caliperY - 0.034, caliperZ + 0.014],
            [plateX, wheel.position.y - 0.019, z + 0.027],
          ],
          dark,
          0.01,
        ).name = 'brake-caliper-carrier';
        for (const dy of [-0.025, 0.025])
          rod(
            support,
            [Math.sign(x) * plateX, caliperY + dy, caliperZ],
            [Math.sign(x) * (plateX + 0.011), caliperY + dy, caliperZ],
            0.0045,
            alloy,
          ).name = 'brake-carrier-bolt';
        if (i === 1)
          rod(
            body,
            [0.14, rearRadius + 0.027, rear - 0.07],
            [plateX, rearRadius + 0.025, rear + 0.039],
            0.011,
            dark,
          ).name = 'rear-brake-torque-link';
      }
    }
  }
  const forkTop: Point = [
    0,
    moped ? 0.94 : sport ? SPORT_GEOMETRY.forkTopY : 1.1,
    moped ? -0.47 : sport ? SPORT_GEOMETRY.forkTopZ : -0.4,
  ];
  // Bearings, stem and both yokes share the existing raked fork axis. The
  // steering assembly must join frame, fork legs and bars rather than leave
  // the bars suspended above two independent fork tubes.
  const forkAxisAt = (y: number): Point => [
    0,
    y,
    THREE.MathUtils.lerp(
      front,
      forkTop[2],
      (y - radius) / (forkTop[1] - radius),
    ),
  ];
  const forkHalfWidth = sport ? 0.105 : 0.08;
  const headBottom = forkAxisAt(forkTop[1] - (moped ? 0.105 : 0.13));
  const headTop = forkAxisAt(forkTop[1] - 0.014);
  rod(
    body,
    headBottom,
    headTop,
    moped ? 0.042 : 0.048,
    moped ? paint : dark,
  ).name = 'steering-head';
  for (const [y, thickness] of [
    [headBottom[1], 0.012],
    [headTop[1], 0.009],
  ]) {
    rod(
      body,
      forkAxisAt(y - thickness / 2),
      forkAxisAt(y + thickness / 2),
      moped ? 0.046 : 0.051,
      alloy,
    ).name = 'steering-head-bearing';
  }
  for (const y of [forkTop[1] - 0.009, forkTop[1] - (moped ? 0.092 : 0.12)]) {
    const axis = forkAxisAt(y);
    rod(
      body,
      [-forkHalfWidth, y, axis[2]],
      [forkHalfWidth, y, axis[2]],
      moped ? 0.019 : 0.023,
      dark,
    ).name = 'fork-yoke';
    for (const s of [-1, 1]) {
      const a = forkAxisAt(y - 0.012),
        b = forkAxisAt(y + 0.012);
      a[0] = b[0] = s * forkHalfWidth;
      rod(body, a, b, moped ? 0.037 : sport ? 0.033 : 0.043, alloy).name =
        'fork-yoke-collar';
    }
  }
  const forkSliders: {
    mesh: THREE.Mesh;
    lower: THREE.Vector3;
    upper: THREE.Vector3;
    length: number;
  }[] = [];
  for (const side of [-1, 1]) {
    const forkX = side * forkHalfWidth;
    const lower = new THREE.Vector3(forkX, radius, front);
    const upper = new THREE.Vector3(forkX, forkTop[1], forkTop[2]);
    const slider = rod(
      body,
      [forkX, radius, front],
      [forkX, forkTop[1], forkTop[2]],
      moped ? 0.032 : 0.025,
      alloy,
    );
    slider.name = 'telescopic-fork-slider';
    forkSliders.push({
      mesh: slider,
      lower,
      upper,
      length: lower.distanceTo(upper),
    });
    if (!moped)
      rod(
        body,
        [
          forkX,
          THREE.MathUtils.lerp(radius, forkTop[1], 0.42),
          THREE.MathUtils.lerp(front, forkTop[2], 0.42),
        ],
        [forkX, forkTop[1], forkTop[2]],
        sport ? 0.028 : 0.038,
        dark,
      );
    if (moped)
      rod(
        body,
        [side * 0.105, rearRadius, rear],
        [side * 0.105, 0.5, 0.04],
        0.028,
        alloy,
      );
  }
  if (moped) {
    rod(
      body,
      forkAxisAt(forkTop[1] - 0.01),
      forkAxisAt(1.009),
      0.021,
      dark,
    ).name = 'handlebar-stem';
    for (const s of [-1, 1]) {
      rod(
        body,
        [s * 0.052, 0.991, -0.453],
        [s * 0.052, 1.014, -0.445],
        0.025,
        alloy,
      ).name = 'handlebar-clamp';
      rod(
        body,
        [s * 0.055, 0.934, forkAxisAt(0.934)[2]],
        [s * 0.066, 0.963, -0.527],
        0.01,
        dark,
      ).name = 'headlamp-bracket';
    }
    tube(
      body,
      [
        [0, 0.33, 0.12],
        [0, 0.42, -0.14],
        [0, 0.89, -0.42],
      ],
      [0.075, 0.082, 0.065],
      paint,
      22,
      20,
      0.62,
    );
    tube(
      body,
      [
        [0, 0.35, 0.15],
        [0, 0.63, 0.23],
        [0, 0.85, 0.25],
      ],
      [0.025, 0.03, 0.034],
      paint,
      16,
      16,
    );
    for (const side of [-1, 1]) {
      const stayX = side < 0 ? -0.108 : 0.085;
      tube(
        body,
        [
          [side * 0.105, rearRadius, rear],
          [stayX, 0.5, 0.61],
          [side * 0.065, 0.64, 0.68],
        ],
        [0.026, 0.026, 0.021],
        dark,
        14,
        16,
      );
    }
    const beltGuard = sidePanel(
      body,
      -1,
      [
        [0.084, 0.34, -0.025],
        [0.087, 0.365, 0.18],
        [0.087, 0.425, 0.48],
        [0.084, 0.435, 0.58],
        [0.084, 0.39, 0.63],
        [0.084, 0.325, 0.48],
        [0.084, 0.285, 0.035],
      ],
      dark,
      0.003,
    );
    beltGuard.name = 'moped-belt-guard';
    oval(body, [0.015, 0.3, 0.03], [0.068, 0.1, 0.145], engine).name =
      'engine-crankcase';
    // The Ciao-style air-cooled cylinder lies ahead of the crankcase. Separate
    // thin cooling fins and a small fan cover read as machinery at Garage scale.
    loft(
      body,
      [
        [-0.245, 0.055, 0.053, 0.307],
        [-0.14, 0.062, 0.061, 0.3],
        [-0.035, 0.055, 0.058, 0.3],
      ],
      engine,
      'z',
      16,
    ).name = 'air-cooled-cylinder';
    for (let i = 0; i < 7; i++) {
      const z = -0.235 + i * 0.019;
      loft(
        body,
        [
          [z, 0.069, 0.066, 0.304],
          [z + 0.005, 0.069, 0.066, 0.304],
        ],
        alloy,
        'z',
        16,
      ).name = 'cylinder-cooling-fin';
    }
    rod(body, [0.072, 0.284, 0.048], [0.089, 0.284, 0.048], 0.052, dark).name =
      'engine-fan-cover';
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      rod(
        body,
        [0.09, 0.284 + Math.sin(a) * 0.019, 0.048 + Math.cos(a) * 0.019],
        [
          0.09,
          0.284 + Math.sin(a + 0.15) * 0.043,
          0.048 + Math.cos(a + 0.15) * 0.043,
        ],
        0.0035,
        engine,
      ).name = 'fan-cover-rib';
    }
    tube(
      body,
      [
        [0.245, 1.25, -0.4],
        [0.13, 1.12, -0.49],
        [0.065, 0.91, -0.53],
        [0.075, 0.49, -0.635],
        [0.072, radius + 0.035, front + 0.035],
      ],
      [0.004, 0.004, 0.004, 0.004, 0.004],
      rubber,
      24,
      8,
    ).name = 'front-brake-cable';
    loft(
      body,
      [
        [0.06, 0.1, 0.025, 0.84],
        [0.16, 0.15, 0.042, 0.85],
        [0.4, 0.15, 0.042, 0.85],
        [0.47, 0.1, 0.025, 0.85],
      ],
      seat,
      'z',
    );
    makeFender(frontAssembly, radius, front, dark);
    makeFender(body, radius, rear, dark);
    tube(
      body,
      [
        [-pose.grip[0], pose.grip[1], pose.grip[2]],
        [-0.2, 1.22, -0.44],
        [-0.12, 1.0, -0.45],
        [0.12, 1.0, -0.45],
        [0.2, 1.22, -0.44],
        [pose.grip[0], pose.grip[1], pose.grip[2]],
      ],
      [0.018, 0.018, 0.018, 0.018, 0.018, 0.018],
      dark,
      32,
      12,
    );
    const lamp = loft(
      body,
      [
        [-0.59, 0.065, 0.04, 0.98],
        [-0.55, 0.087, 0.063, 0.98],
        [-0.49, 0.076, 0.06, 0.98],
      ],
      dark,
      'z',
    );
    lamp.position.y = -0.02;
    oval(
      body,
      [0, 0.967, -0.595],
      [0.066, 0.045, 0.009],
      material('#e7e4b8', 0.05, 0.25),
    );
    for (const s of [-1, 1]) {
      rod(
        body,
        [s * 0.024, 0.67, 0.234],
        [s * 0.065, 0.66, 0.4],
        0.011,
        dark,
      ).name = 'rack-frame-mount';
      rod(body, [s * 0.065, 0.66, 0.36], [s * 0.065, 0.66, 0.85], 0.011, dark);
      rod(body, [s * 0.065, 0.66, 0.85], [s * 0.065, 0.45, 0.68], 0.011, dark);
    }
    for (const z of [0.4, 0.55, 0.7, 0.85])
      rod(body, [-0.065, 0.66, z], [0.065, 0.66, z], 0.009, dark).name =
        'rack-crossbar';
    rod(body, [-0.23, 0.33, 0.12], [0.23, 0.33, 0.12], 0.015, alloy);

    // Visible pedal crank helps the starter vehicle read immediately as a Töffli.
    const crank = mesh(
      body,
      new THREE.TorusGeometry(0.072, 0.009, 8, 32),
      alloy,
    );

    crank.rotation.y = Math.PI / 2;
    crank.position.set(0, 0.33, 0.12);

    for (const s of [-1, 1]) {
      rod(body, [0, 0.33, 0.12], [s * 0.1, 0.33, 0.12], 0.009, alloy);

      rod(body, [s * 0.1, 0.33, 0.12], [s * 0.16, 0.33, 0.12], 0.013, dark);
    }
  } else if (!sport) {
    // Double cradle: steering head -> engine rails -> swingarm pivot, with a separate alloy subframe.
    const subframeFinish = material('#465256', 0.48, 0.52);
    rod(body, forkAxisAt(1.075), [0, 1.124, -0.407], 0.023, alloy).name =
      'handlebar-stem';
    for (const s of [-1, 1])
      rod(
        body,
        [s * 0.075, 1.095, -0.402],
        [s * 0.075, 1.124, -0.407],
        0.025,
        dark,
      ).name = 'handlebar-clamp';
    for (const s of [-1, 1]) {
      tube(
        body,
        [
          [s * 0.018, 1.01, forkAxisAt(1.01)[2] + 0.026],
          [s * 0.13, 0.82, -0.23],
          [s * 0.13, 0.51, 0.13],
        ],
        [0.035, 0.037, 0.041],
        dark,
        24,
        14,
      );
      tube(
        body,
        [
          [s * 0.13, 0.51, 0.13],
          [s * 0.13, 0.37, 0.1],
          [s * 0.12, 0.38, -0.2],
          [s * 0.085, 0.49, -0.285],
          [s * 0.045, 0.575, -0.33],
          [0, 0.625, -0.35],
        ],
        [0.032, 0.03, 0.029, 0.029, 0.03, 0.032],
        dark,
        28,
        14,
      ).name = 'supermoto-frame-merge-branch';

      // Both lower frame rails meet here. From this junction upward there is
      // one visibly wider central frame tube instead of two parallel rods.
      if (s === 1)
        tube(
          body,
          [
            [0, 0.625, -0.35],
            [0, 0.72, -0.365],
            [0, 0.84, -0.39],
            [0, 0.98, forkAxisAt(0.98)[2] + 0.024],
          ],
          [0.04, 0.041, 0.04, 0.037],
          dark,
          24,
          16,
        ).name = 'supermoto-frame-central-up-tube';
      tube(
        body,
        [
          [s * 0.13, 0.51, 0.13],
          [s * 0.081, 0.82, 0.48],
          [s * 0.037, 0.974, 0.82],
        ],
        [0.022, 0.022, 0.018],
        subframeFinish,
        20,
        12,
      ).name = 'supermoto-rear-subframe';
      rod(
        body,
        [s * 0.085, 0.884, 0.12],
        [s * 0.037, 0.974, 0.82],
        0.018,
        subframeFinish,
      ).name = 'supermoto-upper-subframe';
      const swingarm = loft(
        body,
        [
          [0.1, 0.033, 0.057, 0.5],
          [0.37, 0.037, 0.053, 0.43],
          [rear - 0.04, 0.028, 0.034, rearRadius + 0.01],
          [rear + 0.03, 0.023, 0.026, rearRadius],
        ],
        alloy,
        'z',
        16,
      );
      swingarm.geometry.scale(0.84, 1, 1);
      swingarm.position.x =
        s < 0 ? CHAIN_DRIVE.leftSwingarmX : CHAIN_DRIVE.rightSwingarmX;
      swingarm.name = 'box-section-swingarm';
      const forkGuard = rod(
        frontAssembly,
        [
          s * 0.08,
          0.36,
          THREE.MathUtils.lerp(
            front,
            forkTop[2],
            (0.36 - radius) / (forkTop[1] - radius),
          ),
        ],
        [
          s * 0.08,
          0.64,
          THREE.MathUtils.lerp(
            front,
            forkTop[2],
            (0.64 - radius) / (forkTop[1] - radius),
          ),
        ],
        0.043,
        paint,
      );
      // A moulded U-section shields the front and sides of the slider. The
      // rear stays open, as on a real fork protector; no end caps seal it.
      const guardLength = (forkGuard.geometry as THREE.CylinderGeometry)
        .parameters.height;
      forkGuard.geometry.dispose();
      forkGuard.geometry = new THREE.CylinderGeometry(
        0.043,
        0.039,
        guardLength,
        28,
        1,
        true,
        Math.PI * 0.35,
        Math.PI * 1.3,
      );
      const guardMaterial = paint.clone();
      guardMaterial.side = THREE.DoubleSide;
      forkGuard.material = guardMaterial;
      forkGuard.name = 'open-back-fork-guard';
      const shroud = sidePanel(
        body,
        s,
        SUPERMOTO_SHROUD,
        paint,
      );
      shroud.name = 'radiator-shroud';
      // The shoulder folds inward onto the tank. This shallow closed strip
      // gives the shroud a supported upper surface instead of a flat sign.
      const shoulderStations: [number, number, number, number, number][] = [
        [-0.408, 0.055, 0.947, 0.138, 0.965],
        [-0.265, 0.065, 0.971, 0.194, 0.965],
        [-0.045, 0.06, 0.952, 0.182, 0.927],
        [0.12, 0.066, 0.926, 0.142, 0.946],
      ];
      const shoulderVertices: number[] = [],
        shoulderIndices: number[] = [];
      for (const dy of [0, -0.007])
        for (const [z, innerX, innerY, outerX, outerY] of shoulderStations)
          shoulderVertices.push(
            s * innerX,
            innerY + dy,
            z,
            s * outerX,
            outerY + dy,
            z,
          );
      for (let i = 0; i < 3; i++) {
        const a = i * 2,
          b = a + 2;
        shoulderIndices.push(
          a,
          a + 1,
          b,
          a + 1,
          b + 1,
          b,
          a + 8,
          b + 8,
          a + 9,
          a + 9,
          b + 8,
          b + 9,
          a,
          b,
          a + 8,
          b,
          b + 8,
          a + 8,
          a + 1,
          a + 9,
          b + 1,
          b + 1,
          a + 9,
          b + 9,
        );
      }
      shoulderIndices.push(0, 8, 1, 1, 8, 9, 6, 7, 14, 7, 15, 14);
      const shoulderGeometry = new THREE.BufferGeometry();
      shoulderGeometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(shoulderVertices, 3),
      );
      shoulderGeometry.setIndex(shoulderIndices);
      const shoulderFinish = paint.clone();
      shoulderFinish.side = THREE.DoubleSide;
      mesh(body, shoulderGeometry, shoulderFinish).name = 'shroud-shoulder';
      sidePanel(
        body,
        s,
        [
          [0.207, 0.871, -0.321],
          [0.189, 0.893, -0.157],
          [0.169, 0.849, -0.041],
          [0.188, 0.824, -0.219],
        ],
        dark,
        0.006,
      );
      sidePanel(
        body,
        s,
        SUPERMOTO_SIDE_COVER,
        paint,
      ).name = 'supermoto-side-cover';
      // The inner liner closes the under-seat body at its sides. It stays
      // outside the central shock's 61 mm radius, leaving its travel open.
      sidePanel(
        body,
        s,
        [
          [0.102, 0.922, 0.176],
          [0.102, 0.955, 0.534],
          [0.098, 0.892, 0.601],
          [0.098, 0.762, 0.448],
          [0.102, 0.704, 0.309],
          [0.102, 0.795, 0.179],
        ],
        dark,
        0.006,
      ).name = 'airbox-inner-splash-wall';
      // Both plastics have bosses reaching actual frame/airbox material.
      for (const [x, y, z] of [
        [0.194, 0.885, -0.282],
        [0.143, 0.915, 0.176],
        [0.115, 0.955, 0.568],
      ]) {
        rod(body, [s * 0.065, y, z], [s * x, y, z], 0.008, dark).name =
          'plastic-mount-boss';
        rod(body, [s * x, y, z], [s * (x + 0.006), y, z], 0.0045, alloy).name =
          'plastic-fastener';
      }
      const radiator = mesh(
        body,
        new THREE.BoxGeometry(0.109, 0.248, 0.061),
        dark,
      );
      radiator.position.set(s * 0.109, 0.74, -0.315);
      radiator.name = 'radiator-core';
      for (const y of [0.61, 0.87]) {
        const tank = mesh(
          body,
          new THREE.BoxGeometry(0.12, 0.029, 0.068),
          engine,
        );
        tank.position.set(s * 0.109, y, -0.314);
        tank.name = 'radiator-end-tank';
      }
      for (let k = 0; k < 12; k++)
        rod(
          body,
          [s * 0.058, 0.629 + k * 0.02, -0.348],
          [s * 0.16, 0.629 + k * 0.02, -0.348],
          0.002,
          engine,
        );
      for (const x of [0.079, 0.117, 0.154])
        rod(
          body,
          [s * x, 0.614, -0.353],
          [s * x, 0.87, -0.353],
          0.0035,
          dark,
        ).name = 'radiator-protection-rib';
      rod(
        body,
        [s * 0.11, 0.824, -0.237],
        [s * 0.109, 0.858, -0.311],
        0.011,
        dark,
      ).name = 'radiator-frame-mount';
    }
    // Airbox bridges the tank and subframe under the saddle; side covers wrap
    // this volume instead of floating above a wholly open rear triangle.
    loft(
      body,
      [
        [0.055, 0.1, 0.061, 0.862],
        [0.22, 0.14, 0.112, 0.844],
        [0.43, 0.12, 0.084, 0.876],
        [0.61, 0.078, 0.036, 0.94],
        [0.78, 0.065, 0.028, 0.983],
      ],
      dark,
      'z',
      16,
    ).name = 'supermoto-airbox';
    // Narrow rear mudguard continues beneath the saddle and covers the wheel
    // through the subframe, tapering beyond the seat rather than ending square.
    loft(
      body,
      SUPERMOTO_TAIL_FENDER,
      paint,
      'z',
      16,
    ).name = 'supermoto-tail-fender';
    // V35: inner liner fitted to the existing side covers; splash flap at the shock.
    addSupermotoRearProtection(body, paint, rubber);
    rod(body, [-0.15, 0.5, 0.12], [0.15, 0.5, 0.12], 0.05, dark);
    // Compact crankcase, cylinder and head occupy the cradle instead of floating below the tank.
    oval(body, [0, 0.51, -0.015], [0.137, 0.132, 0.185], engine).name =
      'engine-crankcase';
    for (const s of [-1, 1]) {
      rod(
        body,
        [s * 0.128, 0.51, -0.035],
        [s * 0.16, 0.51, -0.035],
        0.1,
        engine,
      );
      rod(
        body,
        [s * 0.155, 0.51, -0.035],
        [s * 0.166, 0.51, -0.035],
        0.074,
        alloy,
      );
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        rod(
          body,
          [s * 0.163, 0.51 + Math.sin(a) * 0.079, -0.035 + Math.cos(a) * 0.079],
          [s * 0.172, 0.51 + Math.sin(a) * 0.079, -0.035 + Math.cos(a) * 0.079],
          0.007,
          dark,
        );
      }
    }
    loft(
      body,
      [
        [0.59, 0.085, 0.085, -0.13],
        [0.7, 0.087, 0.08, -0.15],
        [0.76, 0.1, 0.085, -0.16],
      ],
      engine,
      'y',
      16,
    );
    // Water-jacket seams, a valve cover and hoses distinguish this compact
    // liquid-cooled single from the starter's exposed stack of cooling fins.
    for (let k = 0; k < 2; k++)
      loft(
        body,
        [
          [0.636 + k * 0.065, 0.093, 0.085, -0.15],
          [0.642 + k * 0.065, 0.093, 0.085, -0.15],
        ],
        alloy,
        'y',
        16,
      ).name = 'cylinder-jacket-seam';
    loft(
      body,
      [
        [0.747, 0.101, 0.09, -0.16],
        [0.773, 0.104, 0.093, -0.16],
        [0.79, 0.089, 0.08, -0.16],
      ],
      dark,
      'y',
      16,
    ).name = 'engine-valve-cover';
    tube(
      body,
      [
        [0.1, 0.715, -0.165],
        [0.148, 0.69, -0.21],
        [0.133, 0.65, -0.315],
      ],
      [0.011, 0.012, 0.012],
      rubber,
      14,
      8,
    ).name = 'coolant-hose';
    tube(
      body,
      [
        [0, 0.713, -0.08],
        [0, 0.76, -0.035],
        [0, 0.83, 0.045],
      ],
      [0.027, 0.033, 0.038],
      dark,
      12,
      12,
    ).name = 'engine-intake';
    rod(body, [0.163, 0.565, 0.005], [0.177, 0.565, 0.005], 0.015, dark).name =
      'oil-filler-cap';
    const damperTop = new THREE.Vector3(0, 0.85, 0.27),
      damperBottom = new THREE.Vector3(0, 0.49, 0.43),
      axis = damperBottom.clone().sub(damperTop).normalize(),
      radial = new THREE.Vector3(1, 0, 0),
      cross = new THREE.Vector3().crossVectors(axis, radial);
    rod(body, [-0.118, 0.898, 0.27], [0.118, 0.898, 0.27], 0.024, dark).name =
      'shock-frame-crossmember';
    rod(
      body,
      [0, 0.898, 0.27],
      damperTop.toArray() as Point,
      0.024,
      dark,
    ).name = 'shock-upper-mount';
    rod(
      body,
      [CHAIN_DRIVE.leftSwingarmX, 0.414, 0.43],
      [CHAIN_DRIVE.rightSwingarmX, 0.414, 0.43],
      0.022,
      alloy,
    ).name = 'swingarm-crossmember';
    rod(
      body,
      [0, 0.414, 0.43],
      damperBottom.toArray() as Point,
      0.023,
      dark,
    ).name = 'shock-lower-link';
    rod(
      body,
      damperTop.toArray() as Point,
      damperBottom.toArray() as Point,
      0.024,
      alloy,
    );
    const coil = Array.from({ length: 85 }, (_, i) => {
      const t = i / 84,
        a = t * Math.PI * 12;
      return damperTop
        .clone()
        .lerp(damperBottom, t)
        .addScaledVector(radial, Math.cos(a) * 0.052)
        .addScaledVector(cross, Math.sin(a) * 0.052)
        .toArray() as Point;
    });
    tube(
      body,
      coil,
      coil.map(() => 0.0085),
      material('#c17d4e', 0.25, 0.44),
      100,
      8,
    ).name = 'rear-shock-spring';
    loft(
      body,
      [
        [-0.415, 0.076, 0.042, 0.962],
        [-0.26, 0.131, 0.114, 0.902],
        [-0.045, 0.115, 0.106, 0.876],
        [0.16, 0.096, 0.049, 0.912],
      ],
      paint,
      'z',
    ).name = 'supermoto-fuel-tank';
    rod(body, [0, 1.01, -0.299], [0, 1.024, -0.299], 0.027, dark).name =
      'fuel-cap';
    loft(
      body,
      [
        [-0.19, 0.067, 0.02, 0.997],
        [0.04, 0.1, 0.029, 0.977],
        [0.43, 0.093, 0.029, 0.983],
        [0.68, 0.067, 0.02, 1.012],
        [0.705, 0.039, 0.006, 1.022],
      ],
      seat,
      'z',
    );
    loft(
      body,
      [
        [-1.06, 0.057, 0.013, 0.805],
        [-0.94, 0.096, 0.024, 0.846],
        [-0.67, 0.102, 0.026, 0.853],
        [-0.52, 0.082, 0.019, 0.827],
        [-0.445, 0.071, 0.015, 0.765],
        [-0.425, 0.052, 0.009, 0.694],
      ],
      paint,
      'z',
    ).name = 'supermoto-front-fender';
    for (const s of [-1, 1]) {
      rod(
        body,
        [s * 0.034, 0.831, -0.513],
        [s * 0.034, 0.959, forkAxisAt(0.959)[2]],
        0.014,
        dark,
      ).name = 'front-fender-mount';
      for (const [y, z] of [
        [0.948, -0.57],
        [1.09, -0.532],
      ])
        rod(
          body,
          [s * 0.074, y, forkAxisAt(y)[2]],
          [s * 0.074, y, z],
          0.01,
          rubber,
        ).name = 'number-plate-strap';
    }
    loft(
      body,
      [
        [0.89, 0.069, 0.028, -0.62],
        [0.93, 0.104, 0.034, -0.607],
        [1.09, 0.126, 0.035, -0.564],
        [1.155, 0.106, 0.021, -0.55],
      ],
      paint,
      'y',
    );
    loft(
      body,
      [
        [0.947, 0.06, 0.006, -0.644],
        [0.99, 0.066, 0.008, -0.633],
        [1.032, 0.058, 0.006, -0.62],
      ],
      material('#1c272a', 0.1, 0.2),
      'y',
    ).name = 'supermoto-headlight-bezel';
    const reflector = loft(
      body,
      [
        [0.952, 0.052, 0.009, -0.648],
        [0.99, 0.058, 0.012, -0.64],
        [1.026, 0.051, 0.009, -0.628],
      ],
      material('#c7ced0', 0.78, 0.2),
      'y',
      40,
    );
    reflector.name = 'supermoto-headlight-reflector';
    const glass = new THREE.MeshPhysicalMaterial({
      color: '#eef7ff',
      transparent: true,
      opacity: 0.24,
      roughness: 0.08,
      metalness: 0,
      clearcoat: 1,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    loft(
      body,
      [
        [0.951, 0.053, 0.003, -0.66],
        [0.99, 0.06, 0.006, -0.656],
        [1.027, 0.052, 0.003, -0.64],
      ],
      glass,
      'y',
      40,
    ).name = 'supermoto-headlight-glass';
    oval(
      body,
      [0, 0.988, -0.651],
      [0.014, 0.016, 0.007],
      new THREE.MeshStandardMaterial({
        color: '#f7fcff',
        emissive: '#d2e9ff',
        emissiveIntensity: 0.28,
        roughness: 0.15,
      }),
    ).name = 'supermoto-headlight-bulb';
    tube(
      body,
      [
        [-pose.grip[0], pose.grip[1], pose.grip[2]],
        [-0.22, 1.13, -0.48],
        [-0.1, 1.124, -0.407],
        [0.1, 1.124, -0.407],
        [0.22, 1.13, -0.48],
        [pose.grip[0], pose.grip[1], pose.grip[2]],
      ],
      [0.016, 0.016, 0.016, 0.016, 0.016, 0.016],
      alloy,
      28,
      12,
    );
    for (const s of [-1, 1]) {
      tube(
        body,
        [
          [s * 0.23, 1.12, -0.48],
          [s * 0.31, 1.1, -0.6],
          [s * 0.43, 1.11, -0.59],
          [s * 0.445, 1.13, -0.44],
        ],
        [0.008, 0.008, 0.009, 0.008],
        alloy,
        20,
        12,
        0.65,
      );
      const guardOutline: Point[] = [
        [s * 0.246, 1.126, -0.555],
        [s * 0.292, 1.187, -0.595],
        [s * 0.437, 1.179, -0.582],
        [s * 0.468, 1.135, -0.55],
        [s * 0.422, 1.095, -0.575],
        [s * 0.311, 1.104, -0.611],
      ];
      const guardTriangles = THREE.ShapeUtils.triangulateShape(
        guardOutline.map((p) => new THREE.Vector2(p[0], p[1])),
        [],
      );
      const guardVertices = [0, 0.007].flatMap((dz) =>
        guardOutline.flatMap((p) => [p[0], p[1], p[2] + dz]),
      );
      const guardIndices: number[] = [];
      for (const [a, b, c] of guardTriangles)
        guardIndices.push(a, b, c, a + 6, c + 6, b + 6);
      for (let i = 0; i < 6; i++) {
        const j = (i + 1) % 6;
        guardIndices.push(i, j, i + 6, j, j + 6, i + 6);
      }
      const guardGeometry = new THREE.BufferGeometry();
      guardGeometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(guardVertices, 3),
      );
      guardGeometry.setIndex(guardIndices);
      const guardFinish = paint.clone();
      guardFinish.side = THREE.DoubleSide;
      mesh(body, guardGeometry, guardFinish).name = 'formed-handguard';
      tube(
        body,
        [
          [s * 0.24, 1.125, -0.46],
          [s * 0.32, 1.12, -0.5],
          [s * 0.4, 1.12, -0.51],
        ],
        [0.007, 0.007, 0.009],
        alloy,
        12,
        8,
      );
    }
    tube(
      body,
      [
        [0.13, 1.13, -0.46],
        [0.16, 1.0, -0.53],
        [0.11, 0.7, -0.64],
        [0.09, 0.41, -0.68],
      ],
      [0.005, 0.005, 0.005, 0.005],
      rubber,
      24,
      8,
    );
  } else {
    for (const s of [-1, 1])
      rod(body, forkAxisAt(0.995), [s * 0.1, 1.03, -0.43], 0.035, alloy).name =
        'frame-head-brace';
    // The lower wrapper hangs below the crankcases and rises behind the collector.
    const radiator = mesh(body, new THREE.BoxGeometry(0.285, 0.3, 0.042), dark);
    radiator.position.set(0, 0.645, -0.388);
    radiator.rotation.x = 0.16;
    radiator.name = 'sport-radiator';
    for (let k = 0; k < 13; k++) {
      const y = 0.51 + k * 0.022;
      rod(
        body,
        [-0.131, y, -0.416 + (y - 0.645) * 0.16],
        [0.131, y, -0.416 + (y - 0.645) * 0.16],
        0.0028,
        engine,
      );
    }
    loft(
      body,
      [
        [-0.36, 0.14, 0.026, 0.2],
        [-0.13, 0.168, 0.023, 0.186],
        [0.16, 0.153, 0.023, 0.2],
        [0.28, 0.095, 0.025, 0.3],
      ],
      dark,
      'z',
      16,
    ).name = 'sport-belly-pan';
    const tank = loft(
      body,
      [
        [-0.385, 0.084, 0.055, 0.92],
        [-0.3, 0.126, 0.078, 0.928],
        [-0.205, 0.169, 0.092, 0.928],
        [-0.11, 0.178, 0.093, 0.925],
        [-0.015, 0.168, 0.086, 0.916],
        [0.07, 0.151, 0.071, 0.9],
        [0.135, 0.134, 0.053, 0.875],
        [0.195, 0.118, 0.04, 0.86],
        [0.25, 0.11, 0.043, 0.845],
      ],
      paint,
      'z',
      32,
    );
    tank.name = 'sport-fuel-tank';
    // The rounded crown keeps its shoulder, while the lower rear flanks
    // tuck inward for the knees. End rings still meet the same frame/seat.
    const tankPositions = tank.geometry.getAttribute('position');
    for (let i = 0; i < tankPositions.count; i++) {
      const z = tankPositions.getZ(i);
      const kneeWaist =
        THREE.MathUtils.smoothstep(z, -0.08, 0.1) *
        (1 - THREE.MathUtils.smoothstep(z, 0.2, 0.25));
      const height = Math.cos(((i % 33) / 32) * Math.PI * 2 - Math.PI / 2);
      const lowerFlank = Math.exp(-(((height + 0.18) / 0.5) ** 2));
      tankPositions.setX(
        i,
        tankPositions.getX(i) * (1 - 0.19 * kneeWaist * lowerFlank),
      );
    }
    tank.geometry.computeVertexNormals();
    loft(
      body,
      [
        [0.12, 0.105, 0.022, 0.83],
        [0.31, 0.14, 0.035, 0.835],
        [0.51, 0.115, 0.031, 0.88],
        [0.62, 0.073, 0.019, 0.925],
      ],
      seat,
      'z',
    );
    const tailShell = loft(
      body,
      [
        [0.38, 0.153, 0.047, 0.823],
        [0.52, 0.174, 0.05, 0.885],
        [0.66, 0.155, 0.044, 0.946],
        [0.8, 0.093, 0.023, 0.986],
        [0.855, 0.048, 0.012, 0.991],
      ],
      paint,
      'z',
    );
    tailShell.name = 'sport-tail-shell';
    oval(body, [0.015, 0.52, -0.02], [0.13, 0.185, 0.25], engine).name =
      'engine-crankcase';
    loft(
      body,
      [
        [0.61, 0.165, 0.097, -0.145],
        [0.7, 0.173, 0.085, -0.18],
        [0.754, 0.17, 0.073, -0.195],
      ],
      engine,
      'y',
      16,
    ).name = 'inline-cylinder-block';
    loft(
      body,
      [
        [0.752, 0.18, 0.083, -0.195],
        [0.774, 0.181, 0.085, -0.195],
        [0.792, 0.16, 0.074, -0.195],
      ],
      dark,
      'y',
      16,
    ).name = 'engine-valve-cover';
    for (const s of [-1, 1]) {
      rod(
        body,
        [s * 0.121, 0.51, 0.035],
        [s * 0.151, 0.51, 0.035],
        0.09,
        engine,
      ).name = 'crankcase-cover';
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3;
        rod(
          body,
          [s * 0.15, 0.51 + Math.sin(a) * 0.073, 0.035 + Math.cos(a) * 0.073],
          [s * 0.158, 0.51 + Math.sin(a) * 0.073, 0.035 + Math.cos(a) * 0.073],
          0.005,
          dark,
        ).name = 'crankcase-cover-bolt';
      }
    }
    for (const x of [-0.102, -0.034, 0.034, 0.102])
      tube(
        body,
        [
          [x, 0.69, -0.254],
          [x, 0.57, -0.315],
          [x, 0.412, -0.29],
          [0.16, 0.355, -0.15],
        ],
        [0.015, 0.016, 0.017, 0.018],
        alloy,
        18,
        10,
      ).name = 'four-cylinder-exhaust-header';
    tube(
      body,
      [
        [0.143, 0.685, -0.382],
        [0.17, 0.63, -0.33],
        [0.165, 0.66, -0.215],
      ],
      [0.012, 0.012, 0.012],
      rubber,
      12,
      8,
    ).name = 'coolant-hose';
    // Mounts terminate on the generated underside triangles; the top disc
    // follows that face's normal instead of cutting through the tail skin.
    const tailContact = (
      part: THREE.Mesh,
      origin: THREE.Vector3,
      direction: THREE.Vector3,
    ) => {
      const ray = new THREE.Ray(origin, direction);
      const positions = part.geometry.getAttribute('position'),
        index = part.geometry.index!;
      const triangle = new THREE.Triangle(),
        hit = new THREE.Vector3();
      let nearest:
        | { point: THREE.Vector3; normal: THREE.Vector3; face: THREE.Triangle }
        | undefined;
      let distance = Infinity;
      for (let i = 0; i < index.count; i += 3) {
        triangle.a.fromBufferAttribute(positions, index.getX(i));
        triangle.b.fromBufferAttribute(positions, index.getX(i + 1));
        triangle.c.fromBufferAttribute(positions, index.getX(i + 2));
        if (
          ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, hit)
        ) {
          const next = hit.distanceTo(origin);
          if (next < distance) {
            distance = next;
            nearest = {
              point: hit.clone(),
              normal: triangle.getNormal(new THREE.Vector3()),
              face: triangle.clone(),
            };
          }
        }
      }
      if (!nearest)
        throw new Error('Sport tail mount has no supporting surface');
      return nearest;
    };
    for (const s of [-1, 1]) {
      tube(
        body,
        [
          [s * 0.1, 1.03, -0.43],
          [s * 0.18, 0.79, -0.12],
          [s * 0.16, 0.56, 0.15],
        ],
        [0.04, 0.046, 0.044],
        dark,
        22,
        14,
      );
      const subframe = tube(
        body,
        [
          [s * 0.16, 0.56, 0.15],
          [s * 0.108, 0.737, 0.39],
          [s * 0.066, 0.82, 0.58],
          [s * 0.02, 0.919, 0.765],
        ],
        [0.023, 0.021, 0.019, 0.016],
        dark,
        24,
        12,
      );
      subframe.name = 'sport-rear-subframe';
      const underside = tailContact(
        tailShell,
        new THREE.Vector3(s * 0.05, 0.7, 0.6),
        new THREE.Vector3(0, 1, 0),
      );
      underside.face.getMidpoint(underside.point);
      const railContact = tailContact(
        subframe,
        underside.point,
        underside.normal,
      );
      rod(
        body,
        railContact.point
          .addScaledVector(underside.normal, 0.005)
          .toArray() as Point,
        underside.point.toArray() as Point,
        0.005,
        dark,
      ).name = 'sport-tail-mount';
      const swingarm = loft(
        body,
        [
          [0.14, 0.032, 0.058, 0.51],
          [0.38, 0.035, 0.048, 0.43],
          [rear, 0.027, 0.03, rearRadius],
        ],
        dark,
        'z',
        16,
      );
      swingarm.geometry.scale(0.84, 1, 1);
      swingarm.position.x =
        s < 0 ? CHAIN_DRIVE.leftSwingarmX : CHAIN_DRIVE.rightSwingarmX;
      swingarm.name = 'box-section-swingarm';

      rod(
        body,
        [s * forkHalfWidth, 1.0, forkAxisAt(1.0)[2]],
        [s * 0.32, 0.94, -0.47],
        0.017,
        dark,
      );
    }
    makeSportBodywork(body, paint, tank);
    makeSportFender(frontAssembly, radius, front, paint);
    const rearLamp = loft(
      body,
      [
        [0.8, 0.055, 0.01, 0.966],
        [0.837, 0.042, 0.011, 0.969],
      ],
      material('#b64232', 0.1, 0.35),
      'z',
      16,
    );
    rearLamp.name = 'tail-light';
  }
  if (!moped) {
    makeDrive(body, wheels[1], 0.08, 0.49, engine);
    rod(
      body,
      [CHAIN_DRIVE.leftSwingarmX - 0.035, rearRadius, rear],
      [0.18, rearRadius, rear],
      0.012,
      alloy,
    );
    rod(
      body,
      [CHAIN_DRIVE.leftSwingarmX, 0.46, 0.18],
      [0.16, 0.46, 0.18],
      0.022,
      dark,
    );
  } else makeBeltDrive(body, wheels[1], engine, rubber);
  // One exhaust only, on the rider's right; curved header joins the engine.
  const exhaustX = moped ? 0.15 : sport ? 0.215 : 0.130;
  const exhaustY = moped ? 0.22 : sport ? 0.34 : 0.754;
  const mufflerStartZ = moped ? 0.38 : sport ? 0.55 : 0.415;
  const mufflerEndZ = moped ? 0.76 : sport ? 0.82 : 0.785;
  const mufflerRise = moped ? 0.025 : sport ? 0.155 : 0.133;
  const mufflerY = (z: number) =>
    exhaustY +
    ((z - mufflerStartZ) / (mufflerEndZ - mufflerStartZ)) * mufflerRise;
  tube(
    body,
    moped
      ? [
          [0.025, 0.275, -0.235],
          [0.11, 0.19, -0.24],
          [exhaustX, 0.19, 0.25],
          [exhaustX, mufflerY(0.56), 0.56],
        ]
      : sport
        ? [
            [0.16, 0.355, -0.15],
            [0.2, 0.33, -0.02],
            [exhaustX, 0.304, 0.3],
            [exhaustX, 0.328, 0.52],
            [exhaustX, mufflerY(0.6), 0.6],
          ]
        : [
            [0.045, 0.724, -0.234],
            [0.102, 0.705, -0.254],
            [0.141, 0.681, -0.249],
            [0.139, 0.659, -0.165],
            [0.105, 0.676, -0.012],
            [0.105, 0.659, 0.25],
            [0.117, 0.662, 0.337],
            [exhaustX, mufflerY(0.442), 0.442],
            [exhaustX, mufflerY(0.56), 0.56],
          ],
    moped
      ? [0.016, 0.019, 0.022, 0.025]
      : sport
        ? [0.022, 0.024, 0.025, 0.027, 0.03]
        : [0.019, 0.022, 0.023, 0.022, 0.02, 0.02, 0.021, 0.025, 0.029],
    sport ? material('#596166', 0.72, 0.42) : alloy,
    24,
    14,
  ).name = 'connected-exhaust-pipe';
  const muffler: THREE.Mesh = rod(
    body,
    [exhaustX, exhaustY, mufflerStartZ],
    [exhaustX, mufflerY(mufflerEndZ), mufflerEndZ],
    moped ? 0.032 : sport ? 0.06 : 0.047,
    alloy,
  );
  muffler.name = 'single-exhaust';
  if (!moped) {
    // A short formed oval can, with tapered inlet/outlet caps. Retaining its
    // longitudinal CylinderGeometry datum keeps connection checks meaningful.
    const length = (muffler.geometry as THREE.CylinderGeometry).parameters
      .height;
    const silencer = new THREE.CylinderGeometry(
      sport ? 0.06 : 0.052,
      sport ? 0.06 : 0.052,
      length,
      8,
      20,
      true,
    );
    const positions = silencer.getAttribute('position');
    const profile = [
      [0, 0.55],
      [0.05, 0.69],
      [0.15, 1],
      [0.77, 1],
      [0.9, 0.89],
      [1, 0.6],
    ];
    for (let i = 0; i < positions.count; i++) {
      const t = THREE.MathUtils.clamp(positions.getY(i) / length + 0.5, 0, 1);
      const index = Math.min(
        profile.findIndex((p) => p[0] >= t - 1e-6),
        profile.length - 1,
      );
      const right = profile[Math.max(0, index)],
        left = profile[Math.max(0, index - 1)];
      const blend =
        right[0] === left[0] ? 0 : (t - left[0]) / (right[0] - left[0]);
      const taper = THREE.MathUtils.lerp(left[1], right[1], blend);
      positions.setXYZ(
        i,
        positions.getX(i) * taper * (sport ? 0.94 : 0.85),
        positions.getY(i),
        positions.getZ(i) * taper * (sport ? 1 : 1.16),
      );
    }
    silencer.clearGroups();
    for (let row = 0; row < 20; row++) {
      const t = 1 - (row + 0.5) / 20;
      silencer.addGroup(row * 48, 48, t < 0.15 ? 1 : t > 0.9 ? 2 : 0);
    }
    silencer.computeVertexNormals();
    const brushedBody = material('#646e72', 0.68, 0.44);
    brushedBody.flatShading = true;
    const capAlloy = material('#99a2a4', 0.76, 0.36);
    capAlloy.flatShading = true;
    const capDark = material('#293033', 0.42, 0.5);
    capDark.flatShading = true;
    muffler.geometry.dispose();
    muffler.geometry = silencer;
    muffler.material = [brushedBody, capAlloy, capDark];
  }
  const exhaustBand = rod(
    body,
    [
      exhaustX,
      mufflerY(moped ? 0.58 : sport ? 0.68 : 0.56),
      moped ? 0.58 : sport ? 0.68 : 0.56,
    ],
    [
      exhaustX,
      mufflerY(moped ? 0.602 : sport ? 0.702 : 0.582),
      moped ? 0.602 : sport ? 0.702 : 0.582,
    ],
    moped ? 0.034 : sport ? 0.06 : 0.054,
    dark,
  );
  exhaustBand.name = 'exhaust-mount-band';
  if (!moped && !sport) {
    const length = (exhaustBand.geometry as THREE.CylinderGeometry).parameters
      .height;
    exhaustBand.geometry.dispose();
    exhaustBand.geometry = new THREE.CylinderGeometry(
      0.054,
      0.054,
      length,
      8,
      1,
      true,
    );
    exhaustBand.geometry.scale(0.85, 1, 1.16);
    exhaustBand.geometry.computeVertexNormals();
  }
  if (moped || sport)
    rod(
      body,
      [moped ? 0.105 : 0.075, moped ? 0.337 : 0.85, moped ? 0.55 : 0.58],
      [exhaustX, mufflerY(moped ? 0.591 : 0.691), moped ? 0.591 : 0.691],
      moped ? 0.009 : 0.012,
      dark,
    ).name = 'exhaust-frame-hanger';
  else
    tube(
      body,
      [
        [0.1223, 0.6797, 0.31],
        [0.105, 0.696, 0.438],
        [0.123, mufflerY(0.571), 0.571],
      ],
      [0.009, 0.009, 0.009],
      dark,
      12,
      8,
    ).name = 'exhaust-frame-hanger';
  if (moped || sport)
    rod(
      body,
      [exhaustX, mufflerY(mufflerEndZ - 0.005), mufflerEndZ - 0.005],
      [exhaustX, mufflerY(mufflerEndZ + 0.02), mufflerEndZ + 0.02],
      moped ? 0.023 : 0.037,
      rubber,
    );
  else {
    // An annular lip turns into a deep bore: the opening has real thickness,
    // not a black disc pasted over the end of a capped cylinder.
    const outletMaterial = material('#161c1f', 0.4, 0.5);
    outletMaterial.side = THREE.DoubleSide;
    const outletGeometry = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.0312, -0.009),
        new THREE.Vector2(0.0312, 0.008),
        new THREE.Vector2(0.019, 0.009),
        new THREE.Vector2(0.018, -0.048),
      ],
      16,
    );
    outletGeometry.scale(0.85, 1, 1.16);
    const outlet = mesh(body, outletGeometry, outletMaterial);
    outlet.position.set(exhaustX, mufflerY(mufflerEndZ), mufflerEndZ);
    outlet.quaternion.copy(muffler.quaternion);
    outlet.name = 'open-silencer-outlet';
  }
  for (const s of [-1, 1]) {
    rod(
      body,
      [s * (pose.grip[0] - 0.055), pose.grip[1], pose.grip[2]],
      [s * (pose.grip[0] + 0.055), pose.grip[1], pose.grip[2]],
      0.024,
      rubber,
    );
    if (sport)
      sidePanel(
        body,
        s,
        [
          [0.16, 0.56, 0.15],
          [0.179, 0.6, 0.23],
          [0.205, 0.47, 0.4],
          [0.224, pose.peg[1] - 0.012, pose.peg[2] + 0.013],
          [0.173, 0.435, 0.35],
          [0.155, 0.52, 0.19],
        ],
        alloy,
        0.014,
      ).name = 'frame-mounted-rearset';
    if (player.bike === '450') {
      addSupermotoFootpeg(body, s, pose.peg, alloy, dark);
    } else {
      rod(
        body,
        [s * 0.1, pose.peg[1], pose.peg[2]],
        [s * (pose.peg[0] + 0.055), pose.peg[1], pose.peg[2]],
        0.018,
        dark,
      ).name = 'rider-footpeg';
    }
  }
  // V39-FIX: finish after spring/fork construction; no one-sided panel mutation.
  if (player.bike === '450') finishSupermotoSuspension(body);
  const ignitionKey = addIgnitionKey(body, player, products, pose.grip);
  if (player.bike === '450') fitRearExitExhaust(body, paint);
  finishWheelColors(body, player.rims); blackSprings(body);
  const rider = makeRider(body, riderPose, player, products);
  // V41-FIX: makeRider returns a controller; its group exists only after construction.
  darkenWardrobe(rider.group);
  if (player.bike === '450') tiltHandlebarBack(body);
  // Bike dimensions grow relative to the same adult. Counter-scale only this
  // parent transform; every rider mesh and fixed bone retains its world length.
  body.scale.setScalar(modelScale);
  rider.group.scale.setScalar(1 / modelScale);
  const movedLower = new THREE.Vector3(),
    direction = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const animateSuspension = (pitch: number, travel: number) => {
    const pose = suspensionPose(
      pitch,
      travel / modelScale,
      rear,
      front,
      rearRadius,
    );
    body.rotation.x = pose.pitch;
    body.position.copy(pose.position).multiplyScalar(modelScale);
    frontAssembly.rotation.x = pose.axleAngle;
    frontAssembly.position.copy(pose.axlePosition);
    for (const fork of forkSliders) {
      movedLower
        .copy(fork.lower)
        .applyAxisAngle(up.set(1, 0, 0), pose.axleAngle)
        .add(pose.axlePosition);
      direction.copy(fork.upper).sub(movedLower);
      fork.mesh.position.copy(movedLower).add(fork.upper).multiplyScalar(0.5);
      fork.mesh.scale.y = direction.length() / fork.length;
      fork.mesh.quaternion.setFromUnitVectors(
        up.set(0, 1, 0),
        direction.normalize(),
      );
    }
  };
  return {
    root,
    body,
    wheels,
    rider: rider.group,
    animateRider: rider.animate,
    animateAccessories: (input: CarriedCapMotionInput, dt: number) => {
      rider.animateAccessories(input, dt);
      updateCrossbodyMotion(rider.group, input, dt); ignitionKey?.update(input, dt);
    },
    animateSuspension,
    wheelRadius: rearRadius * modelScale,
    rearAxle: rear * modelScale,
  };
}

function trimTeeSleeveTorsoOverlap(
  sleeve: THREE.Mesh,
  rings: number,
  sides: number,
  sideSign: -1 | 1,
) {
  const geometry = sleeve.geometry;
  const positions = geometry.getAttribute('position');
  const sourceIndex = geometry.getIndex();
  if (!sourceIndex) throw new Error('T-shirt sleeve must be indexed');

  const kept: number[] = [];

  for (let i = 0; i < sourceIndex.count; i += 3) {
    const a = sourceIndex.getX(i);
    const b = sourceIndex.getX(i + 1);
    const c = sourceIndex.getX(i + 2);

    const ring =
      (Math.floor(a / (sides + 1)) +
        Math.floor(b / (sides + 1)) +
        Math.floor(c / (sides + 1))) /
      3;
    const u = ring / rings;

    let buriedInTorso = false;

    if (u < 0.52) {
      const signedX =
        sideSign *
        ((positions.getX(a) +
          positions.getX(b) +
          positions.getX(c)) /
          3);

      // The first T-shirt sleeve rings run through the torso.
      // Their visible intersection is the curved shoulder -> inner-back line.
      // Keep the overlap underneath, but do not render triangles buried
      // toward the torso centre.
      const fade = THREE.MathUtils.smoothstep(u, 0, 0.52);
      const innerLimit = THREE.MathUtils.lerp(0.205, 0.142, fade);
      buriedInTorso = signedX < innerLimit;
    }

    if (!buriedInTorso) kept.push(a, b, c);
  }

  geometry.setIndex(kept);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}


function moveTeeShoulderForward(
  sleeve: THREE.Mesh,
  rings: number,
  sides: number,
) {
  const positions = sleeve.geometry.getAttribute('position');
  const center = new THREE.Vector3(),
    point = new THREE.Vector3();

  const maxRing = Math.max(4, Math.min(rings, Math.floor(rings * 0.34)));

  for (let ring = 0; ring <= maxRing; ring++) {
    center.set(0, 0, 0);
    for (let j = 0; j < sides; j++) {
      center.add(point.fromBufferAttribute(positions, ring * (sides + 1) + j));
    }
    center.divideScalar(sides);

    const t = ring / Math.max(1, rings);
    const shoulder = Math.exp(-(((t - 0.16) / 0.18) ** 2));

    for (let j = 0; j <= sides; j++) {
      const index = ring * (sides + 1) + j;
      point.fromBufferAttribute(positions, index).sub(center);

      const upper = point.y > 0 ? 1 : 0;
      const outer =
        Math.abs(point.x) /
        Math.max(0.0001, Math.abs(point.x) + Math.abs(point.z));
      const pull = shoulder * upper * (0.45 + 0.55 * outer);

      // Slightly forward, slightly flatter. No torso edits.
      point.z += 0.008 * pull;
      point.y *= 1 - 0.04 * pull;
      point.x *= 1 - 0.01 * pull;

      point.add(center);
      positions.setXYZ(index, point.x, point.y, point.z);
    }
  }

  sleeve.geometry.computeVertexNormals();
}

function makeRider(
  parent: THREE.Object3D,
  pose: RiderPose,
  player: Player,
  products: Product[],
) {
  const rider = new THREE.Group();
  parent.add(rider);
  const pelvis = new THREE.Group();
  rider.add(pelvis);
  const rest = riderMotionPose(pose, { wheelie: 0, steer: 0, landing: 0 });

  type TorsoSkinPose = {
    hip: Point;
    lean: number;
    roll: number;
  };
  type ArmSkinPose = {
    start: Point;
    joint: Point;
    end: Point;
  };

  const skinGarmentArm = (
    meshes: THREE.Mesh[],
    restArm: ArmSkinPose,
    restTorso: TorsoSkinPose,
    outerwearSkin: boolean,
    teeSkin: boolean,
  ) => {
    const torsoBone = new THREE.Bone();
    const upperBone = new THREE.Bone();
    const lowerBone = new THREE.Bone();
    rider.add(torsoBone);
    rider.add(upperBone);
    rider.add(lowerBone);

    const skeleton = new THREE.Skeleton([
      torsoBone,
      upperBone,
      lowerBone,
    ]);
    const up = new THREE.Vector3(0, 1, 0);
    const direction = new THREE.Vector3();

    const update = (arm: ArmSkinPose, torsoPose: TorsoSkinPose) => {
      torsoBone.position.set(...torsoPose.hip);
      torsoBone.quaternion.setFromEuler(
        new THREE.Euler(-torsoPose.lean, 0, torsoPose.roll),
      );

      const a = V(arm.start);
      const b = V(arm.joint);
      const c = V(arm.end);

      upperBone.position.copy(a);
      upperBone.quaternion.setFromUnitVectors(
        up,
        direction.subVectors(b, a).normalize(),
      );

      lowerBone.position.copy(b);
      lowerBone.quaternion.setFromUnitVectors(
        up,
        direction.subVectors(c, b).normalize(),
      );
    };

    update(restArm, restTorso);

    const a = V(restArm.start);
    const b = V(restArm.joint);
    const c = V(restArm.end);
    const upperDirection = b.clone().sub(a).normalize();
    const segmentA = new THREE.Line3(a.clone(), b.clone());
    const segmentB = new THREE.Line3(b.clone(), c.clone());
    const lengthA = a.distanceTo(b);
    const lengthB = b.distanceTo(c);
    const sample = new THREE.Vector3();
    const closestA = new THREE.Vector3();
    const closestB = new THREE.Vector3();

    for (const original of meshes) {
      const geometry = original.geometry;
      const positions = geometry.getAttribute('position');
      const indices = new Uint16Array(positions.count * 4);
      const weights = new Float32Array(positions.count * 4);

      for (let i = 0; i < positions.count; i++) {
        sample.fromBufferAttribute(positions, i);

        // Signed distance along the upper arm. Hidden root vertices are
        // negative/near zero and therefore stay attached to the torso.
        const signedFromShoulder = sample
          .clone()
          .sub(a)
          .dot(upperDirection);
        const torsoWeight =
          1 -
          THREE.MathUtils.smoothstep(
            signedFromShoulder,
            outerwearSkin ? -0.075 : teeSkin ? -0.082 : -0.065,
            outerwearSkin ? 0.31 : teeSkin ? 0.3 : 0.25,
          );

        const tA = segmentA.closestPointToPointParameter(sample, true);
        const tB = segmentB.closestPointToPointParameter(sample, true);
        segmentA.at(tA, closestA);
        segmentB.at(tB, closestB);
        const along =
          sample.distanceToSquared(closestA) <
          sample.distanceToSquared(closestB)
            ? tA * lengthA
            : lengthA + tB * lengthB;
        const lowerBlend = THREE.MathUtils.smoothstep(
          along,
          lengthA - 0.055,
          lengthA + 0.055,
        );
        const armWeight = 1 - torsoWeight;

        indices[i * 4] = 0;
        indices[i * 4 + 1] = 1;
        indices[i * 4 + 2] = 2;
        weights[i * 4] = torsoWeight;
        weights[i * 4 + 1] = armWeight * (1 - lowerBlend);
        weights[i * 4 + 2] = armWeight * lowerBlend;
      }

      geometry.setAttribute(
        'skinIndex',
        new THREE.Uint16BufferAttribute(indices, 4),
      );
      geometry.setAttribute(
        'skinWeight',
        new THREE.Float32BufferAttribute(weights, 4),
      );

      const skinned = new THREE.SkinnedMesh(
        geometry,
        original.material,
      );
      skinned.name = original.name;
      skinned.castShadow = original.castShadow;
      skinned.receiveShadow = original.receiveShadow;
      skinned.frustumCulled = false;

      rider.remove(original);
      rider.add(skinned);
      rider.updateWorldMatrix(true, true);
      skinned.bind(skeleton);
    }

    return update;
  };

  const limbs: {
    arm: ReturnType<typeof skinGarmentArm>;
    leg: ReturnType<typeof skinLimb>;
  }[] = [];
  const upper = products.find((p) => p.id === player.equipped.upper);
  const productColor = (p: Product | undefined) =>
    p?.preview?.colors.find((c) => c.variantIds.includes(player.variants[p.id]))
      ?.baseColor ??
    p?.baseColor ??
    '#394143';
  const color = productColor(upper),
    cloth = fabricMaterial(upper, player, color),
    pants = material('#242d31', 0, 0.96),
    boot = material('#141c20', 0, 0.82),
    skin = material('#987565', 0, 0.9);
  const tee = !!upper && /shirt/i.test(upper.type),
    hoodie = !!upper && /hoodie|zipper/i.test(upper.type),
    zipper = !!upper && /zipper|windbreaker/i.test(upper.type);
  const volume = zipper ? 1.065 : hoodie ? 1.075 : tee ? 1.025 : 1.0;
  const hem = zipper ? -0.04 : -0.05;
  const torsoGroup = new THREE.Group();
  torsoGroup.position.set(...pose.hip);
  torsoGroup.rotation.x = -pose.torsoLean;
  rider.add(torsoGroup);
  const torso = loft(
    torsoGroup,
    [
      [hem, 0.205 * volume, 0.126 * volume, 0.006],
      [0.02, 0.204 * volume, 0.127 * volume, 0.003],
      [0.18, 0.211 * volume, 0.126 * volume, 0],
      [0.37, 0.224 * volume, 0.133 * volume, 0],
      [0.455, 0.234 * volume, 0.128 * volume, 0],
      [0.495, 0.239 * volume, 0.119 * volume, 0],
      [0.52, 0.239 * volume, 0.111 * volume, 0],
      [0.545, 0.232 * volume, 0.101 * volume, 0],
      [0.568, 0.21 * volume, 0.09 * volume, 0],
      [0.588, 0.169 * volume, 0.079 * volume, 0],
      [0.607, 0.108, 0.066, 0],
      [0.631, 0.074, 0.057, 0],
    ],
    garmentMaterial(upper, player, color),
  );
  torso.name = 'tailored-garment';
  torso.castShadow = false;
  torso.receiveShadow = false;
  torsoDrape(torso.geometry, hem, hoodie || zipper, hoodie);
  if (hoodie)
    applyRibbedTrim(torso.material as THREE.MeshStandardMaterial, 'hem');
  const stitching = material(
    new THREE.Color(color).multiplyScalar(0.8).getStyle(),
    0,
    1,
  );
  if (hoodie) addGarmentPockets(torsoGroup, torso, zipper, stitching);
  if (upper?.handle === 'unisex-windbreaker')
    addWindbreakerDetails(torsoGroup, torso, stitching);
  foldGarmentHem(torsoGroup, torso, 24, hoodie ? 0.045 : 0.022, stitching);
  if (hoodie) {
    loft(
      torsoGroup,
      [
        [zipper ? 0.49 : 0.47, 0.11, 0.05, 0.105],
        [0.53, 0.135, 0.065, 0.11],
        [0.6, 0.115, 0.06, 0.1],
        [0.65, 0.075, 0.045, 0.073],
      ],
      cloth,
    ).name = 'folded-hood';
  }
  if (upper?.handle === 'unisex-windbreaker')
    loft(
      torsoGroup,
      [
        [0.555, 0.098, 0.072, 0],
        [0.6, 0.09, 0.07, 0],
        [0.66, 0.078, 0.058, 0],
      ],
      cloth,
    ).name = 'stand-collar';
  if (zipper) addGarmentZip(torsoGroup, torso, material('#69716f', 0.5, 0.7));
  const trouserSeat = loft(
    pelvis,
    [
      [pose.hip[1] - 0.092, 0.145, 0.04, pose.hip[2] - 0.058],
      [pose.hip[1] - 0.058, 0.186, 0.09, pose.hip[2] - 0.005],
      [pose.hip[1] - 0.012, 0.197, 0.118, pose.hip[2]],
      [pose.hip[1] + 0.05, 0.189, 0.115, pose.hip[2] - 0.009],
      [pose.hip[1] + 0.115, 0.167, 0.1, pose.hip[2] - 0.02],
    ],
    pants,
  );
  trouserSeat.name = 'continuous-trouser-seat';

  for (const side of [-1, 1]) {
    const shoulder: Point = [
        side * RIDER_DIMENSIONS.shoulderHalf,
        pose.shoulder[1],
        pose.shoulder[2],
      ],
      elbow: Point = [side * pose.elbow[0], pose.elbow[1], pose.elbow[2]],
      wrist: Point = [side * pose.wrist[0], pose.wrist[1], pose.wrist[2]];
    // Clean garment armhole:
    // two hidden sleeve-root centres start inside the torso and curve outward
    // into the anatomical shoulder. This matches the reference silhouette:
    // a smooth concave underarm line, not a separate hanging flap.
    const torsoOrientation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-pose.torsoLean, 0, 0),
    );
    const torsoSleevePoint = (
      x: number,
      y: number,
      z: number,
    ): Point =>
      new THREE.Vector3(side * x, y, z)
        .applyQuaternion(torsoOrientation)
        .add(V(pose.hip))
        .toArray() as Point;
    const outerwear = hoodie || zipper;

    // Armhole centres stay almost on the torso depth plane. V5 pushed them
    // forward in z, which produced the visible front-facing wedge.
    // Four centres now form a smooth inward C-curve under the armpit.
    // Root points are deliberately deeper inside the torso. The overlap itself
    // closes the seam, so no extra visible filler geometry is needed.
    const teeRootDeep = torsoSleevePoint(
      0.116,
      0.365,
      0,
    );
    const sleeveRoot = torsoSleevePoint(
      outerwear ? 0.138 : tee ? 0.136 : 0.144,
      outerwear ? 0.394 : tee ? 0.404 : 0.41,
      0,
    );
    const sleeveBlend = torsoSleevePoint(
      outerwear ? 0.158 : tee ? 0.158 : 0.162,
      outerwear ? 0.434 : tee ? 0.444 : 0.449,
      0,
    );
    const sleeveArmhole = torsoSleevePoint(
      outerwear ? 0.181 : tee ? 0.18 : 0.183,
      outerwear ? 0.48 : tee ? 0.486 : 0.492,
      0,
    );

    // Tee roots now overlap deeply inside the torso instead of relying on a
    // separate visible fill panel.
    const rootRadius = (outerwear ? 0.1 : tee ? 0.1 : 0.082) * volume;
    const blendRadius = (outerwear ? 0.098 : tee ? 0.096 : 0.084) * volume;
    const armholeRadius = (outerwear ? 0.094 : tee ? 0.091 : 0.086) * volume;

    // Sichtbare Stoff-Schulter tiefer als das anatomische Gelenk:
    // keine nach oben stehende Spitze, Skelett bleibt unverändert.
    const garmentShoulder: Point = [
      shoulder[0] + side * (outerwear ? 0.008 : tee ? 0.003 : 0.006),
      shoulder[1] - (outerwear ? 0.05 : tee ? 0.048 : 0.044),
      shoulder[2],
    ];
    const shoulderRadius = (outerwear ? 0.088 : tee ? 0.074 : 0.081) * volume;
    const armMeshes: THREE.Mesh[] = [];

    const shapeArmholeInward = (
      sleeve: THREE.Mesh,
      rings: number,
      sides: number,
      sideSign: -1 | 1,
      amount: number,
    ) => {
      const positions = sleeve.geometry.getAttribute(
        'position',
      ) as THREE.BufferAttribute;
      const center = new THREE.Vector3();
      const point = new THREE.Vector3();

      for (let ring = 0; ring <= rings; ring++) {
        const t = ring / rings;
        if (t > 0.42) break;

        center.set(0, 0, 0);
        for (let j = 0; j <= sides; j++)
          center.add(
            point.fromBufferAttribute(
              positions,
              ring * (sides + 1) + j,
            ),
          );
        center.divideScalar(sides + 1);

        // Smooth bell-shaped influence: zero at the hidden root and again
        // before the ordinary sleeve starts. No kink at either boundary.
        const along =
          Math.exp(-(((t - 0.205) / 0.125) ** 2)) *
          THREE.MathUtils.smoothstep(t, 0.015, 0.08) *
          (1 - THREE.MathUtils.smoothstep(t, 0.34, 0.42));

        for (let j = 0; j <= sides; j++) {
          const index = ring * (sides + 1) + j;
          point.fromBufferAttribute(positions, index);
          const relativeX = point.x - center.x;

          // Only the torso-facing half of the circular sleeve section moves.
          // The outside shoulder silhouette is untouched.
          const inwardSide = THREE.MathUtils.clamp(
            (-sideSign * relativeX) / 0.1,
            0,
            1,
          );
          const angular = inwardSide * inwardSide * (3 - 2 * inwardSide);
          const influence = along * angular;

          // Pull toward the body centre and slightly upward. This produces the
          // requested rounded inward C-shape instead of an outward bulge.
          point.x -= sideSign * amount * influence;
          point.y += amount * 0.22 * influence;

          positions.setXYZ(index, point.x, point.y, point.z);
        }
      }

      positions.needsUpdate = true;
      sleeve.geometry.computeVertexNormals();
      sleeve.geometry.computeBoundingSphere();
    };

    const smoothOuterSleeveContour = (
      sleeve: THREE.Mesh,
      rings: number,
      sides: number,
      sideSign: -1 | 1,
    ) => {
      if (!outerwear && !tee) return;

      const positions = sleeve.geometry.getAttribute(
        'position',
      ) as THREE.BufferAttribute;
      const center = new THREE.Vector3();
      const point = new THREE.Vector3();

      for (let ring = 0; ring <= rings; ring++) {
        const t = ring / rings;
        if (t < 0.16 || t > 0.72) continue;

        center.set(0, 0, 0);
        for (let j = 0; j <= sides; j++)
          center.add(
            point.fromBufferAttribute(
              positions,
              ring * (sides + 1) + j,
            ),
          );
        center.divideScalar(sides + 1);

        const band = Math.exp(-(((t - 0.43) / 0.3) ** 2));

        for (let j = 0; j <= sides; j++) {
          const index = ring * (sides + 1) + j;
          point.fromBufferAttribute(positions, index);
          const relativeX = point.x - center.x;
          const outer = THREE.MathUtils.clamp(
            (sideSign * relativeX) / 0.1,
            0,
            1,
          );
          const smooth = outer * outer * (3 - 2 * outer);
          point.x -=
            sideSign *
            (tee ? 0.0025 : outerwear ? 0.0035 : 0.006) *
            band *
            smooth;
          positions.setX(index, point.x);
        }
      }

      positions.needsUpdate = true;
      sleeve.geometry.computeVertexNormals();
      sleeve.geometry.computeBoundingSphere();
    };

    const flattenShoulderTop = (
      sleeve: THREE.Mesh,
      rings: number,
      sides: number,
    ) => {
      const positions = sleeve.geometry.getAttribute(
        'position',
      ) as THREE.BufferAttribute;
      const center = new THREE.Vector3();
      const point = new THREE.Vector3();

      for (let ring = 0; ring <= rings; ring++) {
        const t = ring / rings;
        if (t > 0.46) break;

        center.set(0, 0, 0);
        for (let j = 0; j <= sides; j++)
          center.add(
            point.fromBufferAttribute(
              positions,
              ring * (sides + 1) + j,
            ),
          );
        center.divideScalar(sides + 1);

        const shoulderBand =
          Math.exp(-(((t - 0.27) / 0.17) ** 2)) *
          THREE.MathUtils.smoothstep(t, 0.03, 0.1) *
          (1 - THREE.MathUtils.smoothstep(t, 0.39, 0.46));

        for (let j = 0; j <= sides; j++) {
          const index = ring * (sides + 1) + j;
          point.fromBufferAttribute(positions, index);
          const dy = point.y - center.y;
          if (dy > 0) {
            point.y =
              center.y +
              dy *
                (1 -
                  shoulderBand *
                    (tee || outerwear ? 0.08 : 0.28));
            positions.setY(index, point.y);
          }
        }
      }

      positions.needsUpdate = true;
      sleeve.geometry.computeVertexNormals();
      sleeve.geometry.computeBoundingSphere();
    };

    if (tee) {
      const sleeveEnd = V(shoulder).lerp(V(elbow), 0.86).toArray() as Point,
        skinStart = V(shoulder).lerp(V(elbow), 0.73).toArray() as Point;
      armMeshes.push(
        tube(
          rider,
          [
            teeRootDeep,
            sleeveRoot,
            sleeveBlend,
            sleeveArmhole,
            garmentShoulder,
            V(garmentShoulder).lerp(V(elbow), 0.26).toArray() as Point,
            sleeveEnd,
          ],
          [
            0.106 * volume,
            rootRadius,
            blendRadius,
            armholeRadius,
            shoulderRadius,
            0.083 * volume,
            0.079 * volume,
          ],
          cloth,
          24,
          24,
          0.92,
        ),
      );
      armMeshes.push(
        tube(
          rider,
          [
            skinStart,
            V(skinStart).lerp(V(elbow), 0.8).toArray() as Point,
            elbow,
            V(elbow).lerp(V(wrist), 0.35).toArray() as Point,
            wrist,
          ],
          [0.071, 0.064, 0.055, 0.06, 0.038],
          skin,
          28,
          20,
          0.9,
        ),
      );
    } else
      armMeshes.push(
        tube(
          rider,
          [
            sleeveRoot,
            sleeveBlend,
            sleeveArmhole,
            garmentShoulder,
            V(garmentShoulder).lerp(V(elbow), 0.38).toArray() as Point,
            V(garmentShoulder).lerp(V(elbow), 0.72).toArray() as Point,
            elbow,
            V(elbow).lerp(V(wrist), 0.4).toArray() as Point,
            wrist,
          ],
          [
            rootRadius,
            blendRadius,
            armholeRadius,
            shoulderRadius,
            (outerwear ? 0.084 : 0.088) * volume,
            (outerwear ? 0.081 : 0.085) * volume,
            (outerwear ? 0.076 : 0.076) * volume,
            (outerwear ? 0.069 : 0.07) * volume,
            0.045,
          ],
          hoodie
            ? applyRibbedTrim(
                upper?.handle === 'racing-zipper'
                  ? sleeveMaterial(upper, player, color, side)
                  : cloth.clone(),
                'cuff',
              )
            : cloth,
          36,
          20,
          0.94,
          side,
        ),
      );
    // T-shirt seam is now closed by hidden sleeve/torso overlap.    if (tee) moveTeeShoulderForward(armMeshes[0], 24, 24);

    if (tee)
      trimTeeSleeveTorsoOverlap(
        armMeshes[0],
        24,
        24,
        side as -1 | 1,
      );

    sleeveFolds(
      armMeshes[0],
      tee ? 24 : 36,
      tee ? 24 : 20,
      tee,
      (tee || outerwear) ? 0 : 0.06,
    );
    shapeArmholeInward(
      armMeshes[0],
      tee ? 24 : 36,
      tee ? 24 : 20,
      side as -1 | 1,
      tee ? 0.036 : outerwear ? 0.04 : 0.022,
    );
    flattenShoulderTop(
      armMeshes[0],
      tee ? 24 : 36,
      tee ? 24 : 20,
    );
    smoothOuterSleeveContour(
      armMeshes[0],
      tee ? 24 : 36,
      tee ? 24 : 20,
      side as -1 | 1,
    );
    fairShoulder(armMeshes[0], tee ? 24 : 36, tee ? 24 : 20);
    if (upper && !tee && !outerwear) {
      const seams = sleeveSeams(
        armMeshes[0],
        tee ? 24 : 36,
        tee ? 24 : 20,
        stitching,
      );
      seams.forEach((seam) => rider.add(seam));
      armMeshes.push(...seams);
    }

    // Reduce dark crease artifacts on clothing arms only.
    // Torso, gloves, rider, bike and environment keep normal shadows.
    for (const garmentArmMesh of armMeshes) {
      garmentArmMesh.castShadow = false;
      garmentArmMesh.receiveShadow = false;
    }

    // The cuff overlaps the glove, which curls around the actual grip center.
    tube(
      rider,
      [
        wrist,
        [wrist[0], pose.grip[1] + 0.044, pose.grip[2]],
        [wrist[0], pose.grip[1] + 0.016, pose.grip[2] - 0.036],
        [wrist[0], pose.grip[1] - 0.019, pose.grip[2] - 0.006],
      ],
      [0.045, 0.046, 0.04, 0.03],
      boot,
      20,
      18,
      0.85,
    );
    const hip: Point = [
        side * RIDER_DIMENSIONS.hipHalf,
        pose.hip[1] - 0.01,
        pose.hip[2],
      ],
      knee: Point = [side * pose.knee[0], pose.knee[1], pose.knee[2]],
      ankle: Point = [side * pose.ankle[0], pose.ankle[1], pose.ankle[2]];
    const leg = tube(
      rider,
      [
        hip,
        V(hip).lerp(V(knee), 0.65).toArray() as Point,
        knee,
        V(knee).lerp(V(ankle), 0.5).toArray() as Point,
        ankle,
      ],
      [0.116, 0.11, 0.092, 0.096, 0.085],
      pants,
      40,
      20,
      0.96,
    );
    const lp = leg.geometry.getAttribute('position');
    for (let ring = 0; ring <= 40; ring++) {
      const t = ring / 40,
        c = new THREE.Vector3();
      for (let j = 0; j <= 20; j++)
        c.add(new THREE.Vector3().fromBufferAttribute(lp, ring * 21 + j));
      c.divideScalar(21);
      const fold =
        0.09 *
        Math.sin(t * 70) *
        (Math.exp(-(((t - 0.5) / 0.13) ** 2)) +
          0.7 * Math.exp(-(((t - 0.91) / 0.08) ** 2)));
      for (let j = 0; j <= 20; j++) {
        const k = ring * 21 + j,
          p = new THREE.Vector3()
            .fromBufferAttribute(lp, k)
            .sub(c)
            // Only the hidden trouser cloth at the hip narrows under the top.
            // The thigh centerline and immutable hip joint do not move.
            .multiplyScalar(
              (1 + fold) * (1 - 0.3 * Math.max(0, 1 - t / 0.12) ** 2),
            )
            .add(c);
        lp.setXYZ(k, p.x, p.y, p.z);
      }
    }
    leg.geometry.computeVertexNormals();
    const index = side === -1 ? 0 : 1;
    limbs.push({
      arm: skinGarmentArm(
        armMeshes,
        rest.limbs[index].arm,
        {
          hip: rest.hip,
          lean: rest.lean,
          roll: rest.roll,
        },
        outerwear,
        tee,
      ),
      leg: skinLimb(rider, [leg], rest.limbs[index].leg),
    });
    const foot = loft(
      rider,
      [
        [pose.peg[2] - 0.15, 0.022, 0.025, pose.peg[1] + 0.048],
        [pose.peg[2] - 0.075, 0.055, 0.039, pose.peg[1] + 0.049],
        [pose.peg[2] + 0.082, 0.058, 0.072, pose.peg[1] + 0.075],
        [pose.peg[2] + 0.14, 0.031, 0.04, pose.peg[1] + 0.085],
      ],
      boot,
      'z',
      20,
    );
    foot.position.x = side * pose.peg[0];
    foot.name = 'rider-boot';
  }
  const neck = tube(
    rider,
    [
      [0, pose.shoulder[1] + 0.04, pose.shoulder[2]],
      [0, pose.head[1] - 0.1, pose.head[2]],
    ],
    [0.055, 0.055],
    boot,
    12,
    20,
  );
  const helmet = makeHelmet(
    rider,
    pose.head,
    player.helmet,
    player.helmetColor,
  );
  const accessory = products.find((p) => p.id === player.equipped.accessory);
  if (accessory?.handle === 'logo-crossbody-tasche') {
    addCleanCrossbody(torsoGroup, accessoryMaterial(accessory, player, productColor(accessory)));
  }
  let capMotion: ReturnType<typeof createCarriedCapMotion> | undefined;
  const cap = products.find((p) => p.id === player.equipped.head);
  if (cap) {
    const capM = material(productColor(cap), 0, 0.97),
      group = new THREE.Group(),
      pivot = new THREE.Group();
    pivot.position.set(-0.25, pose.hip[1] + 0.015, pose.hip[2] + 0.035);
    pivot.name = 'carried-cap-pivot';
    pelvis.add(pivot);
    const clip = mesh(
      pelvis,
      new THREE.TorusGeometry(0.017, 0.0035, 8, 24),
      material('#aeb6b8', 0.8, 0.28),
    );
    clip.name = 'cap-belt-clip';
    clip.position.copy(pivot.position);
    rod(
      pelvis,
      [-0.205, pose.hip[1] + 0.043, pose.hip[2] + 0.035],
      [-0.25, pose.hip[1] + 0.029, pose.hip[2] + 0.035],
      0.006,
      boot,
    ).name = 'cap-belt-loop';
    // Hang from the rear adjustment strap. The crown faces out from the hip;
    // the unchanged curved brim hangs below it, clear of the rider's leg.
    group.position.set(0, -0.118, 0);
    group.name = 'carried-cap';
    group.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    pivot.add(group);
    rod(group, [-0.032, 0, 0.1], [0.032, 0, 0.1], 0.005, capM).name =
      'cap-adjustment-strap';
    loft(
      group,
      [
        [0, 0.103, 0.1, 0],
        [0.045, 0.1, 0.095, 0],
        [0.1, 0.07, 0.065, 0],
        [0.12, 0.012, 0.013, 0],
      ],
      accessoryMaterial(cap, player, productColor(cap)),
    );
    const brimVertices: number[] = [],
      brimIndices: number[] = [];
    const rows = 14,
      cols = 24;
    for (let i = 0; i <= rows; i++)
      for (let j = 0; j <= cols; j++) {
        const t = i / rows,
          u = (j / cols) * 2 - 1;
        brimVertices.push(
          u * (0.108 - 0.018 * t),
          -0.025 * u * u - 0.014 * t,
          -0.045 - t * (0.19 - 0.06 * u * u),
        );
      }
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++) {
        const a = i * (cols + 1) + j,
          b = a + cols + 1;
        brimIndices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    const brimGeometry = new THREE.BufferGeometry();
    brimGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(brimVertices, 3),
    );
    brimGeometry.setIndex(brimIndices);
    capM.side = THREE.DoubleSide;
    mesh(group, brimGeometry, capM).name = 'curved-cap-brim';
    capMotion = createCarriedCapMotion(pivot);
  }
  rider.userData.skeleton = RIDER_DIMENSIONS;
  const motion: Required<RiderMotion> = {
    wheelie: 0,
    steer: 0,
    landing: 0,
    forward: 0,
    launch: 0,
    balance: 0,
    load: 0,
    road: 0,
  };
  const animate = (target: RiderMotion, dt: number) => {
    for (const key of [
      'wheelie',
      'steer',
      'landing',
      'forward',
      'launch',
      'balance',
      'load',
      'road',
    ] as const) {
      const blend =
        1 - Math.exp(-(key === 'launch' || key === 'landing' ? 20 : 12) * dt);
      motion[key] += ((target[key] ?? 0) - motion[key]) * blend;
    }
    const current = riderMotionPose(pose, motion);
    torsoGroup.position.set(...current.hip);
    torsoGroup.rotation.set(-current.lean, 0, current.roll);
    pelvis.position.set(
      current.hip[0] - pose.hip[0],
      current.hip[1] - pose.hip[1],
      current.hip[2] - pose.hip[2],
    );
    neck.position.set(
      current.shoulder[0] - pose.shoulder[0],
      current.shoulder[1] - pose.shoulder[1],
      current.shoulder[2] - pose.shoulder[2],
    );
    helmet.position.set(...current.head);
    helmet.rotation.set(
      -0.07 - motion.wheelie * 0.16 + motion.balance * 0.025,
      0,
      motion.steer * 0.055,
    );
    current.limbs.forEach((limb, i) => {
      limbs[i].arm(limb.arm, {
        hip: current.hip,
        lean: current.lean,
        roll: current.roll,
      });
      limbs[i].leg(limb.leg);
    });
  };
  const animateAccessories = (input: CarriedCapMotionInput, dt: number) =>
    capMotion?.update(input, dt);
  return { group: rider, animate, animateAccessories };
}
