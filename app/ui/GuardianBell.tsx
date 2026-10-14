import { useEffect, useRef, type CSSProperties } from 'react';
import './guardian-bell.css';

const duration = (reducedMotion: boolean) => reducedMotion ? 180 : 800;
const bellViewBox = '-8 0 136 166';

function WingRelief() {
  return <g fill="#d8dde0" strokeWidth="2">
    <path d="M50 82C41 77 34 81 33 91C29 96 28 103 29 109C26 116 26 126 23 133C31 130 35 124 38 117C38 126 36 133 32 139C41 135 45 128 47 118L46 105L43 101Q49 98 50 91Z" />
    <path d="M43 86Q34 94 31 103M45 94Q35 102 29 116M44 105Q34 114 28 127M43 116Q39 129 34 135" fill="none" strokeWidth="1.6" />
  </g>;
}

function BellArtwork() {
  return <g stroke="#080a0e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <g transform="rotate(-12 60 40)">
      <path d="M45 7H75L67 39Q60 47 53 39Z" fill="#d8dde0" />
      <path d="M51 12H69L64 32H56Z" fill="#535d65" strokeWidth="2" />
    </g>
    <ellipse cx="60" cy="52" rx="11" ry="12" fill="#d8dde0" />
    <ellipse cx="60" cy="52" rx="5" ry="6" fill="#535d65" strokeWidth="2" />
    <g transform="rotate(8 60 65)">
      <path d="M51 65Q38 69 34 84L25 127Q23 137 14 143L13 151H107L106 143Q97 137 95 127L86 84Q82 69 69 65Z" fill="#929ca2" strokeWidth="4" />
      <path d="M51 69Q41 74 37 88L28 130Q26 139 22 144H40L47 119L45 88Q45 78 53 74Z" fill="#d8dde0" stroke="none" />
      <path d="M73 72Q81 79 85 96L94 132Q96 140 101 145H83L76 119Z" fill="#535d65" stroke="none" />
      <WingRelief /><g transform="translate(120 0) scale(-1 1)"><WingRelief /></g>
      <path d="M57 81Q57 76 53 72H57L60 76L63 72H67Q63 76 63 81V94H76Q80 94 82 90V102Q79 100 76 100H63V126Q63 133 67 138L60 143L53 138Q57 133 57 126V100H44Q41 100 38 102V90Q40 94 44 94H57Z" fill="#d8dde0" strokeWidth="2.4" />
      <ellipse cx="60" cy="148" rx="46" ry="6" fill="#d8dde0" />
      <ellipse cx="60" cy="155" rx="5" ry="3" fill="#535d65" strokeWidth="2" />
    </g>
  </g>;
}

/** Solid metal facets and a raised cross, based on the supplied guardian bell. */
export function GuardianBell({ size = 32, className = '' }: { size?: number; className?: string }) {
  return <svg className={`guardian-bell ${className}`} width={size} height={size} viewBox={bellViewBox}
    xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Guardian Bell" focusable="false">
    <BellArtwork />
  </svg>;
}

/** Both the real animation event and its bounded fallback use this gate. */
export function createGuardianBellBurstCompletion(onComplete: () => void, reducedMotion = false) {
  let closed = false;
  const complete = () => {
    if (closed) return;
    closed = true; clearTimeout(timer); onComplete();
  };
  const timer = setTimeout(complete, duration(reducedMotion));
  return { complete, cancel() { closed = true; clearTimeout(timer); } };
}

function BurstArtwork() {
  return <svg viewBox={bellViewBox} className="guardian-bell-burst-art" aria-hidden="true" focusable="false">
    <BellArtwork />
  </svg>;
}

/** Visual pre-countdown only: it never takes focus or intercepts ride controls. */
export function GuardianBellBurst({ onComplete, reducedMotion = false }: { onComplete(): void; reducedMotion?: boolean }) {
  const callback = useRef(onComplete), settled = useRef(false);
  const completion = useRef<ReturnType<typeof createGuardianBellBurstCompletion> | null>(null);
  callback.current = onComplete;
  useEffect(() => {
    const gate = createGuardianBellBurstCompletion(() => {
      if (settled.current) return;
      settled.current = true; callback.current();
    }, reducedMotion);
    completion.current = gate;
    return () => { gate.cancel(); if (completion.current === gate) completion.current = null; };
  }, [reducedMotion]);
  const style = { '--guardian-bell-duration': `${duration(reducedMotion)}ms` } as CSSProperties;
  return <div className={`guardian-bell-burst${reducedMotion ? ' guardian-bell-burst-reduced' : ''}`} style={style}
    aria-hidden="true" onAnimationEnd={event => {
      if (event.currentTarget === event.target) completion.current?.complete();
    }}>
    <div className="guardian-bell-burst-center">
      <span className="guardian-bell-burst-whole"><BurstArtwork /></span>
      {[0, 1, 2, 3].map(piece => <span key={piece} className={`guardian-bell-burst-piece guardian-bell-burst-piece-${piece}`}>
        <BurstArtwork />
      </span>)}
    </div>
  </div>;
}

export default GuardianBell;
