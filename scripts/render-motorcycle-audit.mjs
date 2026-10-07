/** CPU-only orthographic asset audit; renders exported triangles without a GPU/browser. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = fs.existsSync(path.join(root, '.build-check/node_modules/three')) ? path.join(root, '.build-check') : root;
const require = createRequire(path.join(runtime, 'package.json'));
const sharp = (await import(pathToFileURL(require.resolve('sharp')).href)).default;
const THREE = await import(pathToFileURL(path.join(path.dirname(require.resolve('three')), '../build/three.module.js')).href);
const id = process.argv[2];
if (!/^[a-z0-9-]+$/.test(id ?? '')) throw new Error('Pass model directory id.');
const folder = path.join(root, 'public/models', id);
const model = JSON.parse(fs.readFileSync(path.join(folder, 'model.json'), 'utf8'));
const binary = fs.readFileSync(path.join(folder, model.binary));
const floats = (attribute, size) => new Float32Array(binary.buffer, binary.byteOffset + attribute.offset, attribute.count * size);
const indices = attribute => new Uint16Array(binary.buffer, binary.byteOffset + attribute.offset, attribute.count);
const triangles = [];
for (const part of model.parts) {
  const p = floats(part.position, 3), n = floats(part.normal, 3), idx = indices(part.index);
  const material = model.materials.find(m => m.name === part.material);
  const color = new THREE.Color(material.color);
  for (let i = 0; i < idx.length; i += 3) {
    const points = [], normal = new THREE.Vector3();
    for (const vertex of idx.slice(i, i + 3)) { points.push(new THREE.Vector3().fromArray(p, vertex * 3)); normal.add(new THREE.Vector3().fromArray(n, vertex * 3)); }
    triangles.push({ points, normal: normal.normalize(), color });
  }
}
const width = 1800, height = 900;
const views = [{ label: `${id.toUpperCase()} · SEITE`, direction: [1, .12, 0] }, { label: 'VORNE ¾', direction: [3, 1.4, -4] }];
const light = new THREE.Vector3(-1, 3, -2).normalize();
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#303030"/>`;
for (let view = 0; view < views.length; view++) {
  const direction = new THREE.Vector3(...views[view].direction).normalize();
  const right = new THREE.Vector3(0, 1, 0).cross(direction).normalize();
  const up = direction.clone().cross(right).normalize();
  const all = triangles.flatMap(t => t.points);
  const x = all.map(p => p.dot(right)), y = all.map(p => p.dot(up));
  const minX = Math.min(...x), maxX = Math.max(...x), minY = Math.min(...y), maxY = Math.max(...y);
  const size = width / 2, scale = Math.min((size - 100) / (maxX - minX), (height - 180) / (maxY - minY));
  const dx = view * size + size / 2 - (minX + maxX) / 2 * scale;
  const dy = height / 2 + 25 + (minY + maxY) / 2 * scale;
  const faces = triangles.map(t => ({ ...t, depth: t.points.reduce((sum, p) => sum + p.dot(direction), 0) / 3 })).sort((a, b) => a.depth - b.depth);
  svg += `<text x="${view * size + 40}" y="52" fill="#eee" font-family="Arial" font-size="23">${views[view].label}</text>`;
  for (const face of faces) {
    const luminosity = .52 + .48 * Math.abs(face.normal.dot(light));
    const color = face.color.clone().multiplyScalar(luminosity).getHexString();
    svg += `<polygon points="${face.points.map(p => `${(dx + p.dot(right) * scale).toFixed(2)},${(dy - p.dot(up) * scale).toFixed(2)}`).join(' ')}" fill="#${color}"/>`;
  }
}
svg += '</svg>';
const output = path.join(root, 'outputs', 'model-audit'); fs.mkdirSync(output, { recursive: true });
await sharp(Buffer.from(svg)).png().toFile(path.join(output, `${id}.png`));
console.log(path.join(output, `${id}.png`));
