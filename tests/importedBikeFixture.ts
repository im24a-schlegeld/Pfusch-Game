import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Texture } from 'three';
import {
  installImportedBikeAsset,
  type ImportedBikeId,
  type ImportedBikeManifest,
} from '../app/game/importedBikeAsset';

const directories: Record<ImportedBikeId, string> = { '450': 'fs450', '701': 'r6', scooter: 'nitro' };
const installed = new Set<ImportedBikeId>();

/** Use the shipped models in Node tests; only GPU image decoding is replaced. */
export function installImportedBikeFixtures(ids: readonly ImportedBikeId[] = ['450', '701', 'scooter']) {
  for (const id of ids) {
    if (installed.has(id)) continue;
    const manifestUrl = new URL(`../public/models/${directories[id]}/model.json`, import.meta.url);
    const manifest = JSON.parse(readFileSync(fileURLToPath(manifestUrl), 'utf8')) as ImportedBikeManifest;
    const bytes = readFileSync(fileURLToPath(new URL(manifest.binary, manifestUrl)));
    const paths = new Set(manifest.materials.flatMap(material =>
      [material.map, material.normalMap, material.alphaMap].filter((path): path is string => Boolean(path))));
    const textures = new Map([...paths].map(path => {
      const texture = new Texture();
      texture.name = path;
      texture.userData.importedAssetCache = true;
      return [path, texture] as const;
    }));
    installImportedBikeAsset(id, { manifest, binary: new Uint8Array(bytes).buffer, textures });
    installed.add(id);
  }
}
