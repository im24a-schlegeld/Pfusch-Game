import { useEffect, useRef, useState } from 'react';
import { loadSignArtwork, type SignArtwork } from '../game/signArtwork';
import { COMPLETE_SIGN_MASK } from '../game/signSet';
import { SIGN_IDS } from '../game/signCollectibles';
import StopSign from './StopSign';
import './signs-lockup.css';
export default function SignProgress({ mask, showCaption = true }: { mask: number; showCaption?: boolean }) {
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
    // The shared lockup applies the same tilt and STOP placement as the logo.
    c.width = art.width;
    c.height = art.height;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    // Whole, separate layers: selecting F cannot reveal any U pixels. The dark
    // U layer remains in front and occludes F at their natural overlap.
    art.pieces.forEach((p, i) =>
      ctx.drawImage(mask & (1 << i) ? p.canvas : p.dim, p.x, p.y),
    );
  }, [art, mask]);
  const count = Array.from({ length: 6 }, (_, i) =>
    Number(!!(mask & (1 << i))),
  ).reduce((a, b) => a + b, 0);
  const complete = mask === COMPLETE_SIGN_MASK;
  return (
    <figure
      className="sign-set-v38 v42-signs"
      data-testid="sign-progress"
      data-mask={mask}
      data-complete={complete}
      data-ready={!!art}
      data-failed={failed}
      data-fallbacks={art?.fallbacks ?? 0}
      aria-label={`PFUSCH: ${count} von 6 Zeichen gesammelt${complete ? '. Heute erledigt' : ''}`}
    >
      <span className="signs-lockup">
        <canvas className="signs-lockup-artwork" ref={ref} width={660} height={220} aria-hidden="true" />
        <StopSign active={complete} className="v42-sign-stop signs-lockup-stop" />
      </span>
      {showCaption && <figcaption className="pfusch-letter-progress">
        <span className="pfusch-letter-row" aria-hidden="true">
          {SIGN_IDS.map((id, index) => <b key={id} data-collected={!!(mask & (1 << index))}>{id}</b>)}
        </span>
        <span>{count} / 6</span>
      </figcaption>}
    </figure>
  );
}
