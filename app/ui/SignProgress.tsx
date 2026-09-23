import { useEffect, useRef, useState } from 'react';
import { loadSignArtwork, type SignArtwork } from '../game/signArtwork';
export default function SignProgress({ mask }: { mask: number }) {
  const ref = useRef<HTMLCanvasElement>(null),
    [art, setArt] = useState<SignArtwork | null>(null),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadSignArtwork()
      .then((a) => {
        if (alive) setArt(a);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!art || !ref.current) return;
    const c = ref.current;
    // Match the slight clockwise placement of the complete print on the hoodie.
    const angle = Math.PI / 30,
      cos = Math.cos(angle),
      sin = Math.sin(angle);
    c.width = Math.ceil(art.width * cos + art.height * sin);
    c.height = Math.ceil(art.width * sin + art.height * cos);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(angle);
    ctx.translate(-art.width / 2, -art.height / 2);
    // Whole, separate layers: selecting F cannot reveal any U pixels. The dark
    // U layer remains in front and occludes F at their natural overlap.
    art.pieces.forEach((p, i) =>
      ctx.drawImage(mask & (1 << i) ? p.canvas : p.dim, p.x, p.y),
    );
  }, [art, mask]);
  const count = Array.from({ length: 6 }, (_, i) =>
    Number(!!(mask & (1 << i))),
  ).reduce((a, b) => a + b, 0);
  return (
    <figure
      className="sign-set-v38 v42-signs"
      data-testid="sign-progress"
      data-mask={mask}
      data-ready={!!art}
      data-fallbacks={art?.fallbacks ?? 0}
      aria-label={`${count} von 6 Schildern gesammelt${failed ? '. Bild nicht verfügbar' : ''}`}
    >
      <canvas ref={ref} width={660} height={205} aria-hidden="true" />
    </figure>
  );
}
