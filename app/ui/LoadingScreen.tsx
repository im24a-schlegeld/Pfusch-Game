import { Bike } from 'lucide-react';
import '../loading-screen.css';

/** Asset changes inside the garage keep its controls visible and do not restart the game artwork. */
export function PreviewLoading() {
  return <output className="scene-loading scene-loading-runtime" aria-label="Vorschau wird geladen">
    <span className="spinner" aria-hidden="true" />
    <span>VORSCHAU WIRD GELADEN</span>
  </output>;
}

/** Static artwork keeps the loading UI independent of Three.js and WebGL. */
export default function LoadingScreen({
  label = 'DEIN SETUP WIRD GELADEN',
  fullScreen = false,
  embedded = typeof window !== 'undefined' && window.parent !== window,
}: { label?: string; fullScreen?: boolean; embedded?: boolean }) {
  return (
    <output className={`ride-loading${fullScreen ? ' ride-loading-full' : ''}${embedded ? ' ride-loading-embedded' : ''}`} aria-label={label}>
      <picture>
        <source media="(max-aspect-ratio: 3/4)" srcSet="/branding/loading-trailer-portrait.webp" />
        <img className="ride-loading-art" src="/branding/loading-trailer.webp" alt="" fetchPriority="high" />
      </picture>
      <div className="ride-loading-brand">
        <img src="/images/artwork/signs.png" alt="PFUSCH Signs" />
        <span>WHEELIE ESCAPE</span>
      </div>
      <div className="ride-loading-caption">
        <div className="ride-loading-line"><Bike size={19} aria-hidden="true" /><span>{label}</span></div>
        <span className="ride-loading-track" aria-hidden="true"><i /></span>
      </div>
    </output>
  );
}
