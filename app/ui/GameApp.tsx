'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Flag,
  Gift,
  Settings as SettingsIcon,
  Trophy,
  Volume2,
  VolumeX,
  Wrench,
} from 'lucide-react';
import type { Player, Product, RunReward, RunStats } from '../domain/types';
import { refreshDaily } from '../domain/progression';
import { createServices, type Services } from '../services';
import { unavailableAccess } from '../services/playerAccess';
import { shopifyParentOrigin } from '../services/shopifyBridge';
import { rideViewportParentOrigin, syncShopifyRideViewport } from '../services/shopifyViewport';
import { GameAudio } from '../game/audio';
import { Coin } from './shared';
import Ride from './Ride';
import Garage from './Garage';
import {
  Challenges,
  Leaderboard,
  ProgressScreen,
  Rewards,
  SettingsScreen,
} from './Screens';
import RideResult from './RideResult';
import LoadingScreen from './LoadingScreen';
import FirstRideTutorial from './FirstRideTutorial';
import SaveAccessGate from './SaveAccessGate';
type Screen =
  | 'ride'
  | 'results'
  | 'garage'
  | 'challenges'
  | 'progress'
  | 'rewards'
  | 'leaderboard'
  | 'settings';
export default function GameApp() {
  const embedded = window.parent !== window;
  const parentOrigin = shopifyParentOrigin(embedded, document.referrer);
  const oxygenRuntime = !!document.getElementById('pfusch-runtime-config');
  const vercelPreview = !embedded && !oxygenRuntime && window.location.hostname.endsWith('.vercel.app');
  const development = (import.meta as ImportMeta & { env: { DEV: boolean } }).env.DEV;
  const viewportOrigin = rideViewportParentOrigin(embedded, document.referrer, development ? window.location.origin : undefined);
  const [services] = useState<Services>(() => createServices());
  const [audio] = useState(() => new GameAudio());
  const subscribeSave = useCallback((listener: () => void) => services.players.subscribeSync?.(listener) ?? (() => {}), [services]);
  const getAccessStatus = useCallback(() => services.players.getAccess?.(), [services]);
  const accessStatus = useSyncExternalStore(subscribeSave, getAccessStatus, getAccessStatus);
  const [player, setPlayer] = useState<Player | null>(null);
  const current = useRef<Player | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [screen, setScreen] = useState<Screen>('garage');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tutorial, setTutorial] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(false);
  const [startingRide, setStartingRide] = useState(false);
  const [garageLoading, setGarageLoading] = useState(true);
  const garageSettled = useCallback(() => setGarageLoading(false), []);
  const [accessError, setAccessError] = useState('');
  const accessRequest = useRef(0);
  const accessPending = useRef(false);
  const [result, setResult] = useState<{
    run: RunStats;
    reward: RunReward;
  } | null>(null);
  const [runKey, setRunKey] = useState(0);
  const activeRun = useRef(0);
  const pendingResult = useRef<{ run: RunStats; reward: RunReward } | null>(
    null,
  );
  const rideViewport = !error && !!player && (screen === 'ride' || screen === 'results');
  useEffect(() => syncShopifyRideViewport(window, viewportOrigin, rideViewport), [viewportOrigin, rideViewport]);
  useEffect(() => {
    let alive = true;
    void Promise.all([services.auth.getUser(), services.players.load()])
      .then(([, p]) => {
        if (alive) {
          current.current = p;
          setPlayer(p);
          services.analytics.track('game_started');
        }
        // The first screen does not need the full product catalog. Load it
        // after the player is visible so the ride/menu can become interactive
        // without waiting on preview assets and catalog parsing.
        return services.products.list();
      })
      .then((catalog) => {
        if (alive) setProducts(catalog);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : 'Start fehlgeschlagen');
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
    const recheck = () => {
      if (current.current && document.visibilityState === 'visible')
        void services.players.refreshAccess?.().catch(() => {});
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [services]);
  useEffect(() => {
    audio.muted = player?.settings.muted ?? true;
  }, [audio, player?.settings.muted]);
  const navigate = (next: Screen) => {
    accessRequest.current += 1;
    accessPending.current = false;
    setCheckingAccess(false);
    setStartingRide(false);
    setGarageLoading(next === 'garage' && screen !== 'garage');
    setAccessOpen(false);
    audio.unlock();
    audio.cue();
    setScreen(next);
    if (next === 'garage') services.analytics.track('garage_opened');
    if (next === 'rewards') services.analytics.track('reward_viewed');
    window.scrollTo(0, 0);
  };
  async function checkAccess(startRide: boolean) {
    audio.unlock();
    if (!current.current || accessPending.current) return;
    const request = ++accessRequest.current;
    let enteredRide = false;
    accessPending.current = true;
    setCheckingAccess(true);
    setStartingRide(startRide);
    setAccessError('');
    try {
      if (vercelPreview) {
        if (!startRide) return;
        setAccessOpen(false);
        if (!current.current.settings.tutorialSeen) {
          setTutorial(true);
          return;
        }
        activeRun.current += 1;
        pendingResult.current = null;
        setResult(null);
        setRunKey(activeRun.current);
        setScreen('ride');
        enteredRide = true;
        services.analytics.track('run_started');
        return;
      }
      const access = await services.players.refreshAccess?.()
        ?? services.players.getAccess?.() ?? unavailableAccess(current.current.runsPlayed);
      if (request !== accessRequest.current) return;
      if (!access.allowed) {
        setTutorial(false);
        setAccessOpen(true);
        return;
      }
      if (!startRide) return;
      setAccessOpen(false);
      if (!current.current.settings.tutorialSeen) {
        setTutorial(true);
        return;
      }
      activeRun.current += 1;
      pendingResult.current = null;
      setResult(null);
      setRunKey(activeRun.current);
      setScreen('ride');
      enteredRide = true;
      services.analytics.track('run_started');
    } catch {
      if (request !== accessRequest.current) return;
      setAccessError('Dein Zugang konnte nicht geprüft werden. Bitte prüfe die Verbindung und versuche es erneut.');
      setAccessOpen(true);
    } finally {
      if (request === accessRequest.current) {
        accessPending.current = false;
        setCheckingAccess(false);
        // Keep the transition screen mounted until the first ride frame is
        // ready. Clearing it here used to batch with setScreen('ride'), so the
        // loading artwork was often skipped even though Three.js was loading.
        if (!enteredRide) setStartingRide(false);
      }
    }
  }
  const start = () => { void checkAccess(true); };
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
  if (!player) return <LoadingScreen label="GARAGE WIRD GELADEN" fullScreen />;
  if (screen === 'ride')
    return (
      <>
        <Ride
          key={runKey}
          player={player}
          products={products}
          audio={audio}
          onFinish={(run) => finish(run, runKey)}
          onResultsReady={(runId) => revealResults(runId, runKey)}
          onExit={() => navigate('garage')}
          onMute={mute}
          onReady={() => setStartingRide(false)}
          onLoadError={() => setStartingRide(false)}
        />
        {startingRide && (
          <LoadingScreen label="FAHRT WIRD VORBEREITET" fullScreen />
        )}
      </>
    );
  const back = () => navigate('garage');
  const access = accessError ? unavailableAccess(player.runsPlayed) : accessStatus ?? unavailableAccess(player.runsPlayed);
  const newsletterOrigin = parentOrigin;
  const loadingLabel = startingRide ? 'FAHRT WIRD VORBEREITET'
    : screen === 'garage' && garageLoading ? 'GARAGE WIRD GELADEN' : null;
  return (
    <>
    <div className={`app-shell${embedded ? ' app-shell-embedded' : ''}`} data-screen={screen} inert={loadingLabel ? true : undefined}>
      {!embedded && screen !== 'results' && <header className="topbar">
        <button className="brand" aria-label="Wheelie Escape Garage" onClick={back}>
          <img className="brand-logo" src="/branding/pfusch-logo.webp" alt="Pfusch" />
          <span className="brand-sub">WHEELIE ESCAPE</span>
        </button>
        <span className="top-status">
          <i /> WHEELIE ESCAPE
        </span>
        <div className="top-right">
          <Coin value={player.coins} />
          <button className="level-chip" onClick={() => navigate('progress')}>
            ST. {String(player.level).padStart(2, '0')}
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
      </header>}
      {screen === 'garage' && (
        <Garage
          player={player}
          products={products}
          update={update}
          services={services}
          notify={setNotice}
          back={back}
          start={start}
          embedded={embedded}
          onProgress={() => navigate('progress')}
          onReady={garageSettled}
          onLoadError={garageSettled}
        />
      )}
      {screen === 'results' && result && (
        <RideResult player={player} run={result.run} reward={result.reward}
          start={start} startLocked={!access.allowed} garage={() => navigate('garage')} />
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
        <Leaderboard player={player} services={services} update={update} back={back} />
      )}
      <SaveAccessGate open={accessOpen && !vercelPreview} access={access} checking={checkingAccess}
        onLogin={services.auth.login}
        message={accessError || saveStatus?.message} onCheck={() => { void checkAccess(false); }} onStart={start} back={() => setAccessOpen(false)}
        onNewsletter={newsletterOrigin ? () => {
          setAccessOpen(false);
          window.parent.postMessage({ type: 'pfusch:open-newsletter', version: 1 }, newsletterOrigin);
        } : undefined} />
      {screen === 'settings' && (
        <SettingsScreen
          player={player}
          services={services}
          update={update}
          back={back}
          onTutorial={() => setTutorial(true)}
          onAccess={() => setAccessOpen(true)}
        />
      )}
      {screen !== 'results' && <nav className="bottom-nav" aria-label="Spielnavigation">
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
          <span>RANG</span>
        </button>
        {embedded && <button
          className={screen === 'settings' ? 'active' : ''}
          aria-label="Einstellungen"
          onClick={() => navigate('settings')}
        >
          <SettingsIcon size={18} />
          <span>OPTIONEN</span>
        </button>}
      </nav>}
      <FirstRideTutorial open={tutorial} onOpenChange={setTutorial}
        reducedMotion={player.settings.reducedMotion}
        onStart={() => {
          update({ ...player, settings: { ...player.settings, tutorialSeen: true } });
          setTutorial(false);
          start();
        }} />
      {notice && <output className="toast">{notice}</output>}
    </div>
    {loadingLabel && <LoadingScreen label={loadingLabel} fullScreen />}
    </>
  );
}
