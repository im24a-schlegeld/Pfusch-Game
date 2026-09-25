import * as THREE from 'three';

/**
 * Schmaler Blitzer als prozedurales Three.js-Modell, ohne externe Assets.
 * +Y = oben, +Z = Sensor-/Vorderseite. Ursprung mittig auf dem Boden.
 * Die Dachkante steigt IN DER VORDERANSICHT von links (-X) nach rechts (+X).
 * Die Masse sind aus den Fotos angenaehert, keine Herstellerangaben.
 */
export interface BlitzerModelOptions {
  /** Einheitliche Skalierung; Standard: 1 (ungefaehre Meter). */
  scale?: number;
  /** Optionale Gehaeusefarbe. */
  color?: THREE.ColorRepresentation;
}

const D = Object.freeze({
  baseWidth: 0.94,
  baseDepth: 0.82,
  baseHeight: 1.09,
  shoulderHeight: 0.155,
  towerWidth: 0.31,
  towerDepth: 0.45,
  towerBodyHeight: 1.05,
  roofWidth: 0.318,
  roofDepth: 0.458,
  roofLeftHeight: 0.045,
  // Steigung der gelben Referenzlinie: 0.27507 = etwa 15.38 Grad.
  roofRise: 0.0874716611,
});

const FINISHES = {
  housing: { color: 0x989fa8, roughness: 0.78, metalness: 0.12 },
  panel:   { color: 0x9299a2, roughness: 0.81, metalness: 0.10 },
  seam:    { color: 0x41484f, roughness: 0.88, metalness: 0.00 },
  black:   { color: 0x161b20, roughness: 0.72, metalness: 0.03 },
  glass:   { color: 0x33434c, roughness: 0.27, metalness: 0.14 },
} as const;

type Finish = keyof typeof FINISHES;
type V3 = readonly [number, number, number];
interface Part {
  name: string;
  finish: Finish;
  vertices: number[];
  uvs: number[];
}

/** Geschlossener Koerper mit harten, nach aussen gerichteten Flaechen. */
function solid(name: string, points: readonly V3[], finish: Finish): Part {
  // Je vier Eckpunkte unten / oben: hinten links, hinten rechts,
  // vorne rechts, vorne links. Die oberen Y-Werte duerfen variieren.
  const faces = [
    [0, 1, 2, 3], // unten (-Y)
    [4, 7, 6, 5], // oben (+Y)
    [0, 4, 5, 1], // hinten (-Z)
    [1, 5, 6, 2], // rechts (+X)
    [2, 6, 7, 3], // vorne (+Z)
    [3, 7, 4, 0], // links (-X)
  ] as const;
  const vertices: number[] = [];
  const uvs: number[] = [];
  const quadUV = [[0, 0], [0, 1], [1, 1], [1, 0]] as const;
  for (const face of faces) {
    for (const i of [0, 1, 2, 0, 2, 3] as const) {
      vertices.push(...points[face[i]]!);
      uvs.push(...quadUV[i]);
    }
  }
  return { name, finish, vertices, uvs };
}

function block(name: string, size: V3, center: V3, finish: Finish): Part {
  const w = size[0]/2, h = size[1]/2, d = size[2]/2;
  const [x, y, z] = center;
  return solid(name, [
    [x-w, y-h, z-d], [x+w, y-h, z-d],
    [x+w, y-h, z+d], [x-w, y-h, z+d],
    [x-w, y+h, z-d], [x+w, y+h, z-d],
    [x+w, y+h, z+d], [x-w, y+h, z+d],
  ], finish);
}

/** Gemeinsame, rein numerische Geometrie fuer Modell und Vorschau. */
function buildParts(): Part[] {
  const p: Part[] = [];
  const add = (name: string, size: V3, center: V3, finish: Finish) =>
    p.push(block(name, size, center, finish));
  const towerY = D.baseHeight + D.shoulderHeight;
  const roofY = towerY + D.towerBodyHeight;
  const front = D.towerDepth / 2;

  add('BaseCabinet', [D.baseWidth, D.baseHeight, D.baseDepth],
    [0, D.baseHeight/2, 0], 'housing');
  // Nur die grosse Wartungstuer und der Griff; keine Schrauben oder Kleinteile.
  add('BaseDoorSeam', [0.869, 1.023, 0.003],
    [0, 0.545, D.baseDepth/2 + 0.0015], 'seam');
  add('BaseDoor', [0.861, 1.015, 0.005],
    [0, 0.545, D.baseDepth/2 + 0.005], 'panel');
  add('BaseHandle', [0.205, 0.030, 0.024],
    [0, 0.941, D.baseDepth/2 + 0.0195], 'black');

  const bw = D.baseWidth/2, bd = D.baseDepth/2;
  const tw = D.towerWidth/2, td = D.towerDepth/2;
  p.push(solid('Shoulder', [
    [-bw, D.baseHeight, -bd], [bw, D.baseHeight, -bd],
    [bw, D.baseHeight, bd], [-bw, D.baseHeight, bd],
    [-tw, towerY, -td], [tw, towerY, -td],
    [tw, towerY, td], [-tw, towerY, td],
  ], 'housing'));

  // Schlanke Saeule mit einer tatsaechlich zurueckgesetzten Sensoroeffnung.
  const recess = 0.027;
  const sensorW = 0.246;
  const sensorH = 0.432;
  const sensorTop = roofY - 0.025;
  const sensorBottom = sensorTop - sensorH;
  const sensorY = (sensorTop + sensorBottom)/2;
  const railW = (D.towerWidth - sensorW)/2;
  add('TowerBackAndSides', [D.towerWidth, D.towerBodyHeight, D.towerDepth-recess],
    [0, towerY+D.towerBodyHeight/2, -recess/2], 'housing');
  for (const side of [-1, 1]) {
    add(side < 0 ? 'TowerLeftRail' : 'TowerRightRail',
      [railW, D.towerBodyHeight, recess],
      [side*(D.towerWidth/2-railW/2), towerY+D.towerBodyHeight/2, front-recess/2],
      'housing');
  }
  add('TowerTopFrame', [sensorW, roofY-sensorTop, recess],
    [0, (roofY+sensorTop)/2, front-recess/2], 'housing');
  add('TowerLowerFront', [sensorW, sensorBottom-towerY, recess],
    [0, (sensorBottom+towerY)/2, front-recess/2], 'housing');
  add('SensorRecess', [sensorW, sensorH, 0.004],
    [0, sensorY, front-recess+0.002], 'black');
  add('UpperOpticMount', [0.166, 0.134, 0.005],
    [0, sensorY+0.096, front-recess+0.0065], 'seam');
  add('UpperOptic', [0.124, 0.085, 0.003],
    [0, sensorY+0.097, front-recess+0.0105], 'glass');
  add('LowerOptic', [0.166, 0.112, 0.004],
    [0, sensorY-0.108, front-recess+0.006], 'glass');
  // Kleine Sensorblende, unabhaengig von der schraegen oberen Dachkante.
  const vy = sensorY-0.009;
  const vz = front+0.024;
  p.push(solid('SensorVisor', [
    [-0.095, vy-0.018, front-recess], [0.095, vy-0.018, front-recess],
    [0.095, vy-0.009, vz], [-0.095, vy-0.009, vz],
    [-0.095, vy-0.010, front-recess], [0.095, vy-0.010, front-recess],
    [0.095, vy, vz], [-0.095, vy, vz],
  ], 'black'));

  const serviceH = 0.519;
  const serviceY = towerY + 0.288;
  add('TowerServiceSeam', [0.252, serviceH, 0.002],
    [0, serviceY, front+0.001], 'seam');
  add('TowerServiceDoor', [0.246, serviceH-0.006, 0.003],
    [0, serviceY, front+0.0035], 'panel');
  add('TowerHandle', [0.026, 0.173, 0.017],
    [-0.084, serviceY-0.012, front+0.0135], 'black');

  // ECHTER KEIL: links niedriger, rechts hoeher. Kein gedrehter Quader,
  // kein Treppenprofil und keine blosse Neigung von vorne nach hinten.
  // Die Unterkante bleibt horizontal; die Seitenwaende bleiben senkrecht.
  const rw = D.roofWidth/2, rd = D.roofDepth/2;
  const left = roofY + D.roofLeftHeight;
  const right = left + D.roofRise;
  p.push(solid('SlopedRoof_LeftLow_RightHigh', [
    [-rw, roofY, -rd], [rw, roofY, -rd],
    [rw, roofY, rd], [-rw, roofY, rd],
    [-rw, left, -rd], [rw, right, -rd],
    [rw, right, rd], [-rw, left, rd],
  ], 'housing'));
  return p;
}

/** Erzeugt nur das Modell: keine Szene, Beleuchtung, Animation oder Spiellogik. */
export function createBlitzerModel(options: BlitzerModelOptions = {}): THREE.Group {
  const scale = options.scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError('BlitzerModel: scale muss endlich und groesser als 0 sein.');
  }
  const root = new THREE.Group();
  root.name = 'Blitzer';
  const materials = new Map<Finish, THREE.MeshStandardMaterial>();
  for (const key of Object.keys(FINISHES) as Finish[]) {
    const material = new THREE.MeshStandardMaterial({ ...FINISHES[key] });
    material.name = `Blitzer_${key}`;
    if (options.color !== undefined && (key === 'housing' || key === 'panel')) {
      material.color.set(options.color);
      if (key === 'panel') material.color.multiplyScalar(0.95);
    }
    materials.set(key, material);
  }
  for (const part of buildParts()) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(part.vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(part.uvs, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materials.get(part.finish)!);
    mesh.name = part.name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  // The black sensor recess gets a separate emissive-looking flash plane.
  // It stays dark until the deterministic game event triggers the camera.
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.16, 0.11),
    new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  flash.name = 'BlitzerFlash';
  flash.position.set(0, 2.01, D.towerDepth / 2 + 0.008);
  flash.userData.blitzerFlash = true;
  root.add(flash);
  root.scale.setScalar(scale);
  root.userData.dimensions = {
    width: D.baseWidth*scale,
    depth: (D.baseDepth+0.0315)*scale,
    height: (D.baseHeight+D.shoulderHeight+D.towerBodyHeight+D.roofLeftHeight+D.roofRise)*scale,
  };
  root.userData.roofSlope = {
    axis: 'X', lowSide: '-X', highSide: '+X',
    angleDegrees: Math.atan2(D.roofRise, D.roofWidth)*180/Math.PI,
  };
  return root;
}

/** Ressourcen des Modells freigeben, wenn es endgueltig entfernt wird. */
export function disposeBlitzerModel(model: THREE.Group): void {
  const materials = new Set<THREE.Material>();
  model.traverse((object: THREE.Object3D) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) materials.add(material);
  });
  for (const material of materials) material.dispose();
}

export default createBlitzerModel;
