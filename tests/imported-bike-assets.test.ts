import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ImportedBikeManifest, ImportedBikePart } from '../app/game/importedBikeAsset';

const models = ['fs450', 'nitro', 'r6'] as const;
const allowedRigs = new Set(['body', 'steering', 'fork', 'frontWheel', 'rearWheel', 'swingarm', 'shockUpper', 'shockLower']);
const assetRoot = fileURLToPath(new URL('../public/models/', import.meta.url));
type Statistics = { triangles: number; vertices: number; geometryBytes: number; meshes: number };
type Manifest = ImportedBikeManifest & { statistics: Statistics };

function loadModel(id: typeof models[number]) {
  const directory = resolve(assetRoot, id);
  const manifest = JSON.parse(readFileSync(resolve(directory, 'model.json'), 'utf8')) as Manifest;
  const file = readFileSync(resolve(directory, manifest.binary));
  const binary = new Uint8Array(file).buffer;
  return { directory, manifest, binary };
}

function positions(binary: ArrayBuffer, part: ImportedBikePart) {
  return new Float32Array(binary, part.position.offset, part.position.count * 3);
}

it('the Supermoto brake rings have real watertight through holes and distinct steel/carrier materials', () => {
  const { manifest, binary } = loadModel('fs450');
  const friction = manifest.materials.find(material => material.name === 'fs450_brake_friction_steel')!;
  const carrier = manifest.materials.find(material => material.name === 'fs450_brake_dark_carrier')!;
  expect(friction.map).toBeUndefined();
  expect(friction.color).not.toEqual(carrier.color);
  for (const rig of ['frontWheel', 'rearWheel']) {
    const part = manifest.parts.find(part => part.rig === rig && part.material === friction.name)!;
    const points = positions(binary, part);
    const welded = new Map<string, number>();
    const remap = new Uint32Array(part.position.count);
    for (let i = 0; i < part.position.count; i++) {
      const key = [0, 1, 2].map(axis => Math.round(points[i * 3 + axis] * 1e6)).join(',');
      if (!welded.has(key)) welded.set(key, welded.size);
      remap[i] = welded.get(key)!;
    }
    const indices = new Uint16Array(binary, part.index.offset, part.index.count);
    const edges = new Map<string, number>();
    for (let i = 0; i < indices.length; i += 3) for (let side = 0; side < 3; side++) {
      const a = remap[indices[i + side]], b = remap[indices[i + (side + 1) % 3]];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
    expect([...edges.values()].every(uses => uses === 2), rig).toBe(true);
    // A closed ring without bores has Euler characteristic zero. Multiple
    // handles prove actual holes through the solid, independent of its texture.
    const euler = welded.size - edges.size + indices.length / 3;
    expect(euler, rig).toBeLessThanOrEqual(-40);
  }
});

it('the Supermoto keeps its visible engine case, a recessed lamp assembly and plain matte tires within the mobile budget', () => {
  const { manifest, binary } = loadModel('fs450');
  expect(manifest.statistics.triangles).toBeLessThan(46000);
  const engine = manifest.parts.find(part => part.material === 'fs450_engine_case')!;
  // The authored main case/cylinder is preserved while its surrounding fittings
  // may be reduced. This prevents the earlier crumpled simplified engine shell.
  expect(engine.index.count / 3).toBe(8423);
  const lampParts = manifest.parts.filter(part => /headlight_(glass|reflector)/.test(String(part.material)));
  expect(lampParts).toHaveLength(2);
  expect(lampParts.every(part => part.rig === 'steering')).toBe(true);
  const lampPoints = lampParts.flatMap(part => Array.from(positions(binary, part)).filter((_, index) => index % 3 === 2));
  expect(Math.max(...lampPoints) - Math.min(...lampPoints)).toBeGreaterThan(.025);
  expect(manifest.anchors.headlight).toHaveLength(3);
  const tires = manifest.materials.filter(material => /tire|tyre/i.test(material.name));
  expect(tires).toHaveLength(1);
  expect(tires[0].map).toBeUndefined();
  expect(tires[0].metalness).toBe(0);
  expect(tires[0].roughness).toBe(1);
});

it('the Supermoto slick tires have continuous radial shading around their axles', () => {
  const { manifest, binary } = loadModel('fs450');
  for (const part of manifest.parts.filter(part => /tire/i.test(String(part.material)))) {
    const points = positions(binary, part);
    const normals = new Float32Array(binary, part.normal!.offset, part.normal!.count * 3);
    const axle = part.rig === 'frontWheel' ? manifest.anchors.frontAxle : manifest.anchors.rearAxle;
    let maximumTangent = 0;
    for (let i = 0; i < points.length; i += 3) {
      const y = points[i + 1] - axle[1], z = points[i + 2] - axle[2];
      // A smooth circular slick has no appreciable circumferential normal.
      // Incorrect USD normals caused alternating pale patches as it rotated.
      maximumTangent = Math.max(maximumTangent,
        Math.abs((normals[i + 2] * y - normals[i + 1] * z) / Math.hypot(y, z)));
    }
    expect(maximumTangent, part.name).toBeLessThan(.04);
  }
});

for (const id of models) describe(`Imported motorcycle asset: ${id}`, () => {
  it('ships a bounded static asset with local textures and valid material/rig assignments', () => {
    const { directory, manifest, binary } = loadModel(id);
    expect(manifest.version).toBe(1);
    expect(manifest.parts.length).toBeGreaterThanOrEqual(4);
    expect(manifest.parts.length).toBeLessThanOrEqual(90);
    expect(manifest.materials.length).toBeGreaterThan(0);
    const names = new Set(manifest.materials.map(material => material.name));
    expect(names.size).toBe(manifest.materials.length);
    const texturePaths = new Set<string>();
    for (const material of manifest.materials) {
      expect(Number.isFinite(material.metalness)).toBe(true);
      expect(Number.isFinite(material.roughness)).toBe(true);
      for (const texture of [material.map, material.normalMap, material.alphaMap]) {
        if (!texture) continue;
        const absolute = resolve(directory, texture);
        expect(absolute.startsWith(directory + sep), texture).toBe(true);
        expect(statSync(absolute).size, texture).toBeGreaterThan(0);
        texturePaths.add(absolute);
      }
    }
    for (const part of manifest.parts) {
      expect(allowedRigs.has(part.rig), part.name).toBe(true);
      expect(typeof part.material === 'number'
        ? manifest.materials[part.material] !== undefined : names.has(part.material), part.name).toBe(true);
      expect(part.name).not.toMatch(/paddock|workshop.?stand|montage.?st[aä]nder/i);
      // Animation is performed with small rigid groups; no skinning payload reaches the game.
      expect(part).not.toHaveProperty('skinIndex');
      expect(part).not.toHaveProperty('skinWeight');
      expect(part).not.toHaveProperty('joints');
    }
    const triangles = manifest.parts.reduce((sum, part) => sum + part.index.count / 3, 0);
    expect(triangles).toBeGreaterThan(1000);
    expect(triangles).toBeLessThanOrEqual(id === 'nitro' ? 30000 : 100000);
    expect(manifest.statistics.triangles).toBe(triangles);
    expect(manifest.statistics.geometryBytes).toBe(binary.byteLength);
    expect(manifest.statistics.meshes).toBe(manifest.parts.length);
    const bytes = binary.byteLength + [...texturePaths].reduce((sum, texture) => sum + statSync(texture).size, 0);
    expect(bytes).toBeLessThan(5 * 1024 * 1024);
  });

  it('decodes every mesh without invalid ranges, indices, normals or non-finite values', () => {
    const { manifest, binary } = loadModel(id);
    const intervals: { start: number; end: number; label: string }[] = [];
    for (const part of manifest.parts) {
      const vertexCount = part.position.count;
      expect(vertexCount, part.name).toBeGreaterThanOrEqual(3);
      expect(vertexCount, part.name).toBeLessThanOrEqual(65535);
      expect(part.index.count % 3, part.name).toBe(0);
      for (const [name, attribute, width, bytes] of [
        ['position', part.position, 3, 4], ['normal', part.normal, 3, 4],
        ['uv', part.uv, 2, 4], ['index', part.index, 1, 2],
      ] as const) {
        if (!attribute) continue;
        expect(Number.isInteger(attribute.offset), `${part.name}/${name}`).toBe(true);
        expect(Number.isInteger(attribute.count), `${part.name}/${name}`).toBe(true);
        expect(attribute.offset % 4, `${part.name}/${name}`).toBe(0);
        expect(attribute.offset).toBeGreaterThanOrEqual(0);
        expect(attribute.count).toBeGreaterThan(0);
        const end = attribute.offset + attribute.count * width * bytes;
        expect(end, `${part.name}/${name}`).toBeLessThanOrEqual(binary.byteLength);
        intervals.push({ start: attribute.offset, end, label: `${part.name}/${name}` });
        if (name !== 'index') {
          expect(attribute.count).toBe(vertexCount);
          const values = new Float32Array(binary, attribute.offset, attribute.count * width);
          expect(values.every(Number.isFinite), `${part.name}/${name}`).toBe(true);
        }
      }
      const indices = new Uint16Array(binary, part.index.offset, part.index.count);
      expect(indices.every(index => index < vertexCount), part.name).toBe(true);
      if (part.normal) {
        const normals = new Float32Array(binary, part.normal.offset, vertexCount * 3);
        let maximumError = 0;
        for (let i = 0; i < normals.length; i += 3)
          maximumError = Math.max(maximumError, Math.abs(Math.hypot(normals[i], normals[i + 1], normals[i + 2]) - 1));
        expect(maximumError, part.name).toBeLessThan(0.002);
      }
    }
    intervals.sort((a, b) => a.start - b.start);
    for (let i = 1; i < intervals.length; i++)
      expect(intervals[i].start, intervals[i].label).toBeGreaterThanOrEqual(intervals[i - 1].end);
  });

  it('keeps metre-scale grounded shapes and actual rolling wheels at the declared animation axes', () => {
    const { manifest, binary } = loadModel(id);
    const { anchors } = manifest;
    for (const [name, anchor] of Object.entries(anchors)) {
      const pointIsFinite = (point: unknown) => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
      expect(name === 'headlights' ? Array.isArray(anchor) && anchor.every(pointIsFinite)
        : Array.isArray(anchor) ? pointIsFinite(anchor) : Number.isFinite(anchor), name).toBe(true);
    }
    expect(anchors.frontAxle[2]).toBeLessThan(-0.3);
    expect(anchors.rearAxle[2]).toBeGreaterThan(0.3);
    const wheelbase = anchors.rearAxle[2] - anchors.frontAxle[2];
    expect(wheelbase).toBeGreaterThan(0.9);
    expect(wheelbase).toBeLessThan(1.9);
    const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
    for (const part of manifest.parts) {
      const points = positions(binary, part);
      for (let i = 0; i < points.length; i += 3) for (let axis = 0; axis < 3; axis++) {
        minimum[axis] = Math.min(minimum[axis], points[i + axis]);
        maximum[axis] = Math.max(maximum[axis], points[i + axis]);
      }
    }
    expect(minimum[1]).toBeGreaterThan(-0.01);
    expect(minimum[1]).toBeLessThan(0.025);
    expect(maximum[1]).toBeGreaterThan(0.65);
    expect(maximum[1]).toBeLessThan(1.7);
    expect(maximum[0] - minimum[0]).toBeLessThan(1.35);
    expect(maximum[2] - minimum[2]).toBeLessThan(2.8);
    for (const [rig, axle, radius] of [
      ['frontWheel', anchors.frontAxle, anchors.frontRadius],
      ['rearWheel', anchors.rearAxle, anchors.rearRadius],
    ] as const) {
      expect(radius).toBeGreaterThan(0.15);
      expect(radius).toBeLessThan(0.42);
      expect(Math.abs(axle[1] - radius), rig).toBeLessThan(0.03);
      const wheelParts = manifest.parts.filter(part => part.rig === rig);
      expect(wheelParts.length, rig).toBeGreaterThan(0);
      let maximumRadius = 0, maximumSideOffset = 0;
      for (const part of wheelParts) {
        const points = positions(binary, part);
        for (let i = 0; i < points.length; i += 3) {
          maximumRadius = Math.max(maximumRadius, Math.hypot(points[i + 1] - axle[1], points[i + 2] - axle[2]));
          maximumSideOffset = Math.max(maximumSideOffset, Math.abs(points[i] - axle[0]));
        }
      }
      expect(maximumRadius, rig).toBeGreaterThan(radius - 0.025);
      expect(maximumRadius, rig).toBeLessThan(radius + 0.05);
      expect(maximumSideOffset, rig).toBeLessThan(0.25);
    }
    // A workshop/paddock stand must not enlarge the world-space floor footprint.
    expect(minimum[2]).toBeGreaterThan(anchors.frontAxle[2] - anchors.frontRadius - 0.2);
    expect(maximum[2]).toBeLessThan(anchors.rearAxle[2] + anchors.rearRadius + 0.25);
    expect(dirname(resolve(assetRoot, id, manifest.binary))).toBe(resolve(assetRoot, id));
  });
});
