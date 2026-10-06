import { useRef, type PointerEvent } from 'react';

interface Props {
  open: boolean;
  onSwipe(): void;
}

/**
 * A short, in-ride control cue for new riders. It owns the gesture only while
 * visible; the game engine remains paused until the player makes a deliberate
 * swipe (or uses a keyboard control).
 */
export default function RideTutorialOverlay({ open, onSwipe }: Props) {
  const start = useRef<{ x: number; y: number } | null>(null);

  if (!open) return null;

  const down = (event: PointerEvent<HTMLDivElement>) => {
    start.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    const origin = start.current;
    start.current = null;
    if (!origin) return;
    const distance = Math.hypot(event.clientX - origin.x, event.clientY - origin.y);
    if (distance >= 24) onSwipe();
  };

  return (
    <div
      className="ride-tutorial-overlay"
      data-testid="ride-tutorial-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ride-tutorial-title"
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={() => { start.current = null; }}
    >
      <div className="ride-tutorial-card">
        <p className="eyebrow">DEINE ERSTEN FAHRTEN</p>
        <h2 id="ride-tutorial-title">WISCHEN ZUM STARTEN</h2>
        <p className="ride-tutorial-copy">
          Die Fahrt steht kurz. Wische einmal in eine Richtung, dann geht es los.
        </p>
        <div className="ride-tutorial-arrows" aria-hidden="true">
          <span className="ride-tutorial-arrow ride-tutorial-arrow-side">←</span>
          <span className="ride-tutorial-arrow ride-tutorial-arrow-down">↓</span>
          <span className="ride-tutorial-arrow ride-tutorial-arrow-up">↑</span>
          <span className="ride-tutorial-arrow ride-tutorial-arrow-side">→</span>
        </div>
        <p className="ride-tutorial-help">
          ↓ anheben · ↑ senken · ← → ausweichen
        </p>
        <p className="ride-tutorial-hint">Wisch los oder drücke eine Pfeiltaste.</p>
      </div>
    </div>
  );
}
