import { ArrowRight, Wrench } from 'lucide-react';
import { speedometerKmh } from '../domain/speedometer';
import type { Player, RunReward, RunStats } from '../domain/types';
import { fmt, gameText } from './shared';
import { dayKey } from '../domain/progression';
import { ShareAction } from './GameShare';
export default function RideResult({
  player,
  run,
  reward,
  start,
  startLocked = false,
  shopRewardMessage = '',
  garage,
}: {
  player: Player;
  run: RunStats;
  reward: RunReward;
  start: () => void;
  startLocked?: boolean;
  shopRewardMessage?: string;
  garage: () => void;
}) {
  const score = fmt(run.score);
  return (
    <main className="ride-result-v38" data-testid="ride-results">
      <section className="result-panel-v38">
        <header className="result-head-v38">
          <span>
            {reward.newRecord ? 'NEUE BESTLEISTUNG' : 'FAHRT BEENDET'}
          </span>
          <h1 data-long={score.length > 8}>{score}</h1>
          <b>PUNKTE</b>
          <p>
            {gameText(run.cause)} <span>· {run.seconds} s</span>
          </p>
        </header>
        <div className="result-detail-v38">
          <dl className="result-metrics-v38">
            <div>
              <dt>Distanz</dt>
              <dd>
                {fmt(run.distance)} <small>m</small>
              </dd>
            </div>
            <div>
              <dt>Sprünge</dt>
              <dd>{run.jumps}</dd>
            </div>
            <div>
              <dt>Knappe Manöver</dt>
              <dd>{run.nearMisses}</dd>
            </div>
            <div>
              <dt>Höchsttempo</dt>
              <dd>
                {speedometerKmh(run.maxSpeed / 3.6)} <small>km/h</small>
              </dd>
            </div>
          </dl>
          <div className="result-reward-v38">
            <strong>+{reward.xp} XP</strong>
            <strong>+{reward.coins} Coins</strong>
          </div>
          {shopRewardMessage && <output className="result-access-notice">{shopRewardMessage}</output>}
          <p className="result-level-v38">
            Stufe {player.level}
            {player.level >= 10
              ? ' · Maximum'
              : reward.level > reward.previousLevel
                ? ' · Aufgestiegen'
                : ''}
            {reward.challengeIds.length > 0
              ? ` · ${reward.challengeIds.length} Aufgaben erledigt`
              : ''}
          </p>
        </div>
        <footer className="result-footer-v38">
          <p>
            BESTLEISTUNG <b>{fmt(player.highScore)}</b>
          </p>
          {startLocked && <p className="result-access-notice">Für die nächste Fahrt muss dein Newsletter-Status bestätigt sein. Dein Ergebnis bleibt sichtbar.</p>}
          <div className="result-actions-v38">
            <button className="button primary" onClick={start}>
              {startLocked ? 'WEITERFAHREN FREISCHALTEN' : 'NOCHMAL FAHREN'} <ArrowRight size={18} />
            </button>
            <button className="button" onClick={garage}>
              ZUR GARAGE <Wrench size={18} />
            </button>
          </div>
          <ShareAction label="HIGHSCORE TEILEN" share={{ kind: 'score', name: player.leaderboardName, score: player.highScore, date: dayKey() }} />
        </footer>
      </section>
    </main>
  );
}
