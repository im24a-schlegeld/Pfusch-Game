import { useState } from 'react';
import {
  ArrowRight,
  Check,
  Download,
  Flag,
  Gift,
  Lock,
  Trophy,
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Player } from '../domain/types';
import type { Services } from '../services';
import {
  DAILY_CHALLENGES,
  LEVELS,
  LEVEL_NAMES,
  REWARDS,
} from '../domain/config';
import { Coin, ScreenHeading, XpBar, fmt } from './shared';
interface Base {
  player: Player;
  back: () => void;
}
export function Challenges({
  player,
  back,
  start,
}: Base & { start: () => void }) {
  return (
    <main className="standard-page">
      <ScreenHeading
        kicker="A REASON FOR ONE MORE."
        title="DAILY CHALLENGES."
        back={back}
      />
      <div className="page-intro">
        <p>
          A little risk. A little reward. Progress adds up across your rides.
        </p>
        <span className="tag">RESETS 00:00 UTC</span>
      </div>
      <div className="challenge-grid">
        {DAILY_CHALLENGES.map((c, i) => {
          const value = player.challenges.values[c.id] ?? 0;
          const complete = player.challenges.claimed.includes(c.id);
          return (
            <article
              key={c.id}
              className={`challenge-card ${complete ? 'complete' : ''}`}
            >
              <div className="challenge-top">
                <span>0{i + 1} / DAILY</span>
                {complete ? <Check /> : <Flag />}
              </div>
              <h2>{c.title}</h2>
              <p>{c.description}</p>
              <div className="challenge-count">
                <b>{fmt(Math.min(c.target, value))}</b>
                <span>/ {fmt(c.target)}</span>
              </div>
              <Progress
                value={(value / c.target) * 100}
                aria-label={`${c.title} progress`}
              />
              <div className="challenge-reward">
                <span>+{c.xp} XP</span>
                <Coin value={c.coins} />
                {complete && <b>COLLECTED</b>}
              </div>
            </article>
          );
        })}
      </div>
      <div className="challenge-footer">
        <p>Rewards are collected automatically after a ride.</p>
        <button className="button primary" onClick={start}>
          LET’S RIDE <ArrowRight />
        </button>
      </div>
    </main>
  );
}
export function ProgressContent({ player }: { player: Player }) {
  return (
    <>
      <div className="section-intro">
        <p className="eyebrow">YOUR REPUTATION</p>
        <h2>{LEVEL_NAMES[player.level - 1]}</h2>
      </div>
      <XpBar player={player} />
      <div className="lifetime-stats">
        <div>
          <b>{fmt(player.runsPlayed)}</b>
          <span>RIDES</span>
        </div>
        <div>
          <b>{(player.totalDistance / 1000).toFixed(1)} km</b>
          <span>DISTANCE</span>
        </div>
        <div>
          <b>{fmt(player.highScore)}</b>
          <span>HIGH SCORE</span>
        </div>
        <div>
          <b>{fmt(player.totalNearMisses)}</b>
          <span>NEAR MISSES</span>
        </div>
        <div>
          <b>{fmt(player.totalWheelieMeters)} m</b>
          <span>ON ONE WHEEL</span>
        </div>
        <div>
          <b>{player.ownedItems.length}</b>
          <span>UNLOCKED ITEMS</span>
        </div>
      </div>
      <h3 className="custom-label">FROM NEW BLOOD TO CREW</h3>
      <div className="level-list">
        {LEVELS.map((xp, i) => (
          <div key={xp} className={player.level >= i + 1 ? 'reached' : ''}>
            <span className="level-number">
              {String(i + 1).padStart(2, '0')}
            </span>
            <div>
              <b>{LEVEL_NAMES[i]}</b>
              <span>
                {i === 0
                  ? 'Töffli + 150 starting coins'
                  : i === 2
                    ? 'Supermoto available'
                    : i === 4
                      ? 'After hours rims reward available'
                      : i === 5
                        ? 'Sport available'
                        : `${fmt(xp)} lifetime XP`}
              </span>
            </div>
            {player.level >= i + 1 ? <Check size={19} /> : <Lock size={16} />}
          </div>
        ))}
      </div>
    </>
  );
}
export function ProgressScreen({ player, back }: Base) {
  return (
    <main className="standard-page narrow">
      <ScreenHeading
        kicker="EVERY RIDE COUNTS."
        title="STREET REPUTATION."
        back={back}
      />
      <ProgressContent player={player} />
    </main>
  );
}
export function Rewards({
  player,
  services,
  update,
  notify,
  back,
}: Base & {
  services: Services;
  update: (p: Player) => void;
  notify: (s: string) => void;
}) {
  return (
    <main className="standard-page">
      <ScreenHeading
        kicker="EARNED ON THE STREETS."
        title="CREW REWARDS."
        back={back}
      />
      <div className="page-intro">
        <p>Digital gear for putting in the miles.</p>
        <span className="tag">
          {player.tickets} PFUSCH TICKETS · FUTURE USE
        </span>
      </div>
      <div className="reward-grid">
        {REWARDS.map((r) => {
          const claimed = player.redeemedRewards.includes(r.id);
          const future = r.kind === 'future';
          return (
            <article
              key={r.id}
              className={`reward-card ${future ? 'future' : ''}`}
            >
              <div className="reward-art">
                {r.kind === 'coins' ? (
                  <span className="reward-coin">P</span>
                ) : r.kind === 'cosmetic' ? (
                  <span className="rim-art" />
                ) : (
                  <Gift size={52} strokeWidth={1} />
                )}
                <span className="tag">
                  {future ? 'SHOP PREVIEW' : 'DIGITAL REWARD'}
                </span>
              </div>
              <div>
                <h2>{r.title}</h2>
                <p>{r.description}</p>
                <button
                  className={`button ${claimed ? 'equipped' : ''}`}
                  disabled={claimed || future || player.level < r.level}
                  onClick={() => {
                    const p = services.rewards.redeem(player, r.id);
                    if (p) {
                      update(p);
                      notify(`${r.title} collected.`);
                    }
                  }}
                >
                  {future
                    ? 'COMING LATER'
                    : claimed
                      ? 'COLLECTED'
                      : player.level < r.level
                        ? `UNLOCK AT LEVEL ${r.level}`
                        : 'COLLECT REWARD'}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      <p className="catalog-note">
        Shop benefits are previews only. No shipping vouchers, discounts or
        early access are issued in this version.
      </p>
    </main>
  );
}
export function Leaderboard({
  player,
  services,
  back,
}: Base & { services: Services }) {
  const [period, setPeriod] = useState<'Today' | 'This week' | 'All time'>(
    'Today',
  );
  const entries = services.leaderboard.list(player, period);
  return (
    <main className="standard-page narrow">
      <ScreenHeading
        kicker="LOCAL LEADERBOARD"
        title="STREET RANKING."
        back={back}
      />
      <div className="page-intro">
        <p>Your local best, alongside the demo crew.</p>
        <span className="tag">LOCAL / DEMO RANKING</span>
      </div>
      <Tabs value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
        <TabsList className="ranking-tabs" variant="line">
          {(['Today', 'This week', 'All time'] as const).map((p) => (
            <TabsTrigger key={p} value={p}>
              {p.toUpperCase()}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="ranking-list">
        <div className="ranking-head">
          <span>RANK / RIDER</span>
          <span>POINTS</span>
        </div>
        {entries.map((e, i) => (
          <div key={e.name} className={e.you ? 'you' : ''}>
            <span className="rank">
              {i === 0 ? <Trophy size={23} /> : String(i + 1).padStart(2, '0')}
            </span>
            <span className="racer">
              {e.name}
              <small>{e.you ? 'YOUR BEST ON THIS DEVICE' : 'DEMO RIDER'}</small>
            </span>
            <strong>{fmt(e.score)}</strong>
          </div>
        ))}
      </div>
      <p className="catalog-note">
        No scores are uploaded. Today and this week use your dated rides; weeks
        start Monday, UTC.
      </p>
    </main>
  );
}
export function SettingsScreen({
  player,
  services,
  update,
  back,
}: Base & { services: Services; update: (p: Player) => void }) {
  const change = (
    key: 'muted' | 'reducedMotion' | 'quality',
    value: boolean | 'auto' | 'low',
  ) => update({ ...player, settings: { ...player.settings, [key]: value } });
  function exportSave() {
    const blob = new Blob([services.players.export(player)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'pfusch-progress.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <main className="standard-page narrow">
      <ScreenHeading kicker="DIAL IT IN." title="SETTINGS." back={back} />
      <div className="settings-list">
        <div>
          <label htmlFor="sound">
            <b>Engine & sound effects</b>
            <span>Engine, skill feedback and collisions.</span>
          </label>
          <Switch
            id="sound"
            checked={!player.settings.muted}
            onCheckedChange={(v) => change('muted', !v)}
          />
        </div>
        <div>
          <label htmlFor="motion">
            <b>Reduced motion</b>
            <span>Less camera movement. No automatic garage rotation.</span>
          </label>
          <Switch
            id="motion"
            checked={player.settings.reducedMotion}
            onCheckedChange={(v) => change('reducedMotion', v)}
          />
        </div>
        <div>
          <label htmlFor="quality">
            <b>Performance mode</b>
            <span>
              Lower resolution and fewer roadside details for older phones.
            </span>
          </label>
          <Switch
            id="quality"
            checked={player.settings.quality === 'low'}
            onCheckedChange={(v) => change('quality', v ? 'low' : 'auto')}
          />
        </div>
      </div>
      <section className="settings-section">
        <h2>YOUR PROGRESS</h2>
        <p>
          Saved automatically in this browser on this device. No login. Clearing
          browser data removes your progress.
        </p>
        <button className="button" onClick={exportSave}>
          <Download size={18} /> EXPORT SAVE BACKUP
        </button>
      </section>
      <section className="settings-section">
        <h2>THE CONTROLS</h2>
        <div className="control-guide">
          <span>
            SWIPE ← → / A D <b>Dodge</b>
          </span>
          <span>
            HOLD FORWARD / W / ↑ <b>Weight forward / correct</b>
          </span>
          <span>
            WHEELIE / S / ↓ <b>Throttle / weight back</b>
          </span>
          <span>
            ESC / P <b>Pause</b>
          </span>
        </div>
        <p>
          Raise the front with short throttle inputs. Release below the balance
          marker and hold forward weight to recover. Holding throttle too long
          can overrotate the bike. Steady balance, duration and speed build
          score. Close lateral dodges earn near misses. Dodge traffic or clear a
          low road edge with the front already raised.
        </p>
      </section>
      <footer className="settings-section">
        <span className="eyebrow">PFUSCH STREET RUN · V1.0</span>
        <p>Real streets are not a racetrack. Keep the risk in the game.</p>
        <a
          className="product-link"
          href="https://pfusch-clothing.ch/"
          target="_blank"
          rel="noopener noreferrer"
        >
          PFUSCH CLOTHING ↗
        </a>
      </footer>
    </main>
  );
}
