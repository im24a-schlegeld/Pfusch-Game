import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  CircleCheck,
  Coins,
  Disc3,
  Download,
  Gift,
  Globe2,
  Lock,
  Mail,
  Medal,
  Palette,
  Repeat2,
  Route,
  Sparkles,
  Target,
  Trophy,
  Zap,
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Player } from '../domain/types';
import type { LeaderboardSnapshot, Services } from '../services';
import RealRewardCard from './RealRewardCard';
import {
  LEVELS,
  LEVEL_NAMES,
  REWARDS,
} from '../domain/config';
import { Coin, ScreenHeading, XpBar, fmt } from './shared';
import { dayKey, normalizeLeaderboardName, refreshDaily } from '../domain/progression';
import { dailyChallengesForDate } from '../domain/dailyChallenges';
import { useTouchInput } from './useTouchInput';
import './ride-touch-controls.css';
interface Base {
  player: Player;
  back: () => void;
}
export function Challenges({
  player,
  back,
  start,
}: Base & { start: () => void }) {
  const [date, setDate] = useState(dayKey);
  useEffect(() => {
    const midnight = Date.parse(`${date}T00:00:00Z`) + 86_400_000;
    const timer = window.setTimeout(() => setDate(dayKey()), Math.max(1, midnight - Date.now()));
    return () => window.clearTimeout(timer);
  }, [date]);
  const daily = refreshDaily(player, date).challenges;
  const challenges = dailyChallengesForDate(date);
  const completed = challenges.filter((challenge) => daily.claimed.includes(challenge.id)).length;
  const remaining = challenges.filter((challenge) => !daily.claimed.includes(challenge.id));
  return (
    <main className="standard-page">
      <ScreenHeading
        kicker=""
        title="TÄGLICHE AUFGABEN."
        back={back}
      />
      <div className="page-intro">
        <div className="page-feature"><Target aria-hidden="true" /><p>
          Sammle Coins und XP. Alle heutigen Fahrten zählen.
        </p></div>
        <span className="tag">NEU AB 00:00 UTC</span>
      </div>
      <div className="progress-overview" aria-label="Tagesübersicht">
        <div><CircleCheck aria-hidden="true" /><b>{completed} / {challenges.length}</b><span>ERLEDIGT</span></div>
        <div><Coins aria-hidden="true" /><b>+{remaining.reduce((sum, entry) => sum + entry.coins, 0)}</b><span>COINS OFFEN</span></div>
        <div><Sparkles aria-hidden="true" /><b>+{remaining.reduce((sum, entry) => sum + entry.xp, 0)}</b><span>XP OFFEN</span></div>
      </div>
      <div className="challenge-grid">
        {challenges.map((c, i) => {
          const value = Math.max(0, Math.min(c.target, daily.values[c.id] ?? 0));
          const complete = daily.claimed.includes(c.id);
          const Icon = c.stat === 'runs' ? Repeat2 : c.stat === 'distance' ? Route : c.stat === 'nearMisses' ? Zap : Target;
          const unit = c.stat === 'runs' ? 'Fahrten' : c.stat === 'distance' || c.stat === 'wheelie' ? 'm' : c.stat === 'nearMisses' ? 'knappe Manöver' : c.stat === 'score' ? 'Punkte' : 'Sprünge';
          return (
            <article
              key={c.id}
              className={`challenge-card ${complete ? 'complete' : ''}`}
            >
              <div className="challenge-top">
                <span>0{i + 1}</span>
                <span className="mission-symbol">{complete ? <CircleCheck aria-hidden="true" /> : <Icon aria-hidden="true" />}</span>
              </div>
              <h2>{c.title}</h2>
              <p>{c.description}</p>
              <div className="challenge-count">
                <b>{fmt(value)}</b>
                <span>/ {fmt(c.target)} {unit}</span>
              </div>
              <Progress
                value={(value / c.target) * 100}
                aria-label={`${c.title} Fortschritt`}
              />
              <p className="mission-remaining">{complete ? 'Belohnung gutgeschrieben.' : `Noch ${fmt(c.target - value)} ${unit}.`}</p>
              <div className="challenge-reward">
                <span><Sparkles size={15} aria-hidden="true" /> +{c.xp} XP</span>
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
          FAHRT STARTEN <ArrowRight />
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
        kicker=""
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
  const rewards = REWARDS.filter((reward) => reward.kind !== 'future');
  const ready = rewards.filter((reward) => reward.level <= player.level && !player.redeemedRewards.includes(reward.id));
  return (
    <main className="standard-page">
      <ScreenHeading
        kicker=""
        title="BELOHNUNGEN."
        back={back}
      />
      <div className="page-intro">
        <div className="page-feature"><Gift aria-hidden="true" /><p>Erreiche das angegebene Level und hole deine Belohnung ab.</p></div>
        <span className="tag">{ready.length} VERFÜGBAR</span>
      </div>
      <div className="reward-grid">
        {rewards.map((r) => {
          const claimed = player.redeemedRewards.includes(r.id);
          const available = player.level >= r.level;
          const Icon = r.kind === 'coins' ? Coins : r.id === 'exclusive-rims' ? Disc3 : Palette;
          const neededXp = Math.max(0, (LEVELS[r.level - 1] ?? 0) - player.xp);
          return (
            <article
              key={r.id}
              className={`reward-card ${claimed ? 'claimed' : available ? 'available' : 'locked'}`}
            >
              <div className="reward-art">
                <Icon className="reward-symbol" size={60} strokeWidth={1.5} aria-hidden="true" />
                <span className="tag">
                  LEVEL {r.level}
                </span>
              </div>
              <div>
                <h2>{r.title}</h2>
                <p>{r.description}</p>
                <span className="reward-unlock"><Medal size={15} aria-hidden="true" />{claimed ? 'Gutgeschrieben' : available ? 'Einmalig abholbar' : `Noch ${fmt(neededXp)} XP bis Level ${r.level}`}</span>
                <button
                  className={`button ${claimed ? 'equipped' : ''}`}
                  disabled={claimed || !available}
                  onClick={() => {
                    const p = services.rewards.redeem(player, r.id);
                    if (p) {
                      update(p);
                      notify(`${r.title} erhalten.`);
                    }
                  }}
                >
                  {claimed ? <><CircleCheck size={16} aria-hidden="true" /> ERHALTEN</>
                    : !available ? <><Lock size={15} aria-hidden="true" /> AB LEVEL {r.level}</>
                      : <><Gift size={16} aria-hidden="true" /> ABHOLEN</>}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      <p className="catalog-note">
        Alle Level-Belohnungen gelten im Spiel. Ausrüstung findest du in der Garage.
      </p>
      <RealRewardCard service={services.rewards.real} onSignIn={services.auth.login} />
      <button className="button small" onClick={back}>ZUR GARAGE <ArrowRight size={16} aria-hidden="true" /></button>
    </main>
  );
}
export function Leaderboard({
  player,
  services,
  update,
  back,
}: Base & { services: Services; update: (player: Player) => void }) {
  const [period, setPeriod] = useState<'Today' | 'This week' | 'All time'>(
    'Today',
  );
  const [result, setResult] = useState<{ snapshot: LeaderboardSnapshot | null; loading: boolean; error: boolean }>({ snapshot: null, loading: true, error: false });
  const [revision, setRevision] = useState(0);
  const saveRevision = useRef(0);
  const [draftName, setDraftName] = useState(player.leaderboardName);
  useEffect(() => setDraftName(player.leaderboardName), [player.leaderboardName]);
  useEffect(() => {
    let previous = services.players.syncStatus?.state;
    return services.players.subscribeSync?.(() => {
      const next = services.players.syncStatus?.state;
      if (previous === 'saving' && next !== 'saving') {
        // Invalidate an older fetch immediately, before React runs its cleanup.
        // A confirmed fifth trial save can finish as unavailable, not synced.
        saveRevision.current += 1;
        setRevision((value) => value + 1);
      }
      previous = next;
    });
  }, [services.players]);
  useEffect(() => {
    let current = true;
    const savedAtStart = saveRevision.current;
    setResult({ snapshot: null, loading: true, error: false });
    const fetch = services.leaderboard.fetch;
    if (!fetch) {
      setResult({ snapshot: { entries: services.leaderboard.list(player, period), source: 'local', message: 'Deine gespeicherten Fahrten auf diesem Gerät.' }, loading: false, error: false });
      return;
    }
    void (async () => {
      // The server attempts the ranking update before acknowledging a queued save.
      await services.players.flush?.();
      if (!current || savedAtStart !== saveRevision.current) return;
      const snapshot = await fetch.call(services.leaderboard, player, period);
      if (current && savedAtStart === saveRevision.current) setResult({ snapshot, loading: false, error: false });
    })().catch(() => {
      if (current && savedAtStart === saveRevision.current) setResult({ snapshot: null, loading: false, error: true });
    });
    return () => { current = false; };
  }, [services.leaderboard, services.players, player, period, revision]);
  const entries = result.snapshot?.entries ?? [];
  const online = result.snapshot?.source === 'shopify';
  const normalizedName = normalizeLeaderboardName(draftName);
  const invalidName = Boolean(draftName.trim()) && !normalizedName;
  return (
    <main className="standard-page narrow">
      <ScreenHeading
        kicker=""
        title="RANGLISTE."
        back={back}
      />
      <div className="page-intro">
        <div className="page-feature"><Trophy aria-hidden="true" /><p>{online ? 'Die besten Fahrten der Community.' : 'Deine Bestleistungen im gewählten Zeitraum.'}</p></div>
        <span className="tag">{online ? <Globe2 size={13} aria-hidden="true" /> : <Route size={13} aria-hidden="true" />}{online ? 'COMMUNITY' : 'DEINE BESTWERTE'}</span>
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
      <section className="settings-section leaderboard-name-form" aria-labelledby="leaderboard-name-title">
        <h2 id="leaderboard-name-title">DEIN RANGLISTENNAME</h2>
        <p>Ohne Namen erscheinst du als „DU“.</p>
        <label htmlFor="leaderboard-name">Anzeigename</label>
        <input
          id="leaderboard-name"
          type="text"
          value={draftName}
          maxLength={24}
          // Valid HTML autofill token; retained for the player's public display name.
          // eslint-disable-next-line jsx-a11y/autocomplete-valid
          autoComplete="nickname"
          placeholder="Dein Name"
          onChange={(event) => setDraftName(event.target.value)}
        />
        {invalidName && <p role="alert">Nutze maximal 24 Zeichen ohne Steuerzeichen.</p>}
        <button
          className="button small"
          disabled={invalidName || normalizedName === player.leaderboardName}
          onClick={() => update({ ...player, leaderboardName: normalizedName })}
        >
          NAMEN SPEICHERN
        </button>
      </section>
      {result.loading && <output className="ranking-state"><span className="spinner" /> BESTWERTE WERDEN GELADEN</output>}
      {result.error && <div className="ranking-state"><p>Die Rangliste ist gerade nicht erreichbar.</p><button className="button small" onClick={() => setRevision((value) => value + 1)}>ERNEUT LADEN</button></div>}
      {!result.loading && !result.error && entries.length === 0 && <div className="ranking-state"><Trophy size={32} aria-hidden="true" /><h2>NOCH KEINE FAHRTEN.</h2><p>Nach deiner ersten Fahrt erscheint hier dein Punktestand.</p><button className="button small" onClick={back}>ZUR GARAGE <ArrowRight size={16} aria-hidden="true" /></button></div>}
      {entries.length > 0 && <>
      <div className="ranking-list">
        <div className="ranking-head">
          <span>{online ? 'RANG / FAHRER' : 'FAHRER / BESTLEISTUNG'}</span>
          <span>PUNKTE</span>
        </div>
        {entries.map((e, i) => (
          <div key={`${i}:${e.name}`} className={e.you ? 'you' : ''}>
            <span className="rank">
              {i === 0 ? <Trophy size={23} /> : String(i + 1).padStart(2, '0')}
            </span>
            <span className="racer">
              {e.name}
              <small>{e.you ? 'DEINE BESTLEISTUNG' : 'COMMUNITY-FAHRER'}</small>
            </span>
            <strong>{fmt(e.score)}</strong>
          </div>
        ))}
      </div>
      </>}
      {result.snapshot && <p className="catalog-note">{result.snapshot.message}</p>}
    </main>
  );
}
export function SettingsScreen({
  player,
  services,
  update,
  back,
  onTutorial,
  onAccess,
  loginHref,
  backLabel,
  duringRide = false,
}: Base & { services: Services; update: (p: Player) => void; onTutorial?: () => void; onAccess?: () => void; loginHref?: string; backLabel?: string; duringRide?: boolean }) {
  const { touchCapable } = useTouchInput();
  const buttonMode = player.settings.touchControls === 'buttons';
  const syncStatus = services.players.syncStatus;
  const access = services.players.getAccess?.();
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
      <ScreenHeading kicker="" title="EINSTELLUNGEN." back={back} backLabel={backLabel} />
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
            <span>Weniger Kamerabewegung, keine automatische Drehung in der Garage.</span>
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
        {syncStatus && <output className="mb-3 block">{syncStatus.message}</output>}
        <p>
          {access && !access.allowed
            ? 'Neue Fahrten und das Speichern sind pausiert, bis dein Zugang bestätigt ist. Bereits gespeicherter Fortschritt bleibt erhalten.'
            : syncStatus && player.id.startsWith('shopify:')
            ? 'Dein Spielstand gehört zu deinem Shop-Konto. Der Speicherstatus zeigt, ob der aktuelle Fortschritt bereits im Konto gesichert ist.'
            : syncStatus
              ? 'Ohne verbundenes Shop-Konto bleibt dein Gastspielstand auf diesem Gerät. Beim Löschen der Browserdaten kann er verloren gehen.'
              : 'Dein Fortschritt wird automatisch auf diesem Gerät gespeichert. Beim Löschen der Browserdaten kann der Spielstand verloren gehen.'}
        </p>
        {access && access.reason !== 'subscribed' && <p>{Math.min(access.completedRuns, access.freeRuns)} von {access.freeRuns} freien Fahrten abgeschlossen. Danach ist ein aktives PFUSCH-Newsletter-Abo für weitere Fahrten und neue Spielstände nötig.</p>}
        {onAccess && <button className="button mb-3" onClick={onAccess}><Mail size={18} aria-hidden="true" /> NEWSLETTER-STATUS</button>}
        {!duringRide && !player.id.startsWith('shopify:') && (loginHref ? <a className="button mb-3" href={loginHref} target="_top" rel="noopener">MIT PFUSCH-KONTO ANMELDEN</a>
          : services.auth.login && <button className="button mb-3" onClick={services.auth.login}>MIT PFUSCH-KONTO ANMELDEN</button>)}
        <button className="button" onClick={exportSave}>
          <Download size={18} /> SPIELSTAND EXPORTIEREN
        </button>
      </section>
      <section className="settings-section">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2>STEUERUNG</h2>
          {onTutorial && <button className="button small" onClick={onTutorial}>
            <Repeat2 size={18} aria-hidden="true" /> SPIELHINWEISE ANSEHEN
          </button>}
        </div>
        {touchCapable && <fieldset className="touch-control-options">
          <legend>Touch-Steuerung</legend>
          <label aria-label="Wischen"><input type="radio" name="touch-controls" value="swipe" checked={!buttonMode}
            onChange={() => update({ ...player, settings: { ...player.settings, touchControls: 'swipe' } })} />
            <span><b>Wischen</b><small>Zum Anheben und Senken ziehen.</small></span></label>
          <label aria-label="Tasten"><input type="radio" name="touch-controls" value="buttons" checked={buttonMode}
            onChange={() => update({ ...player, settings: { ...player.settings, touchControls: 'buttons' } })} />
            <span><b>Tasten</b><small>Wheelie und Bremse gedrückt halten.</small></span></label>
        </fieldset>}
        <div className="control-guide">
          <span>
            WISCHEN ← → / A D <b>Ausweichen</b>
          </span>
          <span>
            {buttonMode ? 'BREMSE HALTEN' : 'NACH OBEN'} / W / ↑ <b>Vorderrad senken</b>
          </span>
          <span>
            {buttonMode ? 'WHEELIE HALTEN' : 'NACH UNTEN'} / S / ↓ <b>Vorderrad anheben</b>
          </span>
          <span>
            ZWEI FINGER / ESC / P <b>Pause</b>
          </span>
        </div>
        <p>
          {buttonMode ? 'Touch: Wheelie halten hebt das Vorderrad an, Bremse halten senkt es. Loslassen ist neutral. Seitlich wischen zum Ausweichen.' : 'Touch: nach unten ziehen hebt das Vorderrad an, nach oben ziehen senkt es. Seitlich wischen zum Ausweichen.'} Zwei Finger auf der Fahrfläche oder die Pausentaste pausieren. Tastatur: A/D oder Pfeile seitlich, S/↓ anheben, W/↑ senken. Wheelies, knappe Manöver und Stunts bringen die meisten Punkte. P F U S C H komplett sammeln gibt einen Set-Bonus.
        </p>
      </section>
      <footer className="settings-section">
        <span className="eyebrow">WHEELIE ESCAPE · PFUSCH · V1.0</span>
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
