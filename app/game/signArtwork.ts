import {
  SIGN_COLLECTIBLES,
  type SignCollectibleDefinition,
} from './signCollectibles';
export interface SignPiece {
  canvas: HTMLCanvasElement;
  dim: HTMLCanvasElement;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface SignArtwork {
  image: HTMLCanvasElement;
  dim: HTMLCanvasElement;
  pieces: SignPiece[];
  width: number;
  height: number;
  fallbacks: number;
}
export interface OriginalSignArtwork {
  canvas: HTMLCanvasElement;
  fallback: boolean;
}
let cached: Promise<SignArtwork> | undefined;
let originals: Promise<OriginalSignArtwork[]> | undefined;
const makeCanvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
};
function context(c: HTMLCanvasElement) {
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) throw new Error('Canvas 2D unavailable');
  return x;
}
function load(path: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    const timer = setTimeout(() => {
      im.onload = im.onerror = null;
      reject(new Error('Sign timeout: ' + path));
    }, 8000);
    im.onload = () => {
      clearTimeout(timer);
      resolve(im);
    };
    im.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Sign unavailable: ' + path));
    };
    im.src = path;
  });
}
function boundary(
  ctx: CanvasRenderingContext2D,
  d: SignCollectibleDefinition,
  w: number,
  h: number,
) {
  ctx.beginPath();
  if (d.shape === 'circle')
    ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (d.shape === 'triangle') {
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
  } else if (d.shape === 'rounded-square') {
    const r = Math.min(w, h) * 0.045;
    ctx.moveTo(r, 0);
    ctx.lineTo(w - r, 0);
    ctx.quadraticCurveTo(w, 0, w, r);
    ctx.lineTo(w, h - r);
    ctx.quadraticCurveTo(w, h, w - r, h);
    ctx.lineTo(r, h);
    ctx.quadraticCurveTo(0, h, 0, h - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
  } else ctx.rect(0, 0, w, h);
}
function grayscale(source: HTMLCanvasElement) {
  const c = makeCanvas(source.width, source.height),
    ctx = context(c);
  ctx.drawImage(source, 0, 0);
  const p = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < p.data.length; i += 4) {
    const g = Math.round(
      43 +
        0.25 *
          (p.data[i] * 0.2126 +
            p.data[i + 1] * 0.7152 +
            p.data[i + 2] * 0.0722),
    );
    p.data[i] = p.data[i + 1] = p.data[i + 2] = g;
  }
  ctx.putImageData(p, 0, 0);
  return c;
}
async function original(d: SignCollectibleDefinition) {
  let im: HTMLImageElement | undefined;
  try {
    im = await load(d.asset);
  } catch {}
  const [l, b, r, t] = d.crop;
  const naturalW = im?.naturalWidth ?? d.sourceSize[0],
    naturalH = im?.naturalHeight ?? d.sourceSize[1];
  const rawW = (r - l) * naturalW,
    rawH = (t - b) * naturalH,
    k = Math.min(1, 384 / Math.max(rawW, rawH));
  const c = makeCanvas(rawW * k, rawH * k),
    ctx = context(c);
  ctx.save();
  // The supplied triangle already has alpha, including its rounded tips.
  // An ideal triangle mask would trim those original edges.
  if (!im || d.shape !== 'triangle') {
    boundary(ctx, d, c.width, c.height);
    ctx.clip();
  }
  if (im)
    ctx.drawImage(
      im,
      l * naturalW,
      (1 - t) * naturalH,
      rawW,
      rawH,
      0,
      0,
      c.width,
      c.height,
    );
  else {
    // A bounded offline fallback never removes the pickup or grows the HUD.
    ctx.fillStyle = '#3b4144';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#f0f0ec';
    ctx.font = `bold ${c.height * 0.62}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(d.id, c.width / 2, c.height / 2);
  }
  ctx.restore();
  // Retain the supplied artwork's intended tilt without clipping its corners.
  const angle = -d.rotation,
    co = Math.abs(Math.cos(angle)),
    si = Math.abs(Math.sin(angle));
  const out = makeCanvas(
      c.width * co + c.height * si + 4,
      c.width * si + c.height * co + 4,
    ),
    o = context(out);
  o.translate(out.width / 2, out.height / 2);
  o.rotate(angle);
  o.drawImage(c, -c.width / 2, -c.height / 2);
  return { canvas: out, fallback: !im };
}
/** Complete independent signs for world pickups, with tilt and clear padding. */
export function loadOriginalSignArtwork(): Promise<OriginalSignArtwork[]> {
  originals ??= Promise.all(SIGN_COLLECTIBLES.map(original)).catch((error) => {
    originals = undefined;
    throw error;
  });
  return originals;
}
// Masks follow the supplied Signs print, including the round U/C outlines.
// Layer order matters: revealing F must never brighten the U overlapping it.
const PRINT_PATHS = [
  'M 3 182 Q 4 173 19 169 L 277 106 L 330 375 L 68 450 Q 52 453 46 437 Z',
  'M 244 104 L 541 120 L 526 415 L 229 401 Z',
  'M 745 251 C 741 172 686 108 605 110 C 523 109 462 174 464 252 C 464 332 522 393 607 394 C 691 393 748 330 745 251 Z',
  'M 903 36 Q 929 26 936 51 L 914 431 Q 911 461 889 448 L 588 264 Q 566 251 591 232 Z',
  'M 1146 225 C 1146 139 1083 73 1006 73 C 928 73 866 141 867 225 C 867 310 928 379 1008 379 C 1084 379 1146 309 1146 225 Z',
  'M 1107 65 L 1395 63 L 1400 347 L 1107 352 Z',
];
const PRINT_DEPTH = [0, 1, 3, 2, 4, 5];
interface SignPixelLayer {
  pixels: Uint8ClampedArray;
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Contours identify letters, but never cut or attenuate the original alpha.
 * Every visible print pixel belongs to one layer, including its supplied edge. */
export function splitSignArtworkPixels(
  width: number,
  height: number,
  source: Uint8ClampedArray,
  masks: readonly Uint8ClampedArray[],
): SignPixelLayer[] {
  const count = width * height;
  const owners = new Int8Array(count).fill(-1);
  const queue = new Int32Array(count);
  let end = 0;
  for (let pixel = 0; pixel < count; pixel++) {
    for (const index of PRINT_DEPTH)
      if (masks[index]?.[pixel * 4 + 3]) owners[pixel] = index;
    if (owners[pixel] >= 0) queue[end++] = pixel;
  }
  if (!end) throw new Error('Empty sign artwork contours');
  // Multi-source nearest-contour fill restores outlines outside the approximate
  // paths. It runs once during cached preparation, never during a ride frame.
  const visit = (next: number, owner: number) => {
    if (owners[next] !== -1) return;
    owners[next] = owner;
    queue[end++] = next;
  };
  for (let start = 0; start < end; start++) {
    const pixel = queue[start], x = pixel % width, owner = owners[pixel];
    if (x > 0) visit(pixel - 1, owner);
    if (x + 1 < width) visit(pixel + 1, owner);
    if (pixel >= width) visit(pixel - width, owner);
    if (pixel + width < count) visit(pixel + width, owner);
  }
  // Approximate circular paths can include a thin strip of the red F/S behind
  // them. Keep those unmistakably red original pixels with their red sign,
  // rather than revealing a red fringe when only U or C is collected.
  for (let pixel = 0; pixel < count; pixel++) {
    const offset = pixel * 4, red = source[offset];
    if ((owners[pixel] === 2 || owners[pixel] === 4) && red > 80 &&
        red > source[offset + 1] * 1.6 && red > source[offset + 2] * 1.6)
      owners[pixel] = (pixel % width) * 1401 / width < 580 ? 1 : 3;
  }
  const bounds = masks.map(() => ({ left: width, top: height, right: 0, bottom: 0 }));
  for (let pixel = 0; pixel < count; pixel++) {
    if (!source[pixel * 4 + 3]) continue;
    const box = bounds[owners[pixel]], x = pixel % width, y = Math.floor(pixel / width);
    box.left = Math.min(box.left, x);
    box.top = Math.min(box.top, y);
    box.right = Math.max(box.right, x + 1);
    box.bottom = Math.max(box.bottom, y + 1);
  }
  const layers = bounds.map(({ left, top, right, bottom }) => {
    const empty = right <= left || bottom <= top;
    const x = empty ? 0 : left - 2, y = empty ? 0 : top - 2;
    const w = empty ? 1 : right - left + 4, h = empty ? 1 : bottom - top + 4;
    return { x, y, width: w, height: h, pixels: new Uint8ClampedArray(w * h * 4) };
  });
  for (let pixel = 0; pixel < count; pixel++) {
    if (!source[pixel * 4 + 3]) continue;
    const layer = layers[owners[pixel]];
    const offset = ((Math.floor(pixel / width) - layer.y) * layer.width + pixel % width - layer.x) * 4;
    for (let channel = 0; channel < 4; channel++) layer.pixels[offset + channel] = source[pixel * 4 + channel];
  }
  return layers;
}
async function suppliedPrint(): Promise<SignArtwork> {
  const source = await load('/images/artwork/signs.png');
  const width = 660,
    height = Math.round((width * source.naturalHeight) / source.naturalWidth);
  const image = makeCanvas(width, height);
  context(image).drawImage(source, 0, 0, width, height);
  const masks = PRINT_PATHS.map((path) => {
    const canvas = makeCanvas(width, height),
      ctx = context(canvas);
    ctx.scale(width / 1401, height / 466);
    ctx.fill(new Path2D(path));
    return ctx.getImageData(0, 0, width, height).data;
  });
  const sourcePixels = context(image).getImageData(0, 0, width, height).data;
  const pieces = splitSignArtworkPixels(width, height, sourcePixels, masks).map((layer) => {
    const canvas = makeCanvas(layer.width, layer.height), ctx = context(canvas);
    const pixels = ctx.createImageData(canvas.width, canvas.height);
    pixels.data.set(layer.pixels);
    ctx.putImageData(pixels, 0, 0);
    return {
      canvas,
      dim: grayscale(canvas),
      x: layer.x,
      y: layer.y,
      width: canvas.width,
      height: canvas.height,
    };
  });
  return { image, dim: grayscale(image), pieces, width, height, fallbacks: 0 };
}
/** Authentic print layout; independent files remain the offline fallback. */
export function loadSignArtwork(): Promise<SignArtwork> {
  if (cached) return cached;
  cached = suppliedPrint()
    .catch(() =>
      loadOriginalSignArtwork().then((loaded) => {
        const width = 660,
          height = 205,
          image = makeCanvas(width, height),
          ctx = context(image);
        const slots = [
          { cx: 70, cy: 112, maxW: 108, maxH: 126 },
          { cx: 164, cy: 106, maxW: 100, maxH: 126 },
          { cx: 272, cy: 112, maxW: 84, maxH: 110 },
          { cx: 374, cy: 100, maxW: 108, maxH: 112 },
          { cx: 478, cy: 108, maxW: 88, maxH: 118 },
          { cx: 580, cy: 108, maxW: 88, maxH: 122 },
        ];
        const pieces = loaded.map(({ canvas }, i) => {
          const slot = slots[i];
          const scale = Math.min(
            slot.maxW / canvas.width,
            slot.maxH / canvas.height,
          );
          const w = Math.max(1, Math.round(canvas.width * scale)),
            h = Math.max(1, Math.round(canvas.height * scale));
          const x = Math.round(slot.cx - w / 2),
            y = Math.round(slot.cy - h / 2);
          const piece = makeCanvas(w, h);
          context(piece).drawImage(canvas, 0, 0, piece.width, piece.height);
          ctx.drawImage(piece, x, y);
          return {
            canvas: piece,
            dim: grayscale(piece),
            x,
            y,
            width: piece.width,
            height: piece.height,
          };
        });
        return {
          image,
          dim: grayscale(image),
          pieces,
          width,
          height,
          fallbacks: loaded.filter((s) => s.fallback).length,
        };
      }),
    )
    .catch((e) => {
      cached = undefined;
      throw e;
    });
  return cached;
}
