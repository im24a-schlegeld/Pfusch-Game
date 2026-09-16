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
        kicker="EIN GRUND FÜR NOCH EINE."
        title="TÄGLICHE AUFGABEN."
        back={back}
      />
      <div className="page-intro">
        <p>
          Kurze Aufgaben. Direkte Belohnungen. Fortschritt zählt über alle Fahrten.
        </p>
        <span className="tag">NEU AB 00:00 UTC</span>
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
                <span>0{i + 1} / TÄGLICH</span>
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
                aria-label={`${c.title} Fortschritt`}
              />
              <div className="challenge-reward">
                <span>+{c.xp} XP</span>
                <Coin value={c.coins} />
                {complete && <b>ERHALTEN</b>}
              </div>
            </article>
          );
        })}
      </div>
      <div className="challenge-footer">
        <p>Belohnungen werden nach einer Fahrt automatisch gutgeschrieben.</p>
        <button className="button primary" onClick={start}>
          LOSFAHREN <ArrowRight />
        </button>
      </div>
    </main>
  );
}
export function ProgressContent({ player }: { player: Player }) {
  return (
    <>
      <div className="section-intro">
        <p className="eyebrow">DEIN FORTSCHRITT</p>
        <h2>{LEVEL_NAMES[player.level - 1]}</h2>
      </div>
      <XpBar player={player} />
      <div className="lifetime-stats">
        <div>
          <b>{fmt(player.runsPlayed)}</b>
          <span>FAHRTEN</span>
        </div>
        <div>
          <b>{(player.totalDistance / 1000).toFixed(1)} km</b>
          <span>DISTANZ</span>
        </div>
        <div>
          <b>{fmt(player.highScore)}</b>
          <span>BESTLEISTUNG</span>
        </div>
        <div>
          <b>{fmt(player.totalNearMisses)}</b>
          <span>KNAPPE MANÖVER</span>
        </div>
        <div>
          <b>{fmt(player.totalWheelieMeters)} m</b>
          <span>AUF EINEM RAD</span>
        </div>
        <div>
          <b>{player.ownedItems.length}</b>
          <span>FREIGESCHALTET</span>
        </div>
      </div>
      <h3 className="custom-label">DEIN LEVEL</h3>
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
                  ? 'Töffli + 150 Start-Coins'
                  : i === 2
                    ? 'Supermoto verfügbar'
                    : i === 4
                      ? 'After-Hours-Felgen verfügbar'
                      : i === 5
                        ? 'Sport verfügbar'
                        : `${fmt(xp)} XP gesamt`}
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
        kicker="JEDE FAHRT ZÄHLT."
        title="FORTSCHRITT."
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
        kicker="IM SPIEL VERDIENT."
        title="BELOHNUNGEN."
        back={back}
      />
      <div className="page-intro">
        <p>Digitale Extras für deinen Fortschritt.</p>
        <span className="tag">
          {player.tickets} PFUSCH TICKETS · SPÄTER NUTZBAR
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
                  {future ? 'VORSCHAU' : 'DIGITALE BELOHNUNG'}
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
                      notify(`${r.title} erhalten.`);
                    }
                  }}
                >
                  {future
                    ? 'KOMMT SPÄTER'
                    : claimed
                      ? 'ERHALTEN'
                      : player.level < r.level
                        ? `AB LEVEL ${r.level}`
                        : 'BELOHNUNG HOLEN'}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      <p className="catalog-note">
        Shop-Vorteile sind in dieser Version nur Vorschau. Es werden keine Gutscheine, Rabatte oder Frühzugang-Vorteile ausgegeben.
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
        kicker="LOKALE RANGLISTE"
        title="RANGLISTE."
        back={back}
      />
      <div className="page-intro">
        <p>Deine lokale Bestleistung neben den Demo-Fahrern.</p>
        <span className="tag">LOKAL / DEMO</span>
      </div>
      <Tabs value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
        <TabsList className="ranking-tabs" variant="line">
          {(['Today', 'This week', 'All time'] as const).map((p) => (
            <TabsTrigger key={p} value={p}>
              {p === 'Today' ? 'HEUTE' : p === 'This week' ? 'DIESE WOCHE' : 'GESAMT'}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="ranking-list">
        <div className="ranking-head">
          <span>RANG / FAHRER</span>
          <span>PUNKTE</span>
        </div>
        {entries.map((e, i) => (
          <div key={e.name} className={e.you ? 'you' : ''}>
            <span className="rank">
              {i === 0 ? <Trophy size={23} /> : String(i + 1).padStart(2, '0')}
            </span>
            <span className="racer">
              {e.name}
              <small>{e.you ? 'DEIN BESTER WERT AUF DIESEM GERÄT' : 'DEMO-FAHRER'}</small>
            </span>
            <strong>{fmt(e.score)}</strong>
          </div>
        ))}
      </div>
      <p className="catalog-note">
        Punktestände werden nicht hochgeladen. Heute und diese Woche basieren nur auf den lokal gespeicherten Fahrten.
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
      <ScreenHeading kicker="STELL ES EIN." title="EINSTELLUNGEN." back={back} />
      <div className="settings-list">
        <div>
          <label htmlFor="sound">
            <b>Motor & Soundeffekte</b>
            <span>Motor, Feedback und Kollisionen.</span>
          </label>
          <Switch
            id="sound"
            checked={!player.settings.muted}
            onCheckedChange={(v) => change('muted', !v)}
          />
        </div>
        <div>
          <label htmlFor="motion">
            <b>Reduzierte Bewegung</b>
            <span>Weniger Kamerabewegung. Keine automatische Garage-Rotation.</span>
          </label>
          <Switch
            id="motion"
            checked={player.settings.reducedMotion}
            onCheckedChange={(v) => change('reducedMotion', v)}
          />
        </div>
        <div>
          <label htmlFor="quality">
            <b>Performance-Modus</b>
            <span>
              Niedrigere Auflösung und weniger Details für ältere Geräte.
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
        <h2>DEIN FORTSCHRITT</h2>
        <p>
          Der Fortschritt wird automatisch in diesem Browser gespeichert. Kein Login. Beim Löschen der Browserdaten geht der Spielstand verloren.
        </p>
        <button className="button" onClick={exportSave}>
          <Download size={18} /> SPIELSTAND EXPORTIEREN
        </button>
      </section>
      <section className="settings-section">
        <h2>STEUERUNG</h2>
        <div className="control-guide">
          <span>
            WISCHEN ← → / A D <b>Ausweichen</b>
          </span>
          <span>
            NACH OBEN / W / ↑ <b>Gewicht vor / korrigieren</b>
          </span>
          <span>
            NACH UNTEN / S / ↓ <b>Gas / Gewicht zurück</b>
          </span>
          <span>
            ZWEI FINGER / ESC / P <b>Pause</b>
          </span>
        </div>
        <p>
          Touch: nach unten ziehen = Gewicht zurück, nach oben = korrigieren, seitlich = ausweichen. Zwei Finger pausieren. Tastatur: A/D oder Pfeile seitlich, S/↓ zurück, W/↑ vor. Wheelies, knappe Manöver und Stunts bringen die meisten Punkte. P F U S C H komplett sammeln gibt einen Set-Bonus.
        </p>
      </section>
      <footer className="settings-section">
        <span className="eyebrow">PFUSCH · V1.0</span>
        <p>Echte Strassen sind keine Rennstrecke. Risiko bleibt im Spiel.</p>
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
