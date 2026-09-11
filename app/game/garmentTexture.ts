import * as THREE from 'three';
import type { Player, Product } from '../domain/types';
import audit from '../../public/catalog/garment-textures.json';
import fabricAudit from '../../public/catalog/fabric-samples.json';
import { loadNumberFont } from './numberFont';
type Placement = { center: number[]; width: number; height: number };
type Side = {
  crop: number[];
  texturePlacement: Placement;
  sourcesByColor: { colorId: string; localImage: string }[];
};
type Entry = { front: Side; back: Side; number?: unknown };
const entries = audit.products as unknown as Record<string, Entry>;
const images = new Map<string, Promise<HTMLImageElement>>();
const fabricTiles = new Map<string, Promise<HTMLCanvasElement>>();
function load(url: string) {
  let value = images.get(url);
  if (!value) {
    value = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        images.delete(url);
        reject(new Error(`Cannot load garment artwork: ${url}`));
      };
      img.src = url;
    });
    images.set(url, value);
  }
  return value;
}
async function paintFabric(
  ctx: CanvasRenderingContext2D,
  size: number,
  product: Product | undefined,
  player: Player,
  color: string,
) {
  if (!product) return;
  const spec = (
    fabricAudit.products as Record<string, { crop: number[]; contrast: number }>
  )[product.handle];
  const selected =
    product.preview?.colors.find((c) =>
      c.variantIds.includes(player.variants[product.id]),
    ) ?? product.preview?.colors[0];
  const source = selected?.front?.localImage;
  if (!spec || !source) return;
  const key = source + ':' + color;
  let pending = fabricTiles.get(key);
  if (!pending) {
    pending = load(source)
      .then((img) => {
        const tile = document.createElement('canvas');
        tile.width = tile.height = 256;
        const paint = tile.getContext('2d')!;
        const [x, y, w, h] = spec.crop;
        // Mirrored edges make a continuous weave sample, without copying prints,
        // pocket outlines or photographic background onto the garment.
        for (const sx of [-1, 1])
          for (const sy of [-1, 1]) {
            paint.save();
            paint.translate(128, 128);
            paint.scale(sx, sy);
            paint.drawImage(img, x, y, w, h, 0, 0, 128, 128);
            paint.restore();
          }
        const pixels = paint.getImageData(0, 0, 256, 256),
          values = pixels.data;
        let mean = 0;
        for (let i = 0; i < values.length; i += 4)
          mean += (values[i] + values[i + 1] + values[i + 2]) / 3;
        mean /= values.length / 4;
        const hex = new THREE.Color(color).getHex(),
          base = [hex >> 16, (hex >> 8) & 255, hex & 255];
        for (let i = 0; i < values.length; i += 4) {
          const luminance = (values[i] + values[i + 1] + values[i + 2]) / 3;
          const factor = THREE.MathUtils.clamp(
            1 + (luminance / Math.max(1, mean) - 1) * spec.contrast,
            0.72,
            1.28,
          );
          for (let c = 0; c < 3; c++)
            values[i + c] = Math.round(base[c] * factor);
          values[i + 3] = 255;
        }
        paint.putImageData(pixels, 0, 0);
        return tile;
      })
      .catch((error) => {
        fabricTiles.delete(key);
        throw error;
      });
    fabricTiles.set(key, pending);
  }
  const tile = await pending;
  ctx.fillStyle = ctx.createPattern(tile, 'repeat')!;
  ctx.fillRect(0, 0, size, size);
}
export function fabricMaterial(
  product: Product | undefined,
  player: Player,
  color: string,
) {
  if (!product)
    return new THREE.MeshStandardMaterial({ color, roughness: 0.96 });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 512, 512);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.96 });
  let disposed = false;
  m.addEventListener('dispose', () => {
    disposed = true;
    map.dispose();
  });
  void paintFabric(ctx, 512, product, player, color)
    .then(() => {
      if (!disposed) map.needsUpdate = true;
    })
    .catch((error) => console.error(error));
  return m;
}
/** Extract exact photographed ink, with the sampled fabric removed and soft edge margins. */
function printedCrop(img: HTMLImageElement, crop: number[], maskImage = img) {
  const [x, y, w, h] = crop,
    canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
  const pixels = ctx.getImageData(0, 0, w, h);
  // Aligned high-contrast product photography supplies the ink mask; selected-color RGB stays intact.
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(maskImage, x, y, w, h, 0, 0, w, h);
  const mask = ctx.getImageData(0, 0, w, h),
    samples: number[][] = [[], [], []];
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++)
      if (i < 3 || j < 3 || i >= w - 3 || j >= h - 3) {
        const k = (j * w + i) * 4;
        if (mask.data[k + 3] > 32)
          for (let c = 0; c < 3; c++) samples[c].push(mask.data[k + c]);
      }
  const base = samples.map(
    (s) => s.sort((a, b) => a - b)[Math.floor(s.length / 2)] ?? 0,
  );
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const k = (j * w + i) * 4,
        dist = Math.hypot(...base.map((b, c) => mask.data[k + c] - b)),
        edge = Math.min(i, j, w - 1 - i, h - 1 - j) / 4;
      pixels.data[k + 3] = Math.round(
        pixels.data[k + 3] *
          Math.min(1, edge) *
          THREE.MathUtils.clamp((dist - 9) / 30, 0, 1),
      );
    }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}
export function garmentMaterial(
  product: Product | undefined,
  player: Player,
  color: string,
) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1024, 1024);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  const m = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    map: texture,
    roughness: 0.96,
  });
  let disposed = false;
  m.addEventListener('dispose', () => {
    disposed = true;
    texture.dispose();
  });
  const entry = product ? entries[product.handle] : undefined;
  const selected =
    product?.preview?.colors.find((c) =>
      c.variantIds.includes(player.variants[product.id]),
    ) ?? product?.preview?.colors[0];
  const draw = async () => {
    await paintFabric(ctx, 1024, product, player, color);
    if (disposed) return;
    texture.needsUpdate = true;
    if (entry)
      await Promise.all(
        (['front', 'back'] as const).map(async (side) => {
          const spec = entry[side];
          if (!spec) return;
          const normalize = (s: string) =>
            s
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-');
          const source =
            spec.sourcesByColor.find(
              (s) => normalize(s.colorId) === selected?.id,
            ) ?? spec.sourcesByColor[0];
          if (!source) return;
          const maskSource =
            spec.sourcesByColor.find(
              (s) => normalize(s.colorId) === 'schwarz',
            ) ?? source;
          const [img, maskImage] = await Promise.all([
            load(source.localImage),
            load(maskSource.localImage),
          ]);
          if (disposed) return;
          const cropped = printedCrop(img, spec.crop, maskImage),
            p = spec.texturePlacement;
          const panelWidth = 365,
            centerX =
              (side === 'front' ? 768 : 256) + (p.center[0] - 0.5) * panelWidth;
          const y = 0.54 - p.center[1] * 0.59,
            centerY = ((0.63 - y) / 0.675) * 1024,
            width = p.width * panelWidth,
            height = ((p.height * 0.59) / 0.675) * 1024;
          ctx.drawImage(
            cropped,
            centerX - width / 2,
            centerY - height / 2,
            width,
            height,
          );
          texture.needsUpdate = true;
        }),
      );
    if (product?.preview?.numberCustomization) {
      await loadNumberFont();
      if (disposed) return;
      const number = player.customizations[product.id]?.customNumber ?? '';
      if (number) {
        ctx.fillStyle = '#b8b8b6';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.font = '700 400px "Merriweather"';
        ctx.fillText(number, 256, 735, 225);
        texture.needsUpdate = true;
      }
    }
  };
  // Texture failure is reported; real product photography remains visible in Garage.
  void draw().catch((error) => console.error(error));
  return m;
}
export function sleeveMaterial(
  product: Product,
  player: Player,
  color: string,
  side: number,
) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 512, 512);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({
    map,
    color: '#fff',
    roughness: 0.96,
  });
  let disposed = false;
  m.addEventListener('dispose', () => {
    disposed = true;
    map.dispose();
  });
  // Authoritative supplied RGBA artwork. Its alpha already separates the ink;
  // re-extracting it from a white/black background would erase genuine details.
  void paintFabric(ctx, 512, product, player, color)
    .then(() => load('/images/artwork/tribal-racing.png'))
    .then((img) => {
      if (disposed) return;
      ctx.save();
      ctx.translate(256, 350);
      ctx.scale(side > 0 ? 1 : -1, 1);
      // Keep the original lengthwise placement; flip the source top-to-bottom
      // about its horizontal axis before wrapping it around either sleeve.
      ctx.rotate(Math.PI / 2);
      ctx.scale(1, -1);
      ctx.drawImage(img, -135, -43, 270, 86);
      ctx.restore();
      map.needsUpdate = true;
    })
    .catch((error) => console.error(error));
  return m;
}

/** Exact photographed embroidery/ink composited into the curved accessory's UVs. */
export function accessoryMaterial(
  product: Product,
  player: Player,
  color: string,
) {
  const designs: Record<
    string,
    { crop: number[]; width: number; height: number; y: number }
  > = {
    'p-zero-cap': {
      crop: [157, 226, 330, 87],
      width: 240,
      height: 280,
      y: 560,
    },
    'logo-cap-1': {
      crop: [185, 180, 236, 153],
      width: 215,
      height: 580,
      y: 530,
    },
    'pfusch-logo-cap': {
      crop: [244, 241, 146, 84],
      width: 185,
      height: 380,
      y: 555,
    },
    'logo-crossbody-tasche': {
      crop: [199, 334, 162, 96],
      width: 225,
      height: 350,
      y: 650,
    },
  };
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1024, 1024);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const material = new THREE.MeshStandardMaterial({ map, roughness: 0.96 });
  let disposed = false;
  material.addEventListener('dispose', () => {
    disposed = true;
    map.dispose();
  });
  const selected =
    product.preview?.colors.find((c) =>
      c.variantIds.includes(player.variants[product.id]),
    ) ?? product.preview?.colors[0];
  const source = selected?.front?.localImage,
    design = designs[product.handle];
  if (source && design)
    void load(source)
      .then((img) => {
        if (disposed) return;
        ctx.drawImage(
          printedCrop(img, design.crop),
          768 - design.width / 2,
          design.y - design.height / 2,
          design.width,
          design.height,
        );
        map.needsUpdate = true;
      })
      .catch((error) => console.error(error));
  return material;
}
