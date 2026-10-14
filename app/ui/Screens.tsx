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
  UserPlus,
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
import { dailySignMask } from '../domain/dailySigns';
import { isReferralCode, rankedGameShare, sharePeriodLabel, type SharePeriod } from '../domain/gameShare';
import { ShareAction } from './GameShare';
import OfflineSettings from './OfflineSettings';
import SignProgress from './SignProgress';
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
  const challenges = dailyChallengesForDate(date).sort((a, b) => Number(b.stat === 'signs') - Number(a.stat === 'signs'));
  const completed = challenges.filter((challenge) => daily.claimed.includes(challenge.id)).length;
  const remaining = challenges.filter((challenge) => !daily.claimed.includes(challenge.id));
  return (
    <main className="standard-page menu-page tasks-page">
      <ScreenHeading
        kicker=""
        title="Tägliche Aufgaben."
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
          const unit = c.stat === 'runs' ? 'Fahrten' : c.stat === 'distance' || c.stat === 'wheelie' ? 'm' : c.stat === 'nearMisses' ? 'knappe Manöver' : c.stat === 'score' ? 'Punkte' : c.stat === 'signs' ? 'Zeichen' : 'Sprünge';
          return (
            <article
              key={c.id}
              className={`challenge-card ${complete ? 'complete' : ''} ${c.stat === 'signs' ? 'pfusch-daily-task' : ''}`}
              data-testid={c.stat === 'signs' ? 'daily-pfusch-task' : undefined}
            >
              <div className="challenge-top">
                <span className="mission-index" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                <span className="mission-symbol">{complete ? <CircleCheck aria-hidden="true" /> : <Icon aria-hidden="true" />}</span>
                {complete && <span className="mission-status">Erledigt</span>}
              </div>
              <h2>{c.title}</h2>
              <p>{c.description}</p>
              {c.stat === 'signs' && <SignProgress mask={dailySignMask(daily, date)} />}
              {c.stat !== 'signs' && <><div className="challenge-count">
                <b>{fmt(value)}</b>
                <span>/ {fmt(c.target)} {unit}</span>
              </div>
              <Progress
                value={(value / c.target) * 100}
                aria-label={`${c.title} Fortschritt`}
              />
              </>}
              <p className="mission-remaining">{complete ? 'Belohnung gutgeschrieben.' : c.stat === 'signs' ? 'Jedes Zeichen einmal · über alle heutigen Fahrten.' : `Noch ${fmt(c.target - value)} ${unit}.`}</p>
              <div className="challenge-reward">
                {c.xp > 0 && <span><Sparkles size={15} aria-hidden="true" /> +{c.xp} XP</span>}
                {c.stat === 'signs' && <span>+45 Punkte je Zeichen</span>}
                <Coin value={c.coins} />
                {complete && <b>ERHALTEN</b>}
              </div>
            </article>
          );
        })}
      </div>
      <div className="challenge-footer">
        <p>PFUSCH zählt direkt beim Einsammeln und bringt einmal pro Tag 120 Coins. Die anderen Aufgaben werden nach einer Fahrt gutgeschrieben.</p>
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
    <main className="standard-page narrow menu-page progress-page">
      <ScreenHeading
        kicker=""
        title="Fortschritt."
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
  loginHref,
  onLogin,
}: Base & {
  services: Services;
  update: (p: Player) => void;
  notify: (s: string) => void;
  loginHref?: string;
  onLogin?: () => void;
}) {
  const rewards = REWARDS.filter((reward) => reward.kind !== 'future');
  const ready = rewards.filter((reward) => reward.level <= player.level && !player.redeemedRewards.includes(reward.id));
  return (
    <main className="standard-page menu-page rewards-page">
      <ScreenHeading
        kicker=""
        title="Belohnungen."
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
              <div className="reward-content">
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
      <RealRewardCard service={services.rewards.real} loginHref={loginHref} onSignIn={onLogin ?? services.auth.login} />
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
  const [result, setResult] = useState<{ snapshot: LeaderboardSnapshot | null; period: string; date: string; loading: boolean; error: boolean }>({ snapshot: null, period, date: dayKey(), loading: true, error: false });
  const [revision, setRevision] = useState(0);
  const saveRevision = useRef(0);
  const [draftName, setDraftName] = useState(player.leaderboardName);
  const [invite, setInvite] = useState<{ code: string | null; loading: boolean }>({ code: null, loading: !!services.invites });
  useEffect(() => {
    let current = true;
    setInvite({ code: null, loading: !!services.invites });
    if (services.invites) void services.invites.getInvite().then((result) => {
      const code = result?.code;
      if (current) setInvite({ code: isReferralCode(code) ? code : null, loading: false });
    }).catch(() => { if (current) setInvite({ code: null, loading: false }); });
    return () => { current = false; };
  }, [services.invites, player.id]);
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
    const date = dayKey();
    setResult({ snapshot: null, period, date, loading: true, error: false });
    const fetch = services.leaderboard.fetch;
    if (!fetch) {
      setResult({ snapshot: { entries: services.leaderboard.list(player, period), source: 'local', message: 'Deine gespeicherten Fahrten auf diesem Gerät.' }, period, date, loading: false, error: false });
      return;
    }
    void (async () => {
      // The server attempts the ranking update before acknowledging a queued save.
      await services.players.flush?.();
      if (!current || savedAtStart !== saveRevision.current) return;
      const snapshot = await fetch.call(services.leaderboard, player, period);
      if (current && savedAtStart === saveRevision.current) setResult({ snapshot, period, date, loading: false, error: false });
    })().catch(() => {
      if (current && savedAtStart === saveRevision.current) setResult({ snapshot: null, period, date, loading: false, error: true });
    });
    return () => { current = false; };
  }, [services.leaderboard, services.players, player, period, revision]);
  const entries = result.snapshot?.entries ?? [];
  const online = result.snapshot?.source === 'shopify';
  const normalizedName = normalizeLeaderboardName(draftName);
  const invalidName = Boolean(draftName.trim()) && !normalizedName;
  const sharePeriod: SharePeriod = period === 'Today' ? 'day' : period === 'This week' ? 'week' : 'all';
  const rankShare = !result.loading && !result.error && result.period === period
    ? rankedGameShare(result.snapshot, sharePeriod, result.date) : null;
  return (
    <main className="standard-page narrow menu-page ranking-page">
      <ScreenHeading
        kicker=""
        title="Rangliste."
        back={back}
      />
      <div className="page-intro">
        <div className="page-feature"><Trophy aria-hidden="true" /><p>{online ? 'Die besten Fahrten der Community.' : 'Deine Bestleistungen im gewählten Zeitraum.'}</p></div>
        <span className="tag">{online ? <Globe2 size={13} aria-hidden="true" /> : <Route size={13} aria-hidden="true" />}{online ? 'COMMUNITY' : 'DEINE BESTWERTE'}</span>
      </div>
      <section className="game-share-section" aria-label="Bestleistung teilen">
        <div className="game-share-record">
          <div><span>DEIN HIGHSCORE</span><strong>{fmt(player.highScore)} <small>PUNKTE</small></strong></div>
          <ShareAction label="TEILEN" share={{ kind: 'score', score: player.highScore, name: player.leaderboardName, date: dayKey() }} />
        </div>
        {rankShare && <div className="game-share-record game-share-rank">
          <p><b>Platz {rankShare.rank}</b><small>{sharePeriodLabel(rankShare.period, rankShare.date)}</small></p>
          <ShareAction label="RANG TEILEN" share={rankShare} />
        </div>}
      </section>
      <Tabs value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
        <TabsList className="ranking-tabs" variant="line">
          {(['Today', 'This week', 'All time'] as const).map((p) => (
            <TabsTrigger key={p} value={p}>
              {p === 'Today' ? 'HEUTE' : p === 'This week' ? 'DIESE WOCHE' : 'GESAMT'}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {result.loading && <output className="ranking-state" aria-live="polite"><span className="spinner" /> BESTWERTE WERDEN GELADEN</output>}
      {result.error && <div className="ranking-state"><p>Die Rangliste ist gerade nicht erreichbar.</p><button className="button small" onClick={() => setRevision((value) => value + 1)}>ERNEUT LADEN</button></div>}
      {!result.loading && !result.error && entries.length === 0 && <div className="ranking-state"><Trophy size={32} aria-hidden="true" /><h2>NOCH KEINE FAHRTEN.</h2><p>Nach deiner ersten Fahrt erscheint hier dein Punktestand.</p><button className="button small" onClick={back}>ZUR GARAGE <ArrowRight size={16} aria-hidden="true" /></button></div>}
      {entries.length > 0 && <>
      <div className="ranking-list" role="table" aria-colcount={3} aria-label={online ? 'Community-Rangliste' : 'Deine Bestleistungen'}>
        <div className="ranking-head" role="row">
          <span role="columnheader" aria-colspan={2}>{online ? 'RANG / FAHRER' : 'FAHRER / BESTLEISTUNG'}</span>
          <span role="columnheader" aria-colindex={3}>PUNKTE</span>
        </div>
        {entries.map((e, i) => (
          <div key={`${i}:${e.name}`} className={e.you ? 'you' : ''} role="row">
            <span className="rank" role="cell" aria-label={`Platz ${i + 1}`}>
              {i === 0 ? <Trophy size={23} aria-hidden="true" /> : String(i + 1).padStart(2, '0')}
            </span>
            <span className="racer" role="cell">
              {e.name}
              <small>{e.you ? 'DEINE BESTLEISTUNG' : 'COMMUNITY-FAHRER'}</small>
            </span>
            <strong role="cell">{fmt(e.score)}</strong>
          </div>
        ))}
      </div>
      </>}
      {result.snapshot && <p className="catalog-note">{result.snapshot.message}</p>}
      <details className="ranking-name-editor">
        <summary><span>Anzeigenamen bearbeiten</span><strong>{player.leaderboardName || 'DU'}</strong></summary>
        <section className="settings-section leaderboard-name-form" aria-labelledby="leaderboard-name-title">
          <h2 id="leaderboard-name-title">Dein Ranglistenname</h2>
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
      </details>
      <section className="game-invite-section" aria-labelledby="invite-heading">
        <div className="game-invite-heading"><UserPlus size={22} aria-hidden="true" /><h2 id="invite-heading">Freunde einladen.</h2></div>
        {invite.code ? <><p className="game-invite-offer">Aktuell <strong>150</strong> statt <s>100</s> Coins <strong>+ 1 Guardian Bell</strong> pro erfolgreicher Einladung.</p>
          <p className="game-invite-detail">Wenn dein Freund sich anmeldet und seine erste Fahrt beendet.</p></>
          : <p className="game-invite-detail">{invite.loading ? 'Dein persönlicher Einladungslink wird geladen …' : 'Mit Online-Anmeldung kannst du Einladungs-Coins verdienen. Im Moment teilst du ohne Belohnung.'}</p>}
        <ShareAction label="FREUND EINLADEN" disabled={invite.loading} share={{ kind: 'invite', name: player.leaderboardName, ...(invite.code ? { referral: invite.code } : {}) }} />
      </section>
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
  accountKind = 'guest',
}: Base & { services: Services; update: (p: Player) => void; onTutorial?: () => void; onAccess?: () => void; loginHref?: string; backLabel?: string; duringRide?: boolean; accountKind?: 'guest' | 'customer' }) {
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
    <main className="standard-page narrow menu-page settings-page">
      <ScreenHeading kicker="" title="EINSTELLUNGEN." back={back} backLabel={backLabel} />
      <p className="settings-intro">Passe Bild, Ton und Bedienung an dich an.</p>
      <section className="settings-section settings-preferences" aria-labelledby="settings-preferences-title">
      <h2 id="settings-preferences-title">Bild & Ton</h2>
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
            <span>Ruhigere Kamera und eine stehende Garagenvorschau.</span>
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
              Weniger Details für schwächere Geräte. Standard ist hohe Bildqualität.
            </span>
          </label>
          <Switch
            id="quality"
            checked={player.settings.quality === 'low'}
            onCheckedChange={(v) => change('quality', v ? 'low' : 'auto')}
          />
        </div>
      </div>
      </section>
      <section className="settings-section settings-controls" aria-labelledby="settings-controls-title">
        <div className="settings-section-heading">
          <h2 id="settings-controls-title">Steuerung</h2>
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
        <p className="settings-control-summary">{buttonMode ? 'Wheelie oder Bremse gedrückt halten. Seitlich wischen zum Ausweichen.' : 'Nach unten ziehen für einen Wheelie, nach oben zum Senken. Seitlich wischen zum Ausweichen.'}</p>
        <details className="settings-help">
        <summary>Gesten & Tastatur im Überblick</summary>
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
          Zwei Finger auf der Fahrfläche oder die Pausentaste pausieren. Wheelies, knappe Manöver und Stunts bringen die meisten Punkte. Jedes PFUSCH-Zeichen bringt 45 Punkte. Sammle täglich P, F, U, S, C und H für 120 Coins.
        </p>
        </details>
      </section>
      <section className="settings-section settings-account" aria-labelledby="settings-account-title">
        <h2 id="settings-account-title">Konto & Spielstand</h2>
        {syncStatus && <output className="settings-save-status" aria-live="polite">{syncStatus.message}</output>}
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
        <div className="settings-actions">
          {!duringRide && accountKind === 'guest' && (loginHref ? <a className="button" href={loginHref} target="_top" rel="noopener">MIT PFUSCH-KONTO ANMELDEN</a>
            : services.auth.login && <button className="button" onClick={services.auth.login}>MIT PFUSCH-KONTO ANMELDEN</button>)}
          {onAccess && <button className="button" onClick={onAccess}><Mail size={18} aria-hidden="true" /> NEWSLETTER-STATUS</button>}
          <button className="button" onClick={exportSave}>
            <Download size={18} aria-hidden="true" /> SPIELSTAND EXPORTIEREN
          </button>
        </div>
      </section>
      {!duringRide && <OfflineSettings />}
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
