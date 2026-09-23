import type { Engine } from '../game/engine';
import { Pause } from 'lucide-react';
import SignProgress from './SignProgress';
const number = (n: number) => Math.floor(n).toLocaleString('de-CH');
/** Keep the riding instruments at the top without obscuring the road. */
export default function RideHud({
  engine,
  best,
  pause,
}: {
  engine: Engine;
  best: number;
  pause: () => void;
}) {
  return (
    <div className="v42-hud" aria-label="Fahrdaten">
      <div className="v42-score">
        <span>PUNKTE</span>
        <strong data-long={number(engine.score).length > 9}>
          {number(engine.score)}
        </strong>
        <small>BESTE {number(best)}</small>
      </div>
      {engine.phase === 'playing' && (
        <div className="ride-balance" aria-label="Wheelie-Winkel und Kippunkt">
          <small>KIPPUNKT</small>
          <div className="balance-meter">
            <b
              style={{
                left: `${(engine.balanceProfile.balancePoint / engine.balanceProfile.crashAngle) * 100}%`,
              }}
            />
            <i
              style={{
                width: `${Math.min(100, (engine.wheelieAngle / engine.balanceProfile.crashAngle) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}
      <div className="v42-metrics">
        <b>
          {number(engine.distance)} <small>M</small>
        </b>
        <b>
          {Math.round(engine.speed * 3.6)} <small>KM/H</small>
        </b>
      </div>
      <div className="v42-top-actions">
        <div className="v42-sign-slot">
          <SignProgress mask={engine.collectedSigns} />
        </div>
        <button
          className="v42-pause"
          type="button"
          onClick={pause}
          aria-label="Fahrt pausieren"
        >
          <Pause
            size={21}
            fill="currentColor"
            strokeWidth={0}
            aria-hidden="true"
          />
        </button>
      </div>
    </div>
  );
}
