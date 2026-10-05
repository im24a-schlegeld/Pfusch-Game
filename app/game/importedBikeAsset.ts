import * as THREE from 'three';
import type { BikeModelId } from './vehicleScale';

export type ImportedBikeId = Exclude<BikeModelId, '125'>;
export type ImportedPoint = [number, number, number];
export interface ImportedBikeAttribute { offset: number; count: number }
export interface ImportedBikePart {
  name: string;
  rig: 'body' | 'steering' | 'fork' | 'rearWheel' | 'frontWheel' | 'swingarm' | 'shockUpper' | 'shockLower';
  material: number | string;
  paintable?: boolean;
  position: ImportedBikeAttribute;
  normal?: ImportedBikeAttribute;
  uv?: ImportedBikeAttribute;
  index: ImportedBikeAttribute;
}
export interface ImportedBikeMaterial {
  name: string;
  color: string | number | [number, number, number];
  metalness: number;
  roughness: number;
  map?: string;
  normalMap?: string;
  alphaMap?: string;
  opacity?: number;
  doubleSided?: boolean;
  paintable?: boolean;
  rim?: boolean;
}
export interface ImportedBikeAnchors {
  frontAxle: ImportedPoint;
  rearAxle: ImportedPoint;
  frontRadius: number;
  rearRadius: number;
  pivot: ImportedPoint;
  shockTop: ImportedPoint;
  shockBottom: ImportedPoint;
  grip: ImportedPoint;
  peg: ImportedPoint;
  hip: ImportedPoint;
  exhaust: ImportedPoint;
  tail: ImportedPoint;
  headlight?: ImportedPoint;
  headlights?: ImportedPoint[];
  steeringPivot?: ImportedPoint;
  steeringAxis?: ImportedPoint;
}
export interface ImportedBikeManifest {
  version: 1;
  binary: string;
  parts: ImportedBikePart[];
  materials: ImportedBikeMaterial[];
  anchors: ImportedBikeAnchors;
}
export interface ImportedBikeAsset {
  manifest: ImportedBikeManifest;
  binary: ArrayBuffer;
  textures: ReadonlyMap<string, THREE.Texture>;
}

const urls: Record<ImportedBikeId, string> = {
  '450': '/models/fs450/model.json',
  '701': '/models/r6/model.json',
  scooter: '/models/nitro/model.json',
};
const assets = new Map<ImportedBikeId, ImportedBikeAsset>();
const pending = new Map<ImportedBikeId, Promise<void>>();

export function isImportedBike(id: string): id is ImportedBikeId {
  return id === '450' || id === '701' || id === 'scooter';
}
export function importedBikeReady(id: string) {
  return !isImportedBike(id) || assets.has(id);
}
export function getImportedBikeAsset(id: ImportedBikeId): ImportedBikeAsset {
  const asset = assets.get(id);
  if (!asset) throw new Error(`Motorradmodell ${id} ist noch nicht geladen.`);
  return asset;
}

/** CPU data survives scene disposal; each vehicle owns its GPU geometry/materials. */
export function preloadImportedBike(id: string): Promise<void> {
  if (!isImportedBike(id) || assets.has(id)) return Promise.resolve();
  const existing = pending.get(id);
  if (existing) return existing;
  const promise = (async () => {
    const manifestUrl = new URL(urls[id], window.location.href);
    const response = await fetch(manifestUrl);
    if (!response.ok) throw new Error(`Motorradmodell konnte nicht geladen werden (${response.status}).`);
    const manifest = await response.json() as ImportedBikeManifest;
    if (manifest.version !== 1 || !Array.isArray(manifest.parts) || !manifest.parts.length)
      throw new Error('Das Motorradmodell hat ein ungültiges Format.');
    // Paint and rims are real configurable materials; their old decal atlases
    // are not fetched after the user requested unprinted bodywork.
    const texturePaths = new Set(manifest.materials.flatMap((material) => {
      const plain = material.paintable ?? /livery|paint|fairing|bodywork/i.test(material.name);
      const rim = material.rim ?? /(^|[_\s-])rims?(?=\d|$|[_\s-])/i.test(material.name);
      return [plain || rim ? undefined : material.map, material.normalMap, material.alphaMap]
        .filter((path): path is string => Boolean(path));
    }));
    const loader = new THREE.TextureLoader();
    const [binary, textureEntries] = await Promise.all([
      fetch(new URL(manifest.binary, manifestUrl)).then(async (result) => {
        if (!result.ok) throw new Error(`Motorradgeometrie konnte nicht geladen werden (${result.status}).`);
        return result.arrayBuffer();
      }),
      Promise.all([...texturePaths].map(async (path) => {
        const texture = await loader.loadAsync(new URL(path, manifestUrl).href);
        // These UVs come directly from USD; unlike glTF, they retain Three's image flip.
        texture.flipY = true;
        texture.userData.importedAssetCache = true;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = manifest.materials.some((material) => material.map === path)
          ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        return [path, texture] as const;
      })),
    ]);
    for (const part of manifest.parts) {
      for (const [attribute, width, bytes] of [
        [part.position, 3, 4], [part.normal, 3, 4], [part.uv, 2, 4], [part.index, 1, 2],
      ] as const) {
        if (attribute && (!Number.isInteger(attribute.count) || attribute.count < 1 ||
          attribute.offset < 0 || attribute.offset + attribute.count * width * bytes > binary.byteLength))
          throw new Error(`Ungültiger Geometriebereich: ${part.name}`);
      }
    }
    assets.set(id, { manifest, binary, textures: new Map(textureEntries) });
  })().catch((error: unknown) => {
    pending.delete(id);
    throw error;
  });
  pending.set(id, promise);
  return promise;
}

/** Offline QA may seed the same immutable CPU asset without browser fetch/image APIs. */
export function installImportedBikeAsset(id: ImportedBikeId, asset: ImportedBikeAsset) {
  assets.set(id, asset);
}
