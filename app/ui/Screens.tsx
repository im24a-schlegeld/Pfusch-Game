import { useEffect, useState } from 'react';
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
import {
  DAILY_CHALLENGES,
  LEVELS,
  LEVEL_NAMES,
  REWARDS,
} from '../domain/config';
import { Coin, ScreenHeading, XpBar, fmt } from './shared';
import { normalizeLeaderboardName, refreshDaily } from '../domain/progression';
interface Base {
  player: Player;
  back: () => void;
}
export function Challenges({
  player,
  back,
  start,
}: Base & { start: () => void }) {
  const daily = refreshDaily(player).challenges;
  const completed = DAILY_CHALLENGES.filter((challenge) => daily.claimed.includes(challenge.id)).length;
  const remaining = DAILY_CHALLENGES.filter((challenge) => !daily.claimed.includes(challenge.id));
  return (
    <main className="standard-page">
      <ScreenHeading
        kicker="EIN GRUND FÜR NOCH EINE."
        title="TÄGLICHE AUFGABEN."
        back={back}
      />
      <div className="page-intro">
        <div className="page-feature"><Target aria-hidden="true" /><p>
          Kurze Aufgaben. Direkte Belohnungen. Fortschritt zählt über alle Fahrten.
        </p></div>
        <span className="tag">NEU AB 00:00 UTC</span>
      </div>
      <div className="progress-overview" aria-label="Tagesübersicht">
        <div><CircleCheck aria-hidden="true" /><b>{completed} / {DAILY_CHALLENGES.length}</b><span>ERLEDIGT</span></div>
        <div><Coins aria-hidden="true" /><b>+{remaining.reduce((sum, entry) => sum + entry.coins, 0)}</b><span>COINS OFFEN</span></div>
        <div><Sparkles aria-hidden="true" /><b>+{remaining.reduce((sum, entry) => sum + entry.xp, 0)}</b><span>XP OFFEN</span></div>
      </div>
      <div className="challenge-grid">
        {DAILY_CHALLENGES.map((c, i) => {
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
                <span>0{i + 1} / TÄGLICH</span>
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
              <p className="mission-remaining">{complete ? 'Geschafft — Belohnung gutgeschrieben.' : `Noch ${fmt(c.target - value)} ${unit}.`}</p>
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
  const rewards = REWARDS.filter((reward) => reward.kind !== 'future');
  const ready = rewards.filter((reward) => reward.level <= player.level && !player.redeemedRewards.includes(reward.id));
  return (
    <main className="standard-page">
      <ScreenHeading
        kicker="IM SPIEL VERDIENT."
        title="BELOHNUNGEN."
        back={back}
      />
      <div className="page-intro">
        <div className="page-feature"><Gift aria-hidden="true" /><p>Coins und neue Looks. Erspiele die Level und hol dir deine Extras.</p></div>
        <span className="tag">{ready.length} BEREIT ZUM ABHOLEN</span>
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
                <span className="reward-unlock"><Medal size={15} aria-hidden="true" />{claimed ? 'In deiner Garage' : available ? 'Level erreicht · einmalig abholen' : `Level ${r.level} · noch ${fmt(neededXp)} XP`}</span>
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
        Alle Belohnungen sind digitale Spielgegenstände. Neue Looks kannst du in der Garage ansehen und ausrüsten.
      </p>
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
  const [draftName, setDraftName] = useState(player.leaderboardName);
  useEffect(() => setDraftName(player.leaderboardName), [player.leaderboardName]);
  useEffect(() => {
    let current = true;
    setResult({ snapshot: null, loading: true, error: false });
    const fetch = services.leaderboard.fetch;
    if (!fetch) {
      setResult({ snapshot: { entries: services.leaderboard.list(player, period), source: 'local', message: 'Deine gespeicherten Fahrten auf diesem Gerät.' }, loading: false, error: false });
      return;
    }
    void fetch.call(services.leaderboard, player, period).then((snapshot) => {
      if (current) setResult({ snapshot, loading: false, error: false });
    }).catch(() => {
      if (current) setResult({ snapshot: null, loading: false, error: true });
    });
    return () => { current = false; };
  }, [services.leaderboard, player, period, revision]);
  const entries = result.snapshot?.entries ?? [];
  const online = result.snapshot?.source === 'shopify';
  const normalizedName = normalizeLeaderboardName(draftName);
  const invalidName = Boolean(draftName.trim()) && !normalizedName;
  return (
    <main className="standard-page narrow">
      <ScreenHeading
        kicker="DEINE FAHRTEN. DEINE PUNKTE."
        title="RANGLISTE."
        back={back}
      />
      <div className="page-intro">
        <div className="page-feature"><Trophy aria-hidden="true" /><p>{online ? 'Die besten gespeicherten Fahrten der Community.' : 'Deine echten Bestleistungen im gewählten Zeitraum.'}</p></div>
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
        <p>Gib dir einen Namen für deine Bestwerte. Leer bleibt die neutrale Anzeige „DU“.</p>
        <label htmlFor="leaderboard-name">Anzeigename</label>
        <input
          id="leaderboard-name"
          type="text"
          value={draftName}
          maxLength={24}
          autoComplete="nickname"
          placeholder="z. B. Dario"
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
      {!result.loading && !result.error && entries.length === 0 && <div className="ranking-state"><Trophy size={32} aria-hidden="true" /><h2>DEINE ERSTE MARKE FEHLT NOCH.</h2><p>Beende eine Fahrt, um hier deinen Punktestand zu sehen.</p><button className="button small" onClick={back}>ZUR GARAGE <ArrowRight size={16} aria-hidden="true" /></button></div>}
      {entries.length > 0 && <>
      <div className="ranking-list">
        <div className="ranking-head">
          <span>{online ? 'RANG / FAHRER' : 'FAHRER / BESTLEISTUNG'}</span>
          <span>PUNKTE</span>
        </div>
        {entries.map((e, i) => (
          <div key={e.name} className={e.you ? 'you' : ''}>
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
}: Base & { services: Services; update: (p: Player) => void; onTutorial?: () => void; onAccess?: () => void }) {
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
        {services.auth.login && <button className="button mb-3" onClick={services.auth.login}>MIT PFUSCH-KONTO ANMELDEN</button>}
        <button className="button" onClick={exportSave}>
          <Download size={18} /> SPIELSTAND EXPORTIEREN
        </button>
      </section>
      <section className="settings-section">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2>STEUERUNG</h2>
          {onTutorial && <button className="button small" onClick={onTutorial}>
            <Repeat2 size={18} aria-hidden="true" /> SPIELHINWEISE ERNEUT STARTEN
          </button>}
        </div>
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
