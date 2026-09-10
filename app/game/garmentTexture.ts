import * as THREE from 'three';
import type { Player, Product } from '../domain/types';
import audit from '../../public/catalog/garment-textures.json';
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
function load(url: string) {
  let value = images.get(url);
  if (!value) {
    value = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () =>
        reject(new Error(`Cannot load garment artwork: ${url}`));
      img.src = url;
    });
    images.set(url, value);
  }
  return value;
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
  void load(`/images/artwork/racing-sleeve-${side > 0 ? 'left' : 'right'}.png`)
    .then((img) => {
      if (disposed) return;
      const artwork = printedCrop(img, [0, 0, img.width, img.height]);
      ctx.drawImage(artwork, 176, 230, 160, 250);
      map.needsUpdate = true;
    })
    .catch((error) => console.error(error));
  return m;
}
