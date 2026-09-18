import { ArrowRight, Wrench } from 'lucide-react';
import type { Player, RunReward, RunStats } from '../domain/types';
import { fmt, gameText } from './shared';
export default function RideResult({ player, run, reward, start, garage }: {
  player: Player; run: RunStats; reward: RunReward; start: () => void; garage: () => void;
}) {
  const score = fmt(run.score);
  return <main className="ride-result-v38" data-testid="ride-results">
    <section className="result-panel-v38">
      <header className="result-head-v38"><span>{reward.newRecord ? 'NEUE BESTLEISTUNG' : 'FAHRT BEENDET'}</span><h1 data-long={score.length > 8}>{score}</h1><b>PUNKTE</b>
        <p>{gameText(run.cause)} <span>· {run.seconds} s</span></p></header>
      <div className="result-detail-v38">
        <dl className="result-metrics-v38">
          <div><dt>Distanz</dt><dd>{fmt(run.distance)} <small>m</small></dd></div>
          <div><dt>Beste Kombo</dt><dd>×{run.bestCombo.toFixed(1)}</dd></div>
          <div><dt>Knappe Manöver</dt><dd>{run.nearMisses}</dd></div>
          <div><dt>Höchsttempo</dt><dd>{run.maxSpeed} <small>km/h</small></dd></div>
        </dl>
        <div className="result-reward-v38"><strong>+{reward.xp} XP</strong><strong>+{reward.coins} Coins</strong></div>
        <p className="result-level-v38">Stufe {player.level}{player.level >= 10 ? ' · Maximum' : reward.level > reward.previousLevel ? ' · Aufgestiegen' : ''}
          {reward.challengeIds.length > 0 ? ` · ${reward.challengeIds.length} Aufgaben erledigt` : ''}</p>
      </div>
      <footer className="result-footer-v38">
        <p>BESTLEISTUNG <b>{fmt(player.highScore)}</b></p>
        <div className="result-actions-v38">
          <button className="button primary" onClick={start}>NOCHMAL FAHREN <ArrowRight size={18}/></button>
          <button className="button" onClick={garage}>ZUR GARAGE <Wrench size={18}/></button>
        </div>
      </footer>
    </section>
  </main>;
}
