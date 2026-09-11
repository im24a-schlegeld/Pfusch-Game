import { useEffect, useRef } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import type { Engine } from '../game/engine';

/** A captured thumb can meter either input without lifting or finding another button. */
export function WeightControl({ engine }: { engine: Engine }) {
  const drag = useRef<{ id: number; y: number; value: number } | null>(null);
  useEffect(() => {
    if (engine.phase !== 'playing') drag.current = null;
    return () => {
      engine.weight(0);
    };
  }, [engine, engine.phase]);
  const release = (id: number) => {
    if (drag.current?.id !== id) return;
    drag.current = null;
    engine.weight(0);
  };
  return (
    <div
      className="weight-control"
      aria-label="Slide up to correct, down to raise; release for neutral"
      onPointerDown={(e) => {
        if (drag.current || engine.phase !== 'playing') return;
        e.preventDefault();
        const button = (e.target as HTMLElement).closest('button');
        if (!button) return;
        const value = button.dataset.weight === 'forward' ? -1 : 1;
        drag.current = { id: e.pointerId, y: e.clientY, value };
        e.currentTarget.setPointerCapture(e.pointerId);
        engine.weight(value);
      }}
      onPointerMove={(e) => {
        const start = drag.current;
        if (!start || start.id !== e.pointerId) return;
        const value = Math.max(
          -1,
          Math.min(1, start.value + (e.clientY - start.y) / 56),
        );
        engine.weight(Math.abs(value) < 0.08 ? 0 : value);
      }}
      onPointerUp={(e) => release(e.pointerId)}
      onPointerCancel={(e) => release(e.pointerId)}
      onLostPointerCapture={(e) => release(e.pointerId)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        data-weight="forward"
        className={`forward-control ${engine.forwardInput > 0 ? 'held' : ''}`}
        aria-label="Hold forward weight"
      >
        <ArrowUp />
        <span>CORRECT</span>
      </button>
      <button
        data-weight="rearward"
        className={`wheelie-control ${engine.throttleInput > 0 ? 'held' : ''}`}
        aria-label="Hold wheelie"
      >
        <span>
          <ArrowDown /> WHEELIE
        </span>
        <div className="balance-meter" aria-label="Wheelie angle">
          <b
            style={{
              left: `${(engine.balanceProfile.balancePoint / engine.balanceProfile.crashAngle) * 100}%`,
            }}
          />
          <i
            style={{
              width: `${(engine.wheelieAngle / engine.balanceProfile.crashAngle) * 100}%`,
              background:
                engine.wheelieAngle > engine.balanceProfile.balancePoint + 0.12
                  ? '#d16839'
                  : undefined,
            }}
          />
        </div>
        <small>HOLD · SLIDE TO ADJUST</small>
      </button>
    </div>
  );
}
