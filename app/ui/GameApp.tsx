'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Flag,
  Gift,
  Settings as SettingsIcon,
  Trophy,
  Volume2,
  VolumeX,
  Wrench,
  Zap,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { Player, Product, RunReward, RunStats } from '../domain/types';
import { BIKES, DAILY_CHALLENGES } from '../domain/config';
import { refreshDaily } from '../domain/progression';
import { createServices, type Services } from '../services';
import { GameAudio } from '../game/audio';
import { Coin, Preview, XpBar, fmt } from './shared';
import Ride from './Ride';
import Garage from './Garage';
import {
  Challenges,
  Leaderboard,
  ProgressScreen,
  Rewards,
  SettingsScreen,
} from './Screens';
type Screen =
  | 'menu'
  | 'ride'
  | 'results'
  | 'garage'
  | 'challenges'
  | 'progress'
  | 'rewards'
  | 'leaderboard'
  | 'settings';
export default function GameApp() {
  const [services] = useState<Services>(() => createServices());
  const [audio] = useState(() => new GameAudio());
  const [player, setPlayer] = useState<Player | null>(null);
  const current = useRef<Player | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [screen, setScreen] = useState<Screen>('menu');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tutorial, setTutorial] = useState(false);
  const [result, setResult] = useState<{
    run: RunStats;
    reward: RunReward;
  } | null>(null);
  const [runKey, setRunKey] = useState(0);
  const activeRun = useRef(0);
  const pendingResult = useRef<{ run: RunStats; reward: RunReward } | null>(
    null,
  );
  useEffect(() => {
    let alive = true;
    void Promise.all([
      services.auth.getUser(),
      services.players.load(),
      services.products.list(),
    ])
      .then(([, p, catalog]) => {
        if (alive) {
          current.current = p;
          setPlayer(p);
          setProducts(catalog);
          services.analytics.track('game_started');
        }
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : 'Startup failed');
      });
    return () => {
      alive = false;
    };
  }, [services]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 3800);
    return () => clearTimeout(t);
  }, [notice]);
  const update = useCallback(
    (p: Player) => {
      current.current = p;
      setPlayer(p);
      services.players.save(p);
    },
    [services],
  );
  useEffect(() => {
    const onFocus = () => {
      if (current.current) {
        const refreshed = refreshDaily(current.current);
        if (refreshed !== current.current) update(refreshed);
      }
    };
    window.addEventListener('focus', onFocus);
    const interval = setInterval(onFocus, 60000);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [update]);
  useEffect(() => {
    audio.muted = player?.settings.muted ?? true;
  }, [audio, player?.settings.muted]);
  const navigate = (next: Screen) => {
    audio.unlock();
    audio.cue();
    setScreen(next);
    if (next === 'garage') services.analytics.track('garage_opened');
    if (next === 'rewards') services.analytics.track('reward_viewed');
    window.scrollTo(0, 0);
  };
  function start() {
    audio.unlock();
    if (!current.current) return;
    if (!current.current.settings.tutorialSeen) {
      setTutorial(true);
      return;
    }
    activeRun.current += 1;
    pendingResult.current = null;
    setResult(null);
    setRunKey(activeRun.current);
    setScreen('ride');
    services.analytics.track('run_started');
  }
  function finish(run: RunStats, generation: number) {
    if (
      !current.current ||
      generation !== activeRun.current ||
      pendingResult.current?.run.id === run.id
    )
      return;
    const outcome = services.rewards.settle(current.current, run);
    if (!outcome) return;
    update(outcome.player);
    pendingResult.current = { run, reward: outcome.reward };
    setResult(pendingResult.current);
    services.analytics.track('run_finished', {
      score: run.score,
      distance: run.distance,
    });
    if (outcome.reward.newRecord)
      services.analytics.track('highscore_set', { score: run.score });
    if (outcome.reward.level > outcome.reward.previousLevel)
      services.analytics.track('level_up', { level: outcome.reward.level });
    outcome.reward.challengeIds.forEach((id) =>
      services.analytics.track('challenge_completed', { id }),
    );
  }
  function revealResults(runId: string, generation: number) {
    if (
      generation !== activeRun.current ||
      pendingResult.current?.run.id !== runId
    )
      return;
    setScreen('results');
  }
  const mute = () => {
    if (current.current) {
      audio.unlock();
      update({
        ...current.current,
        settings: {
          ...current.current.settings,
          muted: !current.current.settings.muted,
        },
      });
    }
  };
  if (error)
    return (
      <main className="startup">
        <strong className="wordmark">PFUSCH.</strong>
        <h1>NOCH EIN VERSUCH.</h1>
        <p role="alert">{error}</p>
        <button
          className="button primary"
          onClick={() => window.location.reload()}
        >
          NEU LADEN
        </button>
      </main>
    );
  if (!player)
    return (
      <main className="startup">
        <strong className="wordmark">PFUSCH.</strong>
        <span className="spinner" />
        <p className="eyebrow">GARAGE WIRD GELADEN</p>
      </main>
    );
  if (screen === 'ride')
    return (
      <Ride
        key={runKey}
        player={player}
        products={products}
        audio={audio}
        onFinish={(run) => finish(run, runKey)}
        onResultsReady={(runId) => revealResults(runId, runKey)}
        onMute={mute}
      />
    );
  const equippedBike = BIKES.find((b) => b.id === player.bike)!;
  const back = () => navigate('menu');
  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" aria-label="PFUSCH Hauptmenü" onClick={back}>
          <img className="brand-logo" src="/branding/pfusch-logo.png" alt="Pfusch" />
          <span className="brand-sub">STREET RUN</span>
        </button>
        <span className="top-status">
          <i /> PFUSCH STREET RUN
        </span>
        <div className="top-right">
          <Coin value={player.coins} />
          <button className="level-chip" onClick={() => navigate('progress')}>
            LVL {String(player.level).padStart(2, '0')}
          </button>
          <button
            className="icon-button"
            aria-label={player.settings.muted ? 'Ton an' : 'Ton aus'}
            onClick={mute}
          >
            {player.settings.muted ? (
              <VolumeX size={19} />
            ) : (
              <Volume2 size={19} />
            )}
          </button>
          <button
            className="icon-button"
            aria-label="Einstellungen"
            onClick={() => navigate('settings')}
          >
            <SettingsIcon size={19} />
          </button>
        </div>
      </header>
      {services.players.warning && (
        <output className="save-warning">{services.players.warning}</output>
      )}
      {screen === 'menu' && (
        <main className="main-menu">
          <div className="menu-stage">
            <Preview player={player} products={products} mode="menu" />
          </div>
          <div className="menu-title">
            <p className="eyebrow">
              <span className="signal-dot" /> PFUSCH CLOTHING
            </p>
            <img className="hero-logo" src="/branding/pfusch-logo.png" alt="Pfusch" />
            
            <button className="button primary play-button" onClick={start}>
              <span>LOSFAHREN</span>
              <ArrowUpRight size={29} />
            </button>
            <button className="garage-link" onClick={() => navigate('garage')}>
              <Wrench size={18} /> GARAGE <ArrowRight size={17} />
            </button>
            <p className="input-caption">WISCHEN ODER TASTATUR</p>
          </div>
          <div className="bike-caption">
            <span className="eyebrow">DEIN SETUP</span>
            <strong>{equippedBike.name}</strong>
            <span>
              {equippedBike.name.toUpperCase()} /{' '}
              {player.paint === '#e7e7df' ? 'STANDARD' : 'CUSTOM'}
            </span>
          </div>
          <div className="menu-bottom">
            <div className="personal-best">
              <Trophy size={20} />
              <div>
                <span className="eyebrow">BESTLEISTUNG</span>
                <strong>{fmt(player.highScore).padStart(6, '0')}</strong>
              </div>
              <span className="best-divider" />
              <div>
                <span className="eyebrow">GESAMTDISTANZ</span>
                <strong>
                  {(player.totalDistance / 1000).toFixed(1)} <small>KM</small>
                </strong>
              </div>
            </div>
            <button
              className="daily-teaser"
              onClick={() => navigate('challenges')}
            >
              <Flag size={21} />
              <div>
                <span className="eyebrow">HEUTIGE CHALLENGES</span>
                <b>
                  {player.challenges.claimed.length} / {DAILY_CHALLENGES.length}{' '}
                  ERLEDIGT
                </b>
              </div>
              <ArrowUpRight />
            </button>
          </div>
        </main>
      )}
      {screen === 'garage' && (
        <Garage
          player={player}
          products={products}
          update={update}
          services={services}
          notify={setNotice}
          back={back}
          start={start}
        />
      )}
      {screen === 'results' && result && (
        <main className="results-page">
          <div className="results-art">
            <Preview player={player} products={products} mode="garage" />
            <span className="eyebrow">NOCH EINE RUNDE.</span>
          </div>
          <section className="result-card">
            <p className="eyebrow">
              {result.reward.newRecord
                ? 'A NEW BESTLEISTUNG'
                : 'RIDE ERLEDIGT'}{' '}
              <Flag size={15} />
            </p>
            <h1>{result.reward.newRecord ? 'NEUE BESTLEISTUNG.' : 'NOCH EINE?'}</h1>
            <div className="result-score">
              {fmt(result.run.score)}
              <span>PUNKTE</span>
            </div>
            <p className="muted">
              {result.run.cause} · {result.run.seconds} Sekunden unterwegs
            </p>
            <div className="result-stats">
              <div>
                <b>{fmt(result.run.distance)} m</b>
                <span>DISTANZ</span>
              </div>
              <div>
                <b>×{result.run.bestCombo.toFixed(1)}</b>
                <span>BESTE KOMBO</span>
              </div>
              <div>
                <b>{result.run.nearMisses}</b>
                <span>KNAPPE MANÖVER</span>
              </div>
              <div>
                <b>{result.run.maxSpeed}</b>
                <span>TOP KM/H</span>
              </div>
            </div>
            <div className="earned">
              <span>
                <Zap size={19} /> +{result.reward.xp} XP
              </span>
              <span>
                <Coin value={result.reward.coins} /> ERHALTEN
              </span>
            </div>
            {result.reward.level > result.reward.previousLevel && (
              <p className="level-up">LEVEL AUF → {result.reward.level}</p>
            )}
            <XpBar player={player} />
            {result.reward.challengeIds.length > 0 && (
              <div className="completed-challenges">
                {result.reward.challengeIds.map((id) => (
                  <p key={id}>
                    ✓ {DAILY_CHALLENGES.find((c) => c.id === id)?.title} —
                    complete
                  </p>
                ))}
                <small>Challenge-Belohnungen sind oben enthalten.</small>
              </div>
            )}
            <p className="result-best">BESTLEISTUNG {fmt(player.highScore)}</p>
            <button className="button primary" onClick={start}>
              NOCHMAL FAHREN <ArrowRight />
            </button>
            <button className="button" onClick={() => navigate('garage')}>
              ZUR GARAGE <Wrench size={18} />
            </button>
          </section>
        </main>
      )}
      {screen === 'challenges' && (
        <Challenges player={player} back={back} start={start} />
      )}
      {screen === 'progress' && <ProgressScreen player={player} back={back} />}
      {screen === 'rewards' && (
        <Rewards
          player={player}
          services={services}
          update={update}
          notify={setNotice}
          back={back}
        />
      )}
      {screen === 'leaderboard' && (
        <Leaderboard player={player} services={services} back={back} />
      )}
      {screen === 'settings' && (
        <SettingsScreen
          player={player}
          services={services}
          update={update}
          back={back}
        />
      )}
      <nav className="bottom-nav" aria-label="Spielnavigation">
        <button className={screen === 'menu' ? 'active' : ''} onClick={back}>
          <Zap size={18} />
          <span>FAHREN</span>
        </button>
        <button
          className={screen === 'garage' ? 'active' : ''}
          onClick={() => navigate('garage')}
        >
          <Wrench size={18} />
          <span>GARAGE</span>
        </button>
        <button
          className={screen === 'challenges' ? 'active' : ''}
          onClick={() => navigate('challenges')}
        >
          <Flag size={18} />
          <span>AUFGABEN</span>
        </button>
        <button
          className={screen === 'rewards' ? 'active' : ''}
          onClick={() => navigate('rewards')}
        >
          <Gift size={18} />
          <span>BELOHNUNGEN</span>
        </button>
        <button
          className={screen === 'leaderboard' ? 'active' : ''}
          onClick={() => navigate('leaderboard')}
        >
          <Trophy size={18} />
          <span>RANGLISTE</span>
        </button>
      </nav>
      <Dialog open={tutorial} onOpenChange={setTutorial}>
        <DialogContent className="game-dialog">
          <p className="eyebrow">DEINE ERSTE RUNDE</p>
          <DialogTitle>FINDE DEINE LINIE.</DialogTitle>
          <DialogDescription>
            Gas läuft automatisch. Du steuerst den Rest.
          </DialogDescription>
          <div className="control-guide">
            <span>
              SWIPE ← → <b>Verkehr ausweichen</b>
            </span>
            <span>
              SLIDE UP <b>Gewicht vor / korrigieren</b>
            </span>
            <span>
              SLIDE DOWN <b>Gas / Gewicht zurück</b>
            </span>
          </div>
          <p className="muted">
            Auf Touch: nach unten ziehen zum Anheben, nach oben zum Korrigieren und seitlich zum Ausweichen. Loslassen = neutral. Zwei Finger pausieren. Tastatur: A/D oder Pfeile zum Ausweichen, S/↓ zum Anheben, W/↑ zum Korrigieren. Wheelies und Stunts geben die meisten Punkte. Sammle P F U S C H für einen Set-Bonus.
          </p>
          <button
            className="button primary"
            onClick={() => {
              update({
                ...player,
                settings: { ...player.settings, tutorialSeen: true },
              });
              setTutorial(false);
              start();
            }}
          >
            VERSTANDEN. LOSFAHREN <ArrowRight />
          </button>
        </DialogContent>
      </Dialog>
      {notice && <output className="toast">{notice}</output>}
    </div>
  );
}
