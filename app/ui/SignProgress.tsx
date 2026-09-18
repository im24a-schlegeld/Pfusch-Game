import { useEffect, useRef, useState } from 'react';
import { SIGN_IDS } from '../game/signCollectibles';
import { COMPLETE_SIGN_MASK } from '../game/signSet';

type SliceBox = { left: number; top: number; width: number; height: number };
type ArtworkLayout = { left: number; top: number; width: number; height: number; slices: SliceBox[] };

function fallbackSlices(pixels: Uint8ClampedArray, width: number, height: number): ArtworkLayout {
  const counts = new Float64Array(width);
  let left = width, right = -1, top = height, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const a = pixels[(y * width + x) * 4 + 3];
    if (a > 32) {
      counts[x] += a / 255;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  if (right < left) throw new Error('Schildgrafik enthält keine sichtbaren Pixel.');
  const span = right - left + 1;
  const cuts = [left];
  for (let i = 1; i < 6; i++) {
    const ideal = left + span * i / 6;
    const lo = Math.max(cuts[i - 1] + 1, Math.round(ideal - span * 0.07));
    const hi = Math.min(right, Math.round(ideal + span * 0.07));
    let best = lo, cost = Infinity;
    for (let x = lo; x <= hi; x++) {
      let ink = 0;
      for (let dx = -3; dx <= 3; dx++) ink += counts[Math.max(0, Math.min(width - 1, x + dx))];
      const score = ink + Math.abs(x - ideal) * 0.02;
      if (score < cost) { cost = score; best = x; }
    }
    cuts.push(best);
  }
  cuts.push(right + 1);
  return {
    left, top, width: span, height: bottom - top + 1,
    slices: Array.from({ length: 6 }, (_, i) => ({
      left: cuts[i], top, width: cuts[i + 1] - cuts[i], height: bottom - top + 1,
    })),
  };
}

/** Extract actual connected letter tiles, so rounded forms keep their real silhouette and angle. */
export function artworkSlices(pixels: Uint8ClampedArray, width: number, height: number): ArtworkLayout {
  const occupied = new Uint8Array(width * height);
  let overallLeft = width, overallTop = height, overallRight = -1, overallBottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const a = pixels[(y * width + x) * 4 + 3];
    if (a > 32) {
      occupied[y * width + x] = 1;
      overallLeft = Math.min(overallLeft, x); overallRight = Math.max(overallRight, x);
      overallTop = Math.min(overallTop, y); overallBottom = Math.max(overallBottom, y);
    }
  }
  if (overallRight < overallLeft) throw new Error('Schildgrafik enthält keine sichtbaren Pixel.');

  const visited = new Uint8Array(width * height);
  const components: SliceBox[] = [];
  const stackX = new Int32Array(width * height);
  const stackY = new Int32Array(width * height);
  for (let startY = 0; startY < height; startY++) for (let startX = 0; startX < width; startX++) {
    const start = startY * width + startX;
    if (!occupied[start] || visited[start]) continue;
    let pointer = 0;
    stackX[pointer] = startX; stackY[pointer] = startY; visited[start] = 1;
    let left = startX, right = startX, top = startY, bottom = startY, pixelsSeen = 0;
    while (pointer >= 0) {
      const x = stackX[pointer], y = stackY[pointer--];
      pixelsSeen++;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (!occupied[next] || visited[next]) continue;
        visited[next] = 1;
        pointer++;
        stackX[pointer] = nx;
        stackY[pointer] = ny;
      }
    }
    if (pixelsSeen >= 40) components.push({ left, top, width: right - left + 1, height: bottom - top + 1 });
  }

  const mergeGap = Math.max(3, Math.round((overallRight - overallLeft + 1) * 0.012));
  components.sort((a, b) => a.left - b.left);
  const merged: SliceBox[] = [];
  for (const box of components) {
    const previous = merged.at(-1);
    if (previous && box.left - (previous.left + previous.width) <= mergeGap &&
      Math.max(previous.top, box.top) <= Math.min(previous.top + previous.height, box.top + box.height) + 4) {
      const left = Math.min(previous.left, box.left);
      const top = Math.min(previous.top, box.top);
      const right = Math.max(previous.left + previous.width, box.left + box.width);
      const bottom = Math.max(previous.top + previous.height, box.top + box.height);
      previous.left = left; previous.top = top; previous.width = right - left; previous.height = bottom - top;
    } else merged.push({ ...box });
  }

  if (merged.length !== 6) return fallbackSlices(pixels, width, height);
  const padX = Math.max(2, Math.round((overallRight - overallLeft + 1) * 0.01));
  const padY = Math.max(2, Math.round((overallBottom - overallTop + 1) * 0.03));
  const slices = merged.map(box => ({
    left: Math.max(0, box.left - padX),
    top: Math.max(0, box.top - padY),
    width: Math.min(width, box.width + padX * 2 + 1),
    height: Math.min(height, box.height + padY * 2 + 1),
  }));
  const left = Math.min(...slices.map(s => s.left));
  const top = Math.min(...slices.map(s => s.top));
  const right = Math.max(...slices.map(s => s.left + s.width));
  const bottom = Math.max(...slices.map(s => s.top + s.height));
  return { left, top, width: right - left, height: bottom - top, slices };
}

export default function SignProgress({ mask }: { mask: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const source = useRef<{ bright: HTMLCanvasElement; dim: HTMLCanvasElement; layout: ArtworkLayout } | null>(null);
  const [revision, setRevision] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const image = new Image();
    image.onload = () => {
      if (!alive) return;
      try {
        const scale = Math.min(1, 900 / image.naturalWidth);
        const scratch = document.createElement('canvas');
        scratch.width = Math.round(image.naturalWidth * scale);
        scratch.height = Math.round(image.naturalHeight * scale);
        const ctx = scratch.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(image, 0, 0, scratch.width, scratch.height);
        const pixels = ctx.getImageData(0, 0, scratch.width, scratch.height);
        const layout = artworkSlices(pixels.data, scratch.width, scratch.height);
        const dim = document.createElement('canvas');
        dim.width = scratch.width; dim.height = scratch.height;
        for (let i = 0; i < pixels.data.length; i += 4) {
          const luminance = pixels.data[i] * .2126 + pixels.data[i + 1] * .7152 + pixels.data[i + 2] * .0722;
          const grey = Math.round(18 + luminance * .24);
          pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = grey;
        }
        dim.getContext('2d')!.putImageData(pixels, 0, 0);
        source.current = { bright: scratch, dim, layout };
        setRevision(n => n + 1);
      } catch { setFailed(true); }
    };
    image.onerror = () => { if (alive) setFailed(true); };
    image.src = '/images/artwork/signs.png';
    return () => { alive = false; source.current = null; };
  }, []);

  useEffect(() => {
    const el = canvas.current, loaded = source.current;
    if (!el || !loaded) return;
    const { bright, dim, layout } = loaded;
    el.width = layout.width;
    el.height = layout.height;
    const ctx = el.getContext('2d')!;
    ctx.clearRect(0, 0, el.width, el.height);
    for (let i = 0; i < layout.slices.length; i++) {
      const slice = layout.slices[i];
      ctx.drawImage(mask & (1 << i) ? bright : dim,
        slice.left, slice.top, slice.width, slice.height,
        slice.left - layout.left, slice.top - layout.top, slice.width, slice.height);
    }
  }, [mask, revision]);

  const count = SIGN_IDS.filter((_, i) => mask & (1 << i)).length;
  return <div className="sign-set-v38" data-testid="sign-progress" data-mask={mask} data-ready={revision > 0} aria-busy={revision === 0 && !failed}
    aria-label={`PFUSCH: ${count} von 6 Zeichen gesammelt. ${mask === COMPLETE_SIGN_MASK ? 'Set vollständig.' : 'Fehlende Zeichen erscheinen erneut.'}`}>
    <div className="sign-set-caption"><span>{count === 6 ? 'SET KOMPLETT' : 'SAMMELSET'}</span><b>{count}/6</b></div>
    <canvas ref={canvas} aria-hidden="true" />
    {failed && <span className="sign-art-error">Schildgrafik nicht geladen</span>}
  </div>;
}
