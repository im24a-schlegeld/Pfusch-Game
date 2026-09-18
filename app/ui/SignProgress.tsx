import { useEffect, useRef, useState } from 'react';
import { SIGN_IDS } from '../game/signCollectibles';
import { COMPLETE_SIGN_MASK } from '../game/signSet';

/** Find inter-letter alpha valleys in the actual hoodie artwork, not guessed icons. */
export function artworkSlices(pixels: Uint8ClampedArray, width: number, height: number) {
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
    const lo = Math.max(cuts[i - 1] + 1, Math.round(ideal - span * 0.055));
    const hi = Math.min(right, Math.round(ideal + span * 0.055));
    let best = lo, cost = Infinity;
    for (let x = lo; x <= hi; x++) {
      let ink = 0;
      for (let dx = -2; dx <= 2; dx++) ink += counts[Math.max(0, Math.min(width - 1, x + dx))];
      const score = ink + Math.abs(x - ideal) * 0.025;
      if (score < cost) { cost = score; best = x; }
    }
    cuts.push(best);
  }
  cuts.push(right + 1);
  return { left, top, width: span, height: bottom - top + 1, cuts };
}
export default function SignProgress({ mask }: { mask: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const source = useRef<{ bright: HTMLCanvasElement; dim: HTMLCanvasElement; slices: ReturnType<typeof artworkSlices> } | null>(null);
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
        const slices = artworkSlices(pixels.data, scratch.width, scratch.height);
        // Do not depend on CanvasRenderingContext2D.filter on mobile Safari.
        // Precompute a dim grayscale copy, preserving every original alpha pixel.
        const dim = document.createElement('canvas');
        dim.width = scratch.width; dim.height = scratch.height;
        for (let i = 0; i < pixels.data.length; i += 4) {
          const luminance = pixels.data[i] * .2126 + pixels.data[i + 1] * .7152 + pixels.data[i + 2] * .0722;
          const grey = Math.round(18 + luminance * .24);
          pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = grey;
        }
        dim.getContext('2d')!.putImageData(pixels, 0, 0);
        source.current = { bright: scratch, dim, slices };
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
    const { bright, dim, slices: s } = loaded;
    el.width = s.width;
    el.height = s.height;
    const ctx = el.getContext('2d')!;
    ctx.clearRect(0, 0, el.width, el.height);
    for (let i = 0; i < 6; i++) {
      const x = s.cuts[i], w = s.cuts[i + 1] - x;
      ctx.drawImage(mask & (1 << i) ? bright : dim, x, s.top, w, s.height,
        x - s.left, 0, w, el.height);
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
