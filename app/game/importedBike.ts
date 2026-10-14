import * as THREE from 'three';
import type { Player, Product } from '../domain/types';
import { BIKE_MODEL_SCALES } from './vehicleScale';
import { BIKE_CONTACTS, resolveRiderPose, type RiderPose, type Point } from './riderSkeleton';
import type { RiderMotion } from './riderMotion';
import { nextHandlebarAngle } from './bikeMotion';
import type { RagdollPose } from './ragdoll';
import type { CarriedCapMotionInput } from './carriedCapMotion';
import { addIgnitionKey, updateCrossbodyMotion } from './vehicleAccessories';
import { getImportedBikeAsset, type ImportedBikeId, type ImportedBikeMaterial } from './importedBikeAsset';
import { IMPORTED_BIKE_WHEELBASE } from './importedBikeDimensions';
import { createImportedHardwareFinisher } from './importedHardwareFinish';
import { tagImportedSupermotoMudflap } from './supermotoMudflap';

interface ImportedRiderController {
  group: THREE.Group;
  animate(input: RiderMotion, dt: number): void;
  animateAccessories(input: CarriedCapMotionInput, dt: number): void;
  captureRagdollPose(): RagdollPose;
  applyRagdollPose(pose: RagdollPose): void;
}
type RiderFactory = (parent: THREE.Object3D, pose: RiderPose, player: Player, products: Product[]) => ImportedRiderController;
const xAxis = new THREE.Vector3(1, 0, 0);
const nominalLean: Record<ImportedBikeId, number> = { '125': 0.16, moped: 0.25, '450': 0.42, '701': 0.88, scooter: 0.25 };

/** Source meshes retain their shape; only one uniform vehicle-size conversion is applied. */
export function makeImportedBike(player: Player, products: Product[], makeRider: RiderFactory) {
  const id = player.bike as ImportedBikeId;
  const { manifest, binary, textures } = getImportedBikeAsset(id);
  const source = manifest.anchors;
  const size = IMPORTED_BIKE_WHEELBASE[id] / Math.abs(source.rearAxle[2] - source.frontAxle[2]);
  const modelScale = BIKE_MODEL_SCALES[id];
  const point = (value: Point) => new THREE.Vector3(...value).multiplyScalar(size);
  const frontCenter = point(source.frontAxle), rearCenter = point(source.rearAxle);
  const frontRadius = source.frontRadius * size, rearRadius = source.rearRadius * size;
  const pivot = point(source.pivot);
  const root = new THREE.Group();
  root.scale.setScalar(1.45);
  const body = new THREE.Group();
  body.scale.setScalar(modelScale);
  body.name = 'imported-motorcycle';
  body.userData.importedBike = id;
  root.add(body);
  const steering = new THREE.Group();
  steering.name = 'imported-steering';
  steering.matrixAutoUpdate = false;
  const frontAssembly = new THREE.Group(), rearAssembly = new THREE.Group(), shock = new THREE.Group();
  frontAssembly.name = 'front-suspension-axle';
  rearAssembly.name = 'rear-suspension-axle';
  shock.name = 'active-rear-shock';
  body.add(steering, rearAssembly, shock);
  steering.add(frontAssembly);
  const frontWheel = new THREE.Group(), rearWheel = new THREE.Group();
  frontWheel.name = 'front-wheel'; rearWheel.name = 'rear-wheel';
  frontWheel.position.copy(frontCenter); rearWheel.position.copy(rearCenter);
  frontWheel.userData.rollingRadius = frontRadius * modelScale * root.scale.x;
  rearWheel.userData.rollingRadius = rearRadius * modelScale * root.scale.x;
  frontAssembly.add(frontWheel); rearAssembly.add(rearWheel);
  const wheels = [frontWheel, rearWheel];
  const materials = manifest.materials.map((definition: ImportedBikeMaterial) => {
    const color = Array.isArray(definition.color)
      ? new THREE.Color().fromArray(definition.color) : new THREE.Color(definition.color);
    const paintable = definition.paintable ?? /livery|paint|fairing|bodywork/i.test(definition.name);
    const rimMaterial = definition.rim ?? /(^|[_\s-])rims?(?=\d|$|[_\s-])/i.test(definition.name);
    const tireMaterial = /tyre|tire/i.test(definition.name);
    if (paintable) color.set(player.paint);
    if (rimMaterial) color.set(player.rims);
    if (tireMaterial) color.set(id === '450' ? '#090909' : '#16181a');
    const material = new THREE.MeshStandardMaterial({
      name: definition.name, color,
      metalness: tireMaterial ? 0 : definition.metalness,
      roughness: tireMaterial ? 1 : definition.roughness,
      envMapIntensity: tireMaterial && id === '450' ? 0 : 1,
      map: !paintable && !rimMaterial && !tireMaterial && definition.map ? textures.get(definition.map) ?? null : null,
      normalMap: definition.normalMap ? textures.get(definition.normalMap) ?? null : null,
      alphaMap: definition.alphaMap ? textures.get(definition.alphaMap) ?? null : null,
      opacity: definition.opacity ?? 1,
      transparent: (definition.opacity ?? 1) < 1,
      side: definition.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    });
    material.userData.rimPalette = rimMaterial;
    // Perforated discs retain their actual edge contours. Their authored
    // bevel normals must not turn into camera-angle black surface fragments.
    material.userData.importedWheelHardware = /brake_(steel|carrier|friction_steel|dark_carrier)$/.test(definition.name);
    material.userData.rimTireBand = id === 'scooter' && rimMaterial;
    return material;
  });
  const materialByName = new Map(manifest.materials.map((definition, index) => [definition.name, materials[index]]));
  const finishHardware = createImportedHardwareFinisher(id, binary, player.paint);
  for (const part of manifest.parts) {
    const geometry = new THREE.BufferGeometry();
    // Copy once: cached CPU buffers are immutable and scene disposal stays local.
    geometry.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array(binary, part.position.offset, part.position.count * 3).slice(), 3));
    if (part.normal) geometry.setAttribute('normal', new THREE.BufferAttribute(
      new Float32Array(binary, part.normal.offset, part.normal.count * 3).slice(), 3));
    if (part.uv) geometry.setAttribute('uv', new THREE.BufferAttribute(
      new Float32Array(binary, part.uv.offset, part.uv.count * 2).slice(), 2));
    geometry.setIndex(new THREE.BufferAttribute(
      new Uint16Array(binary, part.index.offset, part.index.count).slice(), 1));
    geometry.scale(size, size, size);
    let parent: THREE.Group = body;
    if (part.rig === 'frontWheel') { parent = frontWheel; geometry.translate(-frontCenter.x, -frontCenter.y, -frontCenter.z); }
    else if (part.rig === 'rearWheel') { parent = rearWheel; geometry.translate(-rearCenter.x, -rearCenter.y, -rearCenter.z); }
    else if (part.rig === 'fork') parent = frontAssembly;
    else if (part.rig === 'steering') parent = steering;
    else if (part.rig === 'swingarm') parent = rearAssembly;
    else if (part.rig === 'shockUpper' || part.rig === 'shockLower') parent = shock;
    if (!part.normal) geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const material = typeof part.material === 'number' ? materials[part.material] : materialByName.get(part.material);
    if (!material) throw new Error(`Unbekanntes Motorradmaterial: ${part.material}`);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = /tyre|tire/i.test(part.name) ? 'tire' : part.name;
    mesh.userData.importedRig = part.rig;
    mesh.userData.importedPart = part.name;
    const definition = typeof part.material === 'number' ? manifest.materials[part.material] : manifest.materials.find((candidate) => candidate.name === part.material);
    mesh.userData.bikePaintSurface = part.paintable ?? definition?.paintable ?? /livery|paint|fairing|bodywork/i.test(material.name);
    finishHardware(mesh, part);
    if (id === 'scooter' && material.userData.rimPalette && /Wheel$/.test(part.rig)) {
      // Nitro's outer lip and cast spokes share one authored mesh/material.
      // In the source frame its colored inner rings end at radius .166;
      // the outermost band begins at .178 and overlaps the tire at .1945.
      // Mask that band in the existing material pass, keeping the index order.
      const axle = part.rig === 'frontWheel' ? source.frontAxle : source.rearAxle;
      const positions = new Float32Array(binary, part.position.offset, part.position.count * 3);
      const band = new Float32Array(part.position.count);
      for (let i = 0; i < band.length; i++) {
        const radius = Math.hypot(positions[i * 3 + 1] - axle[1], positions[i * 3 + 2] - axle[2]);
        band[i] = THREE.MathUtils.smoothstep(radius, 0.166, 0.178);
      }
      geometry.setAttribute('cartoonRimTireBand', new THREE.BufferAttribute(band, 1));
    }
    mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh);
  }
  if (id === '450') tagImportedSupermotoMudflap(body);
  const exhaust = new THREE.Object3D();
  exhaust.name = 'open-silencer-outlet'; exhaust.position.copy(point(source.exhaust)); body.add(exhaust);
  body.userData.tailContact = point(source.tail).toArray();
  const lampPoints = source.headlights ?? [source.headlight ?? source.steeringPivot ?? source.grip];
  body.userData.headlightAnchors = lampPoints.map((position, index) => {
    const anchor = new THREE.Object3D();
    anchor.name = `imported-headlight-anchor-${index}`;
    anchor.position.copy(point(position));
    if (!source.headlight && !source.headlights) { anchor.position.y -= 0.15; anchor.position.z -= 0.07; }
    // Fairing lamps stay on the chassis; exposed fork/headset lamps steer.
    (id === '450' || id === '125' || id === 'moped' ? steering : body).add(anchor);
    return anchor;
  });
  const hip = point(source.hip).multiplyScalar(modelScale).toArray() as Point;
  // The scooter uses this imported path at runtime. Keep its actual seat
  // height and handlebar/peg anchors, but move the pelvis onto the rear half
  // of the saddle and use the same natural forward lean as the shared rider
  // contact definition. The skeleton and all limb lengths remain unchanged.
  const scooterRiderContact = id === 'scooter' ? BIKE_CONTACTS.scooter : undefined;
  if (scooterRiderContact) hip[2] = scooterRiderContact.hip[2];
  // An imported seat anchor is the upholstery surface, not the human hip joint.
  // The immutable trouser shell extends 92 mm below that joint. Measure the
  // actual saddle under the pelvis and put that shell on top of it.
  const seatMeshes: THREE.Mesh[] = [];
  body.traverse((object) => {
    if (object instanceof THREE.Mesh && /seat|saddle/i.test(object.userData.importedPart ?? object.name)) seatMeshes.push(object);
  });
  let seatHeight = hip[1] / modelScale;
  if (seatMeshes.length) {
    body.updateWorldMatrix(true, true);
    const ray = new THREE.Raycaster(), origin = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0);
    const localHit = new THREE.Vector3();
    let measured = -Infinity;
    for (const x of [-0.04, 0, 0.04]) for (const dz of [-0.04, 0.01]) {
      origin.set(x, seatHeight + 0.5, hip[2] / modelScale + dz);
      body.localToWorld(origin);
      ray.set(origin, down);
      const hit = ray.intersectObjects(seatMeshes, false)[0];
      if (hit) measured = Math.max(measured, body.worldToLocal(localHit.copy(hit.point)).y);
    }
    if (Number.isFinite(measured)) seatHeight = measured;
  }
  hip[1] = seatHeight * modelScale + 0.095;
  body.userData.riderSeatContact = { surfaceY: seatHeight, pelvisY: hip[1] / modelScale };
  const grip = point(source.grip).multiplyScalar(modelScale).toArray() as Point;
  const peg = point(source.peg).multiplyScalar(modelScale).toArray() as Point;
  let pose: RiderPose | undefined;
  const riderLean = scooterRiderContact?.torsoLean ?? nominalLean[id];
  for (let step = 0; step <= 24 && !pose; step++) {
    for (const direction of step === 0 ? [1] : [1, -1]) {
      try {
        pose = resolveRiderPose({ hip, grip, peg, torsoLean: riderLean + direction * step * 0.025 });
        break;
      } catch (error) { if (!(error instanceof RangeError)) throw error; }
    }
  }
  if (!pose) throw new Error('Die Kontaktpunkte des importierten Motorrads liegen außerhalb der festen Fahreranatomie.');
  const rider = makeRider(body, pose, player, products);
  rider.group.scale.setScalar(1 / modelScale);
  const selectedKeychain = player.equipped.keychain ?? player.equipped.accessory;
  if (products.some(product => product.id === selectedKeychain && product.handle === 'schlusselanhanger')) {
    const ignitionSupport = new THREE.Object3D();
    ignitionSupport.name = 'imported-ignition-support';
    ignitionSupport.position.copy(point(source.steeringPivot ?? source.grip));
    // Put each barrel on its own cockpit: side of the top clamp on exposed
    // bars, left triple clamp on Sport, right inner leg shield on the scooter.
    const ignitionOffsets: Record<ImportedBikeId, Point> = {
      '125': [-0.045, 0.035, 0.025], moped: [-0.045, 0.012, 0.02],
      '450': [-0.06, 0.018, 0.028], '701': [-0.105, 0.018, 0.025],
      scooter: [0.12, -0.13, 0.09],
    };
    ignitionSupport.position.add(new THREE.Vector3(...ignitionOffsets[id]));
    // Find a real mounting surface only when an equipped keychain needs it.
    body.updateWorldMatrix(true, true);
    const inverseBody = body.matrixWorld.clone().invert();
    const supportPoint = new THREE.Vector3(), supportMatrix = new THREE.Matrix4();
    const triangle = new THREE.Triangle();
    const desiredSupport = ignitionSupport.position.clone();
    let nearestSupport = Infinity;
    body.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object.userData.importedRig !== (id === 'scooter' ? 'body' : 'steering')) return;
      supportMatrix.multiplyMatrices(inverseBody, object.matrixWorld);
      const positions = object.geometry.getAttribute('position');
      const index = object.geometry.index!;
      for (let vertex = 0; vertex < index.count; vertex += 3) {
        triangle.a.fromBufferAttribute(positions, index.getX(vertex)).applyMatrix4(supportMatrix);
        triangle.b.fromBufferAttribute(positions, index.getX(vertex + 1)).applyMatrix4(supportMatrix);
        triangle.c.fromBufferAttribute(positions, index.getX(vertex + 2)).applyMatrix4(supportMatrix);
        triangle.closestPointToPoint(desiredSupport, supportPoint);
        const distance = supportPoint.distanceToSquared(desiredSupport);
        if (distance < nearestSupport) {
          nearestSupport = distance;
          ignitionSupport.position.copy(supportPoint);
          ignitionSupport.userData.supportSurface = object.name;
          ignitionSupport.userData.supportParent = object.parent;
        }
      }
    });
    body.add(ignitionSupport);
    body.userData.ignitionSupport = ignitionSupport;
  }
  const key = addIgnitionKey(body, player, products, point(source.grip).toArray() as Point);
  const steeringPivot = point(source.steeringPivot ?? source.frontAxle);
  const steeringAxis = new THREE.Vector3(...(source.steeringAxis ?? [0, 0.93, 0.37] as Point)).normalize();
  const steerStart = new THREE.Matrix4().makeTranslation(steeringPivot.x, steeringPivot.y, steeringPivot.z);
  const steerEnd = new THREE.Matrix4().makeTranslation(-steeringPivot.x, -steeringPivot.y, -steeringPivot.z);
  const steerTurn = new THREE.Matrix4();
  const authoredWrists = [-1, 1].map((side) => new THREE.Vector3(side * pose.wrist[0], pose.wrist[1], pose.wrist[2]).divideScalar(modelScale));
  const gripPoint = new THREE.Vector3();
  const contactGrips: [Point, Point] = [[...pose.wrist], [...pose.wrist]];
  contactGrips[0][0] *= -1;
  pose.contactGrips = contactGrips;
  let steerAngle = 0;
  const shockTop = point(source.shockTop), shockBottom = point(source.shockBottom);
  const shockAxis = shockBottom.clone().sub(shockTop).normalize();
  const shockLength = shockTop.distanceTo(shockBottom);
  const basis = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), shockAxis));
  const inverseBasis = basis.clone().invert();
  const shockStart = new THREE.Matrix4().makeTranslation(shockTop.x, shockTop.y, shockTop.z);
  const shockEnd = new THREE.Matrix4().makeTranslation(-shockTop.x, -shockTop.y, -shockTop.z);
  const arm = rearCenter.clone().sub(pivot), armLength = Math.hypot(arm.y, arm.z);
  const rearPosition = new THREE.Vector3(), movedRear = new THREE.Vector3();
  const chassisPosition = new THREE.Vector3(), axlePosition = new THREE.Vector3();
  const movedShock = new THREE.Vector3(), shockDirection = new THREE.Vector3();
  const shockRotation = new THREE.Quaternion(), rotationMatrix = new THREE.Matrix4(), stretch = new THREE.Matrix4();
  shock.matrixAutoUpdate = false;
  const animateSuspension = (pitch: number, travel: number, wheelieLoad = 0) => {
    const frontTravel = THREE.MathUtils.clamp(travel / modelScale - wheelieLoad * 0.009, -0.025, id === '450' ? 0.125 : id === '125' ? 0.065 : 0.085);
    // The Ciao is a hardtail: its rear axle and frame remain one rigid assembly.
    const rearTravel = id === '125' ? 0 : THREE.MathUtils.clamp(travel / modelScale * 0.7 + wheelieLoad * 0.012, -0.025, 0.065);
    const movedY = THREE.MathUtils.clamp(arm.y + rearTravel, -armLength + 0.000001, armLength - 0.000001);
    const rearAngle = Math.atan2(Math.sqrt(armLength ** 2 - movedY ** 2), movedY) - Math.atan2(arm.z, arm.y);
    rearPosition.copy(pivot).sub(movedRear.copy(pivot).applyAxisAngle(xAxis, rearAngle));
    rearAssembly.rotation.x = rearAngle;
    rearAssembly.position.copy(rearPosition);
    rearAssembly.updateMatrix();
    movedRear.copy(rearCenter).applyMatrix4(rearAssembly.matrix);
    const chassisAngle = -(frontTravel - rearTravel) / (rearCenter.z - frontCenter.z);
    chassisPosition.copy(rearCenter).sub(movedRear.applyAxisAngle(xAxis, chassisAngle));
    axlePosition.copy(chassisPosition).negate().applyAxisAngle(xAxis, -chassisAngle);
    body.rotation.x = pitch + chassisAngle;
    body.position.copy(chassisPosition).applyAxisAngle(xAxis, pitch);
    body.position.y += rearCenter.y * (1 - Math.cos(pitch)) + rearCenter.z * Math.sin(pitch);
    body.position.multiplyScalar(modelScale);
    frontAssembly.rotation.x = -chassisAngle;
    frontAssembly.position.copy(axlePosition);
    if (shockLength > 0.0001) {
      movedShock.copy(shockBottom).applyMatrix4(rearAssembly.matrix);
      shockDirection.subVectors(movedShock, shockTop);
      const ratio = shockDirection.length() / shockLength;
      shockRotation.setFromUnitVectors(shockAxis, shockDirection.normalize());
      shock.matrix.copy(shockStart).multiply(rotationMatrix.makeRotationFromQuaternion(shockRotation))
        .multiply(basis).multiply(stretch.makeScale(1, ratio, 1)).multiply(inverseBasis).multiply(shockEnd);
      shock.matrixWorldNeedsUpdate = true;
    }
  };
  animateSuspension(0, 0);
  return {
    root, body, wheels, rider: rider.group,
    animateRider: (input: RiderMotion, dt: number) => {
      steerAngle = nextHandlebarAngle(steerAngle, input.handlebarSteer ?? input.steer, dt);
      steering.matrix.copy(steerStart).multiply(steerTurn.makeRotationAxis(steeringAxis, steerAngle)).multiply(steerEnd);
      steering.matrixWorldNeedsUpdate = true;
      for (let index = 0; index < authoredWrists.length; index++) {
        gripPoint.copy(authoredWrists[index]).applyMatrix4(steering.matrix).multiplyScalar(modelScale);
        gripPoint.toArray(contactGrips[index]);
      }
      rider.animate(input, dt);
    },
    captureRagdollPose: rider.captureRagdollPose,
    applyRagdollPose: rider.applyRagdollPose,
    animateCrashPose: (progress: number, side: number, dt: number) => rider.animate({ wheelie: 0, steer: 0, landing: 0, crash: progress, crashSide: side }, dt),
    animateAccessories: (input: CarriedCapMotionInput, dt: number) => {
      rider.animateAccessories(input, dt); updateCrossbodyMotion(rider.group, input, dt); key?.update(input, dt);
    },
    animateSuspension,
    wheelRadius: rearRadius * modelScale,
    rearAxle: rearCenter.z * modelScale,
  };
}
