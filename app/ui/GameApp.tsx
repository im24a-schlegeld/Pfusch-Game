'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Flag,
  Gift,
  Settings as SettingsIcon,
  Trophy,
  UserRound,
  Volume2,
  VolumeX,
  Wrench,
} from 'lucide-react';
import type { Player, Product, RunReward, RunStats } from '../domain/types';
import { refreshDaily } from '../domain/progression';
import { recordDailySign } from '../domain/dailySigns';
import type { SignId } from '../game/signCollectibles';
import { markTutorialsSeen } from '../domain/tutorial';
import { createServices, type Services } from '../services';
import { unavailableAccess } from '../services/playerAccess';
import { shopifyParentOrigin, SHOPIFY_OXYGEN_ORIGIN, SHOPIFY_STOREFRONT_ORIGIN } from '../services/shopifyBridge';
import { startOxygenLogin } from '../services/oxygenRuntime';
import { rideViewportParentOrigin, syncShopifyRideViewport } from '../services/shopifyViewport';
import { GameAudio } from '../game/audio';
import type { VerifiedRunChallenge, VerifiedRunSubmission } from '../game/verifiedRun';
import { rewardRunNotice, type RealRewardStatus, type VerifiedRewardsError } from '../services/verifiedRewards';
import { Coin } from './shared';
import { spendGuardianBell } from '../domain/guardianBells';
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
import GameBrand from './GameBrand';
import SaveAccessGate from './SaveAccessGate';
import OfflineInstallHint from './OfflineInstallHint';
import { getOfflineAppState, subscribeOfflineApp } from '../services/offlineApp';
import './account-header.css';
import { readGameShare } from '../domain/gameShare';
import { SharedGame } from './GameShare';
import GiftNotification from './GiftNotification';
type Screen =
  | 'ride'
  | 'results'
  | 'garage'
  | 'challenges'
  | 'progress'
  | 'rewards'
  | 'leaderboard'
  | 'invitation'
  | 'settings';
function shopRunConfirmation(status: RealRewardStatus) {
  const progress = status.campaign
    ? `${status.campaign.progress.toLocaleString('de-CH')} / ${status.campaign.target.toLocaleString('de-CH')}`
    : status.verifiedPoints.toLocaleString('de-CH');
  const credited = (status as RealRewardStatus & { creditedPoints?: number }).creditedPoints;
  return typeof credited === 'number'
    ? credited > 0 ? `Shop-Server bestätigt: +${credited.toLocaleString('de-CH')} Punkte. Aufgabenfortschritt: ${progress}.`
      : `Shop-Server bestätigt, aber 0 Punkte gutgeschrieben. Prüfe 20 s Mindestdauer, 100 Punkte und Tageslimit. Fortschritt: ${progress}.`
    : `Shop-Server antwortete. Aufgabenfortschritt: ${progress}.`;
}
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
  const [accountKind, setAccountKind] = useState<'guest' | 'customer'>('guest');
  const offlineApp = useSyncExternalStore(subscribeOfflineApp, getOfflineAppState, getOfflineAppState);
  // Session-only dismissal survives menu/ride navigation and account refreshes.
  const [installHintDismissed, setInstallHintDismissed] = useState(false);
  const [loginHint, setLoginHint] = useState(false);
  const loginPending = useRef(false);
  const current = useRef<Player | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [sharedGame] = useState(() => readGameShare(window.location.search));
  const [screen, setScreen] = useState<Screen>(sharedGame ? 'invitation' : 'garage');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [accessOpen, setAccessOpen] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(false);
  const [startingRide, setStartingRide] = useState(false);
  const [accessError, setAccessError] = useState('');
  const accessRequest = useRef(0);
  const accessPending = useRef(false);
  const [result, setResult] = useState<{
    run: RunStats;
    reward: RunReward;
  } | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [verifiedChallenge, setVerifiedChallenge] = useState<VerifiedRunChallenge | null>(null);
  const [shopRewardMessage, setShopRewardMessage] = useState('');
  const [shopRewardTransient, setShopRewardTransient] = useState(false);
  const runPreparationIssue = useRef<VerifiedRewardsError | null>(null);
  const pendingShopRun = useRef<{ owner: string; generation: number } | null>(null);
  const showShopReward = useCallback((message: string, transient = false) => {
    setShopRewardMessage(message); setShopRewardTransient(transient);
  }, []);
  const activeRun = useRef(0);
  const activeRunOwner = useRef<string | null>(null);
  const pendingResult = useRef<{ run: RunStats; reward: RunReward } | null>(
    null,
  );
  const rideViewport = !error && !!player && (screen === 'ride' || screen === 'results');
  useEffect(() => {
    if (accountKind === 'customer' && player?.bike && (screen === 'garage' || screen === 'results'))
      void services.rewards.real?.prepare(player.bike);
  }, [accountKind, player?.bike, screen, services]);
  useEffect(() => syncShopifyRideViewport(window, viewportOrigin, rideViewport), [viewportOrigin, rideViewport]);
  useEffect(() => {
    let alive = true;
    void Promise.all([services.auth.getUser(), services.players.load()])
      .then(([user, p]) => {
        if (alive) {
          setAccountKind(user.kind);
          setLoginHint(user.kind === 'guest');
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
    if (!loginHint) return;
    const timer = window.setTimeout(() => setLoginHint(false), 2600);
    return () => window.clearTimeout(timer);
  }, [loginHint]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 3800);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (!shopRewardMessage || !shopRewardTransient) return;
    const timer = window.setTimeout(() => setShopRewardMessage(''), 3800);
    return () => window.clearTimeout(timer);
  }, [shopRewardMessage, shopRewardTransient]);
  useEffect(() => {
    let active = true;
    const retry = () => {
      const pending = pendingShopRun.current, service = services.rewards.real;
      if (!pending || !service?.retryPending || current.current?.id !== pending.owner) return;
      void service.retryPending().then(status => {
        if (!active || !status || pending !== pendingShopRun.current || current.current?.id !== pending.owner || activeRun.current !== pending.generation) return;
        pendingShopRun.current = null;
        showShopReward(shopRunConfirmation(status));
      }).catch((reason: unknown) => {
        if (!active || pending !== pendingShopRun.current || current.current?.id !== pending.owner || activeRun.current !== pending.generation) return;
        const note = rewardRunNotice(reason, 'finish');
        showShopReward(note.message, note.transient);
      });
    };
    window.addEventListener('online', retry);
    return () => { active = false; window.removeEventListener('online', retry); };
  }, [services, showShopReward]);
  const update = useCallback(
    (p: Player) => {
      // A late edit/result from the previous identity must not replace the
      // independent guest or account inventory after a session transition.
      if (current.current && current.current.id !== p.id) return;
      current.current = p;
      setPlayer(p);
      services.players.save(p);
    },
    [services],
  );
  const syncAccount = useCallback(async () => {
    const [latest, user] = await Promise.all([services.players.load(), services.auth.getUser()]);
    if (latest !== current.current) {
      if (current.current && latest.id !== current.current.id) {
        services.rewards.real?.resetSession?.();
        pendingShopRun.current = null;
        showShopReward('');
      }
      current.current = latest;
      setPlayer(latest);
    }
    setAccountKind(user.kind);
    return latest;
  }, [services, showShopReward]);
  useEffect(() => {
    let alive = true;
    let refresh = 0;
    // Reward/player responses can reject a session while this tab stays open.
    // Swap the displayed inventory too; account recovery stays in its own store.
    const unsubscribe = services.players.subscribeSync?.(() => {
      const observed = current.current, request = ++refresh;
      void Promise.all([services.auth.getUser(), services.players.load()]).then(([user, latest]) => {
        if (!alive || request !== refresh || latest.id !== (user.kind === 'customer' ? `shopify:${user.id}` : 'guest-local')) return;
        setAccountKind(user.kind);
        if (current.current && (current.current === observed || current.current.id !== latest.id)) {
          if (current.current.id !== latest.id) {
            services.rewards.real?.resetSession?.();
            pendingShopRun.current = null;
            showShopReward('');
          }
          current.current = latest;
          setPlayer(latest);
        }
      }).catch(() => {});
    });
    return () => { alive = false; unsubscribe?.(); };
  }, [services, showShopReward]);
  const beginLogin = useCallback(async () => {
    if ((!services.auth.login && !oxygenRuntime) || loginPending.current) return;
    loginPending.current = true;
    try {
      // Start OAuth while the click is still active. A slow or unavailable
      // player API must never make the login button appear inert. Oxygen can
      // navigate directly even when its runtime API has not loaded yet.
      if (oxygenRuntime) startOxygenLogin(window, parentOrigin, document.referrer);
      else services.auth.login?.();
      // Finish queued progress on a best-effort basis after starting login.
      const pendingFlush = services.players.flush?.();
      if (pendingFlush) void pendingFlush.catch(() => {});
    } catch {
      setNotice('Anmeldung konnte nicht geöffnet werden. Bitte erneut versuchen.');
    } finally {
      loginPending.current = false;
    }
  }, [oxygenRuntime, parentOrigin, services]);
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
        void services.players.refreshAccess?.().then(() => syncAccount()).catch(() => {});
    };
    window.addEventListener('focus', recheck);
    window.addEventListener('pageshow', recheck);
    window.addEventListener('online', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      window.removeEventListener('pageshow', recheck);
      window.removeEventListener('online', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [services, syncAccount]);
  useEffect(() => {
    // Flush debounced cloud writes before a tab is backgrounded or discarded.
    // The local adapter remains synchronous, while the Shopify adapter keeps
    // the accepted snapshot as its recovery backup when the request fails.
    const flush = () => {
      const pendingFlush = services.players.flush?.();
      if (pendingFlush) void pendingFlush.catch(() => {});
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
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
        activeRun.current += 1;
        activeRunOwner.current = current.current.id;
        pendingResult.current = null;
        setResult(null);
        setVerifiedChallenge(null);
        setRunKey(activeRun.current);
        setScreen('ride');
        enteredRide = true;
        services.analytics.track('run_started');
        return;
      }
      const access = await services.players.refreshAccess?.()
        ?? services.players.getAccess?.() ?? unavailableAccess(current.current.runsPlayed);
      await syncAccount();
      if (request !== accessRequest.current) return;
      if (!access.allowed) {
        setAccessOpen(true);
        return;
      }
      if (!startRide) return;
      setAccessOpen(false);
      activeRun.current += 1;
      activeRunOwner.current = current.current.id;
      pendingResult.current = null;
      setResult(null);
      // Wait for the signed server challenge before fixing the ride seed.
      // A background preparation request may still be in flight when the user
      // taps Start; consuming it early silently loses real-shop reward credit.
      const rewardService = services.rewards.real;
      const owner = current.current.id, bikeId = current.current.bike;
      const shopCustomer = current.current.id.startsWith('shopify:');
      if (shopCustomer && rewardService) {
        await rewardService.prepare(bikeId);
        if (request !== accessRequest.current || current.current?.id !== owner || current.current.bike !== bikeId) return;
      }
      const challenge = shopCustomer && rewardService
        ? rewardService.takeChallenge(bikeId) : null;
      runPreparationIssue.current = rewardService?.preparationIssue ?? null;
      setVerifiedChallenge(challenge);
      const note = rewardRunNotice(runPreparationIssue.current, 'start');
      showShopReward(shopCustomer
        ? challenge ? 'Shop-Fahrt wird verifiziert. Die Gutschrift erfolgt nach Fahrtende.' : note.message
        : 'Gastfahrt: Punkte zählen lokal, nicht für den Shopify-Rabatt.', !challenge && note.transient);
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
  function finish(run: RunStats, generation: number, verified?: VerifiedRunSubmission) {
    if (
      !current.current ||
      current.current.id !== activeRunOwner.current ||
      generation !== activeRun.current ||
      pendingResult.current?.run.id === run.id
    )
      return;
    const outcome = services.rewards.settle(current.current, run);
    if (!outcome) return;
    update(outcome.player);
    pendingResult.current = { run, reward: outcome.reward };
    setResult(pendingResult.current);
    if (verified && services.rewards.real) {
      const rewardService = services.rewards.real;
      const owner = current.current.id;
      showShopReward('Shop-Gutschrift wird vom Server geprüft …');
      pendingShopRun.current = { owner, generation };
      void rewardService.finish(verified).then(status => {
        if (generation !== activeRun.current || current.current?.id !== owner) return;
        pendingShopRun.current = null;
        showShopReward(shopRunConfirmation(status));
      }).catch((reason: unknown) => {
        if (generation !== activeRun.current || current.current?.id !== owner) return;
        const note = rewardRunNotice(reason, 'finish');
        showShopReward(note.message, note.transient);
      });
    } else if (current.current.id.startsWith('shopify:')) {
      const note = rewardRunNotice(runPreparationIssue.current, 'start');
      showShopReward(note.message, note.transient);
    }
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
  function collectSign(eventId: string, signId: SignId) {
    if (!current.current || current.current.id !== activeRunOwner.current) return;
    const next = recordDailySign(current.current, eventId, signId);
    if (next === current.current) return;
    const completed = !current.current.challenges.claimed.includes('daily-signs')
      && next.challenges.claimed.includes('daily-signs');
    update(next);
    if (completed) {
      setNotice('PFUSCH gesammelt · +120 Coins');
      services.analytics.track('challenge_completed', { id: 'daily-signs' });
    }
  }
  function revealResults(runId: string, generation: number) {
    if (
      current.current?.id !== activeRunOwner.current ||
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
          onFinish={(run, verified) => finish(run, runKey, verified)}
          onSignPickup={(eventId, signId) => { if (runKey === activeRun.current) collectSign(eventId, signId); }}
          invites={services.invites}
          onUseGuardianBell={runId => {
            const latest = current.current;
            if (!latest || latest.id !== activeRunOwner.current || activeRun.current !== runKey) return false;
            const next = spendGuardianBell(latest, runId);
            if (!next) return false;
            update(next);
            return true;
          }}
          verifiedChallenge={verifiedChallenge}
          onResultsReady={(runId) => revealResults(runId, runKey)}
          onExit={() => navigate('garage')}
          onMute={mute}
          renderSettings={back => <SettingsScreen player={player} services={services} update={update}
            back={back} backLabel="Zurück zur Pause" duringRide />}
          onReady={() => setStartingRide(false)}
          onLoadError={() => setStartingRide(false)}
          onTutorialSeen={(ids) => {
            const latest = current.current;
            if (!latest) return;
            update(markTutorialsSeen(latest, ids));
          }}
        />
        {startingRide && (
          <LoadingScreen label="FAHRT WIRD VORBEREITET" fullScreen reducedMotion={player.settings.reducedMotion} />
        )}
        {player.id.startsWith('shopify:') && !verifiedChallenge && shopRewardMessage &&
          <output className="toast">{shopRewardMessage}</output>}
      </>
    );
  const back = () => navigate('garage');
  const goToShop = () => window.location.assign(`${SHOPIFY_STOREFRONT_ORIGIN}/`);
  const access = accessError ? unavailableAccess(player.runsPlayed) : accessStatus ?? unavailableAccess(player.runsPlayed);
  const newsletterOrigin = parentOrigin;
  const oxygenLoginHref = (() => {
    const login = new URL('/auth/login', SHOPIFY_OXYGEN_ORIGIN);
    let returnTo = `${SHOPIFY_OXYGEN_ORIGIN}/`;
    if (window.location.origin === SHOPIFY_OXYGEN_ORIGIN || window.location.hostname.endsWith('.myshopify.dev'))
      returnTo = window.location.href;
    login.searchParams.set('return_to', returnTo);
    return login.href;
  })();
  // Asset loading belongs to the preview. Keep garage navigation and edits usable.
  const loadingLabel = startingRide ? 'FAHRT WIRD VORBEREITET' : null;
  const hasAccountAction = !!services.auth.login || oxygenRuntime || accountKind === 'customer';
  const accountAction = hasAccountAction ? accountKind === 'customer' ? <button type="button" className="account-header-button"
    aria-label="Konto öffnen" onClick={() => navigate('settings')}>
    <UserRound size={16} aria-hidden="true" />
    <span>KONTO</span>
  </button> : <a className="account-header-button" aria-label="Anmelden" href={oxygenLoginHref}
    data-login-hint={loginHint || undefined} data-reduced-motion={player.settings.reducedMotion}
    target={embedded ? '_top' : undefined} rel={embedded ? 'noopener' : undefined}>
    <UserRound size={16} aria-hidden="true" />
    <span>ANMELDEN</span>
  </a> : null;
  return (
    <>
    <div className={`app-shell${embedded ? ' app-shell-embedded' : ''}${hasAccountAction ? ' has-account-header' : ''}`} data-screen={screen} inert={loadingLabel ? true : undefined}>
      {!embedded && screen !== 'results' && <header className="topbar">
        {accountAction}
        <button className="brand" aria-label="PFUSCH-Shop öffnen" onClick={goToShop}>
          <GameBrand className="brand-logo" />
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
      {embedded && hasAccountAction && screen !== 'results' && <header className="account-header-embedded">
        <button className="game-signs-home" aria-label="PFUSCH-Shop öffnen" onClick={goToShop}>
          <GameBrand />
        </button>
        {accountAction}
      </header>}
      {screen === 'garage' && (
        <div className="garage-with-install-hint">
        {!embedded && accountKind === 'customer' && !offlineApp.installed && !installHintDismissed && <OfflineInstallHint offline={offlineApp}
          dismiss={() => setInstallHintDismissed(true)} openSettings={() => { setInstallHintDismissed(true); navigate('settings'); }} />}
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
        />
        </div>
      )}
      {screen === 'invitation' && sharedGame && <SharedGame share={sharedGame} start={start} garage={back} />}
      {screen === 'results' && result && (
        <RideResult player={player} run={result.run} reward={result.reward}
          start={start} startLocked={!access.allowed} shopRewardMessage={shopRewardMessage}
          garage={() => navigate('garage')} />
      )}
      {screen === 'challenges' && (
        <Challenges player={player} back={back} start={start} />
      )}
      {screen === 'progress' && <ProgressScreen player={player} back={back} />}
      {screen === 'rewards' && (
        <Rewards
          loginHref={oxygenLoginHref}
          onLogin={() => { void beginLogin(); }}
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
        loginHref={oxygenLoginHref}
        onLogin={services.auth.login || oxygenRuntime ? () => { void beginLogin(); } : undefined}
        message={accessError} onStart={start} back={() => setAccessOpen(false)}
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
          loginHref={oxygenLoginHref}
          accountKind={accountKind}
          onTutorial={() => {
            update({ ...player, settings: { ...player.settings, tutorialHintsSeen: [] } });
            start();
          }}
          onAccess={() => setAccessOpen(true)}
        />
      )}
      {screen !== 'results' && <nav className="bottom-nav" aria-label="Spielnavigation">
        <button
          className={screen === 'garage' ? 'active' : ''}
          aria-current={screen === 'garage' ? 'page' : undefined}
          onClick={() => navigate('garage')}
        >
          <Wrench size={18} />
          <span>GARAGE</span>
        </button>
        <button
          className={screen === 'challenges' ? 'active' : ''}
          aria-current={screen === 'challenges' ? 'page' : undefined}
          onClick={() => navigate('challenges')}
        >
          <Flag size={18} />
          <span>AUFGABEN</span>
        </button>
        <button
          className={screen === 'rewards' ? 'active' : ''}
          aria-current={screen === 'rewards' ? 'page' : undefined}
          onClick={() => navigate('rewards')}
        >
          <Gift size={18} />
          <span>BELOHNUNGEN</span>
        </button>
        <button
          className={screen === 'leaderboard' ? 'active' : ''}
          aria-current={screen === 'leaderboard' ? 'page' : undefined}
          onClick={() => navigate('leaderboard')}
        >
          <Trophy size={18} />
          <span>RANG</span>
        </button>
        {embedded && <button
          className={screen === 'settings' ? 'active' : ''}
          aria-label="Einstellungen"
          aria-current={screen === 'settings' ? 'page' : undefined}
          onClick={() => navigate('settings')}
        >
          <SettingsIcon size={18} />
          <span>OPTIONEN</span>
        </button>}
      </nav>}
      {notice && <output className="toast">{notice}</output>}
      <GiftNotification repository={services.players} active={!startingRide} />
    </div>
    {loadingLabel && <LoadingScreen label={loadingLabel} fullScreen reducedMotion={player.settings.reducedMotion} />}
    </>
  );
}
