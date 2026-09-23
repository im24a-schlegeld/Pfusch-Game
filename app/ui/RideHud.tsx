import type { Engine } from '../game/engine';
import { Pause } from 'lucide-react';
import SignProgress from './SignProgress';
const number = (n: number) => Math.floor(n).toLocaleString('de-CH');
/** Compact, opaque panels reserve their layout while the set artwork loads. */
export default function RideHud({
  engine,
  best,
  pause,
}: {
  engine: Engine;
  best: number;
  pause: () => void;
}) {
  const state =
    engine.scrapeIntensity > 0
      ? 'SCRAPE'
      : engine.towJumpActive
        ? 'AIRTIME'
        : engine.onTowTruck
          ? 'RAMPE'
          : engine.wheelie
            ? 'WHEELIE'
            : 'STREET RUN';
  return (
    <div className="v42-hud" aria-label="Fahrdaten">
      <div className="v42-score">
        <span>PUNKTE</span>
        <strong data-long={number(engine.score).length > 9}>
          {number(engine.score)}
        </strong>
        <small>BESTE {number(best)}</small>
      </div>
      <div className="v42-sign-slot">
        <SignProgress mask={engine.collectedSigns} />
      </div>
      <div className="v42-metrics">
        <b>
          {number(engine.distance)} <small>M</small>
        </b>
        <b>
          {Math.round(engine.speed * 3.6)} <small>KM/H</small>
        </b>
      </div>
      <div className="v42-right-bottom">
        <span className="ride-state" data-active={state !== 'STREET RUN'}>
          <i aria-hidden="true" />
          <span>{state}</span>
        </span>
        <button type="button" onClick={pause} aria-label="Fahrt pausieren">
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
