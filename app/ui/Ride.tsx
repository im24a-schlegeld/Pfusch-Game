import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { Player, Product, RunStats, TutorialHint } from '../domain/types';
import { BIKES } from '../domain/config';
import { dayKey } from '../domain/progression';
import { dailySignMask } from '../domain/dailySigns';
import type { SignId } from '../game/signCollectibles';
import { TUTORIAL_HINTS } from '../domain/tutorial';
import { Engine } from '../game/engine';
import { VerifiedRunRecorder, type VerifiedRunChallenge, type VerifiedRunSubmission } from '../game/verifiedRun';
import type { TutorialCue } from '../game/tutorialCues';
import { GameAudio } from '../game/audio';
import { Preview, gameText } from './shared';
import { RideGestures } from './rideGestures';
import { tutorialGestureIntent } from './tutorialGesture';
import { updateGestureIndicator, type GestureBounds } from './rideGestureIndicator';
import RidePause from './RidePause';
import RideHud from './RideHud';
import RideTutorialOverlay from './RideTutorialOverlay';
import RideTouchButtons from './RideTouchButtons';
import { RideHeldInput, type RideHoldAction } from './rideHeldInput';
import { useTouchInput } from './useTouchInput';
import { RideCompletion } from './rideCompletion';
import { ShareReviveGate } from '../services/shareRevive';
import RideRevive from './RideRevive';
import './ride-guidance.css';
import './ride-settings.css';
interface Props {
  player: Player;
  products: Product[];
  audio: GameAudio;
  onFinish: (r: RunStats, verified?: VerifiedRunSubmission) => void;
  verifiedChallenge?: VerifiedRunChallenge | null;
  onResultsReady: (runId: string) => void;
  onExit: () => void;
  onMute: () => void;
  renderSettings?: (back: () => void) => ReactNode;
  onReady?: () => void;
  onLoadError?: (message: string) => void;
  onTutorialSeen?: (ids: readonly TutorialHint[]) => void;
  onSignPickup?: (eventId: string, signId: SignId) => void;
}
type ActiveTutorial = { id: TutorialHint; target?: { x: number; y: number } };
export default function Ride({
  player,
  products,
  audio,
  onFinish,
  onResultsReady,
  onExit,
  onMute,
  renderSettings,
  onReady,
  onLoadError,
  onTutorialSeen,
  onSignPickup,
  verifiedChallenge,
}: Props) {
  const engine = useMemo(
    () =>
      new Engine(
        BIKES.find((b) => b.id === player.bike) ?? BIKES[0],
        verifiedChallenge?.seed ?? Math.floor(Math.random() * 0xffffffff),
      ),
    [player.bike, verifiedChallenge],
  );
  const verifier = useMemo(() => verifiedChallenge ? new VerifiedRunRecorder(engine) : null, [engine, verifiedChallenge]);
  const completion = useMemo(() => new RideCompletion(engine,
    typeof navigator !== 'undefined' && typeof navigator.share === 'function'), [engine]);
  const reviveGate = useMemo(() => new ShareReviveGate(), [engine]);
  const [reviveOpen, setReviveOpen] = useState(false);
  const [reviveBusy, setReviveBusy] = useState(false);
  const [reviveMessage, setReviveMessage] = useState('');
  const reviveSharing = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const collectedDailySigns = dailySignMask(player.challenges, dayKey());
  useEffect(() => {
    // Apply after the recorder exists and before the ready countdown starts.
    // A new ride gets the current UTC day's saved progress, including guests.
    engine.excludeSigns(collectedDailySigns);
  }, [engine, collectedDailySigns]);
  const [tick, setTick] = useState(0),
    [ready, setReady] = useState(false),
    [countdown, setCountdown] = useState(3),
    [tutorial, setTutorial] = useState<ActiveTutorial | null>(null);
  const [pauseSettingsOpen, setPauseSettingsOpen] = useState(false);
  const settingsHeading = useRef<HTMLHeadingElement>(null);
  const tutorialRef = useRef<ActiveTutorial | null>(null);
  const seenTutorials = useRef(new Set(player.settings.tutorialHintsSeen ?? []));
  for (const hint of player.settings.tutorialHintsSeen ?? []) seenTutorials.current.add(hint);
  const tutorialCallback = useRef(onTutorialSeen);
  tutorialCallback.current = onTutorialSeen;
  const signCallback = useRef(onSignPickup);
  signCallback.current = onSignPickup;
  const lastSignPickup = useRef(0);
  const lastTutorialElapsed = useRef(-Infinity);
  const tutorialPointer = useRef<{ id: number; x: number; y: number; time: number } | null>(null);
  const gestureSurface = useRef<HTMLDivElement>(null);
  const lastEvent = useRef(0),
    eventTime = useRef(0),
    suppressClicksUntil = useRef(0);
  const finish = useRef(onFinish);
  finish.current = onFinish;
  const resultsReady = useRef(onResultsReady);
  resultsReady.current = onResultsReady;
  const gestureIndicator = useRef<SVGSVGElement>(null);
  const gestureBounds = useRef<GestureBounds | undefined>(undefined);
  const touchFeedback = useRef(false);
  const { touchActive } = useTouchInput();
  const buttonMode = player.settings.touchControls === 'buttons';
  const heldInput = useMemo(() => new RideHeldInput((action, held) => {
    if (action === 'wheelie') engine.hold(held);
    else engine.forward(held);
  }), [engine]);
  const gestures = useMemo(
    () =>
      new RideGestures({
        weight: (v) => engine.weight(buttonMode ? 0 : v),
        move: (d) => engine.move(d),
        togglePause: () => {
          heldInput.clear();
          if (engine.phase === 'playing') engine.pause();
          else if (engine.phase === 'paused') {
            if (engine.resumeRemaining > 0) engine.pause();
            else engine.resume();
          } else return;
          suppressClicksUntil.current = performance.now() + 400;
          audio.update(0, false, false);
          setTick((n) => n + 1);
        },
      }),
    [engine, audio, buttonMode, heldInput],
  );
  const clearGestures = useCallback(() => {
    gestures.cancel();
    heldInput.clear();
    updateGestureIndicator(gestureIndicator.current, null);
  }, [gestures, heldInput]);
  useEffect(() => {
    if (!touchActive) heldInput.clearPointers();
  }, [touchActive, heldInput]);
  const dismissTutorial = useCallback((skipAll = false) => {
    const active = tutorialRef.current;
    if (!active || document.hidden) return false;
    const acknowledged = skipAll ? TUTORIAL_HINTS : [active.id];
    for (const hint of acknowledged) seenTutorials.current.add(hint);
    tutorialRef.current = null;
    tutorialPointer.current = null;
    setTutorial(null);
    clearGestures();
    engine.resumeTutorial();
    lastTutorialElapsed.current = engine.elapsed;
    suppressClicksUntil.current = performance.now() + 350;
    audio.unlock();
    tutorialCallback.current?.(acknowledged);
    setTick((n) => n + 1);
    return true;
  }, [audio, clearGestures, engine]);
  const showTutorialCue = useCallback((cue: TutorialCue | null) => {
    const active = tutorialRef.current;
    if (active && active.id !== 'controls' && engine.phase === 'paused') {
      if (!cue || cue.id === active.id) {
        const target = cue ? { x: cue.x, y: cue.y } : undefined;
        if (active.target?.x !== target?.x || active.target?.y !== target?.y) {
          const next = { ...active, target };
          tutorialRef.current = next;
          setTutorial(next);
        }
      }
      return;
    }
    if (!cue || tutorialRef.current || seenTutorials.current.has(cue.id) ||
      !seenTutorials.current.has('controls') ||
      engine.phase !== 'playing' || engine.elapsed - lastTutorialElapsed.current < 8 ||
      gestures.feedback() || heldInput.hasPointers() || document.hidden) return;
    clearGestures();
    engine.pause();
    const next = { id: cue.id, target: { x: cue.x, y: cue.y } };
    tutorialRef.current = next;
    setTutorial(next);
    audio.update(0, false, false);
    setTick(n => n + 1);
  }, [audio, clearGestures, engine, gestures, heldInput]);
  const showControls = useCallback(() => {
    if (tutorialRef.current || seenTutorials.current.has('controls') ||
      engine.phase !== 'playing' || document.hidden || !document.hasFocus()) return;
    clearGestures();
    engine.pause();
    audio.update(0, false, false);
    const next = { id: 'controls' as const };
    tutorialRef.current = next;
    setTutorial(next);
    setTick(n => n + 1);
  }, [audio, clearGestures, engine]);
  const showControlsRef = useRef(showControls);
  showControlsRef.current = showControls;
  useEffect(() => {
    if (!ready) return;
    let remaining = 3;
    const timer = window.setInterval(() => {
      remaining--;
      setCountdown(remaining);
      if (remaining === 0) {
        clearInterval(timer);
        engine.start();
        if (document.hidden || !document.hasFocus()) {
          engine.pause();
          setTick((n) => n + 1);
        } else showControlsRef.current();
      }
    }, 650);
    return () => clearInterval(timer);
  }, [engine, ready]);
  useEffect(() => {
    // A paused Settings page owns its pointer input, including native scrolling.
    // Remove gameplay's capturing listeners rather than letting stale drags or
    // click suppression participate in the dialog's scroll chain.
    if (pauseSettingsOpen) {
      clearGestures();
      return;
    }
    const showGesture = () => updateGestureIndicator(gestureIndicator.current,
      !buttonMode && touchFeedback.current && engine.phase === 'playing' ? gestures.feedback() : null, gestureBounds.current);
    const down = (event: PointerEvent) => {
      if (pauseSettingsOpen || engine.resumeRemaining > 0) return;
      const target = event.target instanceof Element ? event.target : null;
      if (tutorialRef.current) {
        if (target?.closest('button') || tutorialPointer.current ||
          (event.pointerType === 'mouse' && event.button !== 0)) return;
        event.preventDefault();
        tutorialPointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp };
        // Capture on the persistent gameplay surface, not the temporary hint.
        // A continuing drag then survives the overlay's removal.
        gestureSurface.current?.setPointerCapture(event.pointerId);
        touchFeedback.current = event.pointerType === 'touch' || event.pointerType === 'pen';
        gestureBounds.current = gestureIndicator.current?.getBoundingClientRect();
        return;
      }
      const surface = target?.closest('.gesture-zone');
      const dialog =
        engine.phase === 'paused' && target?.closest('[role="dialog"]');
      if (
        (!surface && !dialog) ||
        (event.pointerType === 'mouse' && event.button !== 0)
      )
        return;
      if (surface) {
        event.preventDefault();
        surface.setPointerCapture(event.pointerId);
      }
      if (!gestures.feedback()) {
        touchFeedback.current = event.pointerType === 'touch' || event.pointerType === 'pen';
        gestureBounds.current = gestureIndicator.current?.getBoundingClientRect();
      }
      gestures.down(
        event.pointerId,
        event.clientX,
        event.clientY,
        event.timeStamp,
      );
      showGesture();
    };
    const move = (event: PointerEvent) => {
      if (tutorialRef.current) {
        const start = tutorialPointer.current;
        if (!start || start.id !== event.pointerId ||
          !tutorialGestureIntent(event.clientX - start.x, event.clientY - start.y, !buttonMode)) return;
        if (!dismissTutorial()) return;
        gestures.down(start.id, start.x, start.y, start.time);
      }
      gestures.move(event.pointerId, event.clientX, event.clientY);
      showGesture();
    };
    const up = (event: PointerEvent) => {
      heldInput.release(event.pointerId);
      if (tutorialPointer.current?.id === event.pointerId) tutorialPointer.current = null;
      gestures.up(event.pointerId, event.timeStamp);
      showGesture();
    };
    const cancel = (event: PointerEvent) => {
      heldInput.release(event.pointerId);
      if (tutorialPointer.current?.id === event.pointerId) tutorialPointer.current = null;
      gestures.cancel(event.pointerId);
      showGesture();
    };
    const click = (event: MouseEvent) => {
      if (performance.now() < suppressClicksUntil.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener('pointerdown', down, {
      capture: true,
      passive: false,
    });
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('lostpointercapture', cancel, true);
    window.addEventListener('click', click, true);
    window.addEventListener('resize', clearGestures);
    return () => {
      clearGestures();
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('lostpointercapture', cancel, true);
      window.removeEventListener('click', click, true);
      window.removeEventListener('resize', clearGestures);
    };
  }, [engine, gestures, clearGestures, dismissTutorial, buttonMode, heldInput, pauseSettingsOpen]);
  useEffect(() => {
    if (engine.phase !== 'playing') clearGestures();
  }, [engine.phase, clearGestures]);
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (pauseSettingsOpen || engine.phase === 'crashed') return;
      // Escape belongs to the open pause dialog; avoid two competing resumes.
      if (k === 'escape' && engine.phase === 'paused' && engine.resumeRemaining === 0 && !tutorialRef.current) return;
      if (!['shift', 'control', 'alt', 'meta'].includes(k)) heldInput.clearPointers();
      const activeTutorial = tutorialRef.current;
      const button = e.target instanceof Element && !!e.target.closest('button');
      if (activeTutorial && button && (k === ' ' || k === 'enter')) return;
      if (
        [
          'arrowleft',
          'arrowright',
          'arrowup',
          'arrowdown',
          ' ',
          'a',
          'd',
          'w',
          's',
          'escape',
          'p',
        ].includes(k)
      )
        e.preventDefault();
      if (e.repeat) return;
      if (activeTutorial) {
        if (!['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's', 'enter', ' '].includes(k)) return;
        e.preventDefault();
        if (!dismissTutorial()) return;
        if (k === 'enter' || k === ' ') return;
      }
      if (k === 'escape' || k === 'p') {
        clearGestures();
        if (engine.phase === 'playing' || engine.resumeRemaining > 0)
          engine.pause();
        else engine.resume();
        setTick((n) => n + 1);
        return;
      }
      if (k === 'arrowleft' || k === 'a') engine.move(-1);
      if (k === 'arrowright' || k === 'd') engine.move(1);
      if (k === 'arrowup' || k === 'w') heldInput.key(k, 'brake', true);
      if (k === 'arrowdown' || k === 's') heldInput.key(k, 'wheelie', true);
    };
    const keyup = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'arrowup' || k === 'w') heldInput.key(k, 'brake', false);
      if (k === 'arrowdown' || k === 's') heldInput.key(k, 'wheelie', false);
    };
    const blur = () => {
      tutorialPointer.current = null;
      clearGestures();
      engine.pause();
      engine.clearInput();
      audio.update(0, false, false);
      setTick((n) => n + 1);
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', blur);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', blur);
      audio.update(0, false, false);
    };
  }, [audio, clearGestures, dismissTutorial, engine, heldInput, pauseSettingsOpen]);
  function pressTouchButton(action: RideHoldAction, event: ReactPointerEvent<HTMLButtonElement>) {
    if (!buttonMode || !['touch', 'pen'].includes(event.pointerType) || engine.resumeRemaining > 0) return;
    event.preventDefault();
    // Capture on the permanent ride surface so the initiating finger keeps its
    // hold when the tutorial card is removed on this very pointerdown.
    gestureSurface.current?.setPointerCapture(event.pointerId);
    if (tutorialRef.current && !dismissTutorial()) return;
    if (engine.phase !== 'playing') return;
    heldInput.press(event.pointerId, action);
    audio.unlock();
    setTick(n => n + 1);
  }
  function settle(declineRevive = false) {
    completion.settle(run => {
      const proof = verifier?.proof();
      finish.current(run, proof && verifiedChallenge ? { token: verifiedChallenge.token, proof } : undefined);
    }, declineRevive);
  }
  function revealResults() {
    if (completion.offersRevive) {
      setReviveOpen(true);
      return;
    }
    settle();
    completion.reveal(runId => resultsReady.current(runId));
  }
  function declineRevive() {
    reviveGate.close();
    setReviveOpen(false);
    settle(true);
    completion.reveal(runId => resultsReady.current(runId));
  }
  async function shareAndRevive() {
    if (reviveSharing.current || !completion.offersRevive) return;
    reviveSharing.current = true;
    setReviveBusy(true);
    setReviveMessage('');
    try {
      const result = await reviveGate.request({ kind: 'score', name: player.leaderboardName,
        score: Math.floor(engine.score), date: dayKey() }, navigator);
      if (!mounted.current) return;
      if (result === 'ready' && completion.revive()) {
        clearGestures();
        setReviveOpen(false);
        engine.pause();
        // Sharing may resolve while its target app is still in the foreground.
        // Start the ordinary countdown only after returning to the game.
        if (!document.hidden && document.hasFocus()) engine.resume();
        audio.unlock();
        setTick(n => n + 1);
      } else if (result === 'cancelled') setReviveMessage('Teilen abgebrochen. Du kannst es erneut versuchen.');
      else if (result !== 'ready') setReviveMessage('Teilen konnte nicht abgeschlossen werden. Versuche es erneut oder beende die Fahrt.');
    } finally {
      reviveSharing.current = false;
      if (mounted.current) setReviveBusy(false);
    }
  }
  function frame(e: Engine) {
    if (e.signPickupSerial > lastSignPickup.current) {
      const runId = e.stats().id;
      while (lastSignPickup.current < e.signPickupSerial) {
        const serial = ++lastSignPickup.current;
        const signId = e.signPickupId(serial);
        if (signId) signCallback.current?.(`${runId}:${serial}`, signId);
      }
    }
    showControls();
    audio.update(
      e.speed,
      e.throttleInput > 0,
      e.phase === 'playing',
      e.bike.id,
      e.world.tunnelExposure(e.distance),
      e.forwardInput > 0,
    );
    if (e.event.serial !== lastEvent.current) {
      lastEvent.current = e.event.serial;
      eventTime.current = performance.now();
      audio.cue(e.phase === 'crashed');
    }
    setTick((n) => n + 1);
    if (e.phase === 'crashed') {
      settle();
      if (completion.run?.cause === 'Ride ended') revealResults();
    }
  }
  function pause() {
    clearGestures();
    engine.pause();
    audio.update(0, false, false);
    setTick((n) => n + 1);
  }
  function resume() {
    clearGestures();
    engine.resume();
    audio.unlock();
    setTick((n) => n + 1);
  }
  function exitToGarage() {
    if (engine.phase !== 'paused') return;
    clearGestures();
    engine.endRide();
    settle();
    reviveGate.close();
    onExit();
  }
  const resuming = engine.phase === 'paused' && engine.resumeRemaining > 0;
  const eventVisible =
    engine.phase === 'playing' &&
    engine.event.text &&
    performance.now() - eventTime.current < 1600;
  return (
    <main
      className="ride-screen"
      data-testid="ride-screen"
      data-phase={engine.phase}
      data-lane={engine.lane}
      data-reduced-motion={player.settings.reducedMotion}
      data-height={engine.height.toFixed(2)}
      data-forward={engine.forwardInput > 0}
      data-throttle-input={engine.throttleInput.toFixed(3)}
      data-forward-input={engine.forwardInput.toFixed(3)}
      data-angle={engine.wheelieAngle.toFixed(3)}
      data-angular-velocity={engine.wheelieAngularVelocity.toFixed(3)}
      data-balance={engine.balanceQuality.toFixed(3)}
      data-distance={engine.distance.toFixed(2)}
      data-environment={engine.environment.kind}
      data-lighting={engine.environment.lighting}
      data-tunnel={engine.world.tunnelExposure(engine.distance).toFixed(3)}
      data-wheelie={engine.wheelie}
      data-sign-mask={engine.collectedSigns}
      data-sign-sets={engine.signSetCount}
      data-revives={engine.reviveCount}
      data-frame={tick}
      data-resume-countdown={Math.ceil(engine.resumeRemaining)}
      data-tutorial={tutorial?.id ?? ''}
      data-touch-controls={buttonMode ? 'buttons' : 'swipe'}
      data-touch-active={touchActive}
    >
      <Preview
        player={player}
        products={products}
        mode="ride"
        engine={engine}
        onFrame={frame}
        onReady={() => {
          setReady(true);
          onReady?.();
        }}
        onLoadError={(message) => {
          // Let the app remove its transition overlay when WebGL fails so the
          // error state remains actionable instead of looking like a hang.
          setReady(true);
          onLoadError?.(message);
        }}
        onCrashComplete={revealResults}
        tutorialHintsSeen={[...seenTutorials.current]}
        onTutorialCue={showTutorialCue}
      />
      <RideTutorialOverlay hint={tutorial?.id ?? null} target={tutorial?.target}
        touchButtons={buttonMode && touchActive} onTouchPress={pressTouchButton}
        reducedMotion={player.settings.reducedMotion} onContinue={() => { dismissTutorial(); }}
        onSkip={() => { dismissTutorial(true); }} />
      <div
        className="gesture-zone"
        ref={gestureSurface}
        aria-label={buttonMode
          ? 'Steuerung: seitlich wischen für Spurwechsel; Wheelie und Bremse gedrückt halten; zwei Finger zum Pausieren'
          : 'Steuerung: seitlich wischen für Spurwechsel; nach unten ziehen zum Anheben, nach oben zum Korrigieren; zwei Finger zum Pausieren'}
        onContextMenu={(e) => e.preventDefault()}
      />
      <svg ref={gestureIndicator} className="ride-gesture-indicator" data-testid="ride-gesture-indicator" data-active="false" aria-hidden="true">
        <line data-part="range" className="ride-gesture-range" />
        <line data-part="vector-shadow" className="ride-gesture-shadow" />
        <line data-part="vector" className="ride-gesture-vector" />
        <circle data-part="origin" className="ride-gesture-origin" r="7" />
        <g data-part="finger">
          <circle className="ride-gesture-finger" r="18" />
          <circle data-part="strength" className="ride-gesture-strength" r="18" pathLength="100" strokeDasharray="100" strokeDashoffset="100" />
        </g>
        <g data-part="label" className="ride-gesture-label">
          <rect x="-73" y="-13" width="146" height="26" rx="13" />
          <text data-part="label-text" x="0" y="1" />
        </g>
      </svg>
      <RideHud engine={engine} best={player.highScore} pause={pause}
        dailySignMask={collectedDailySigns} />
      {buttonMode && touchActive && engine.phase === 'playing' && !tutorial &&
        <RideTouchButtons onPress={pressTouchButton} wheelieHeld={engine.wheelieHeld} brakeHeld={engine.forwardHeld} />}
      {engine.phase === 'playing' && (
        <div className="ride-feedback" aria-label="Punktegewinne">
          {eventVisible &&
            engine.event.kind !== 'skill' &&
            !engine.event.text.includes('HÄNGE SIE AB') && (
              <div
                key={`event-${engine.event.serial}`}
                className={`skill-event ${engine.event.kind}`}
              >
                {gameText(engine.event.text)}
              </div>
            )}
          {engine.scoreGains
            .filter((gain) => gain.group !== 'ride')
            .map((gain) => (
              <div
                key={gain.serial}
                className="score-gain"
                data-kind={gain.group ?? 'stunt'}
                data-points={gain.points}
                style={{
                  opacity: Math.min(
                    1,
                    (1.25 - engine.elapsed + gain.updatedAt) / 0.25,
                  ),
                }}
              >
                <span>{gameText(gain.text)}</span>
                <strong>+{gain.points.toLocaleString('de-CH')}</strong>
              </div>
            ))}
        </div>
      )}
      {ready && countdown > 0 && (
        <div className="countdown">
          <strong>{countdown}</strong>
        </div>
      )}
      {resuming && (
        <output
          className="v42-resume"
          aria-live="polite"
          aria-label={`Weiter in ${Math.ceil(engine.resumeRemaining)}`}
        >
          <strong>{Math.ceil(engine.resumeRemaining)}</strong>
          <span>WEITERFAHREN</span>
        </output>
      )}
      <RideRevive open={reviveOpen} score={engine.score} busy={reviveBusy} message={reviveMessage}
        share={() => { void shareAndRevive(); }} finish={declineRevive} />
      <Dialog
        open={engine.phase === 'paused' && !resuming && !tutorial}
        disablePointerDismissal
        onOpenChange={(open) => {
          if (!open) {
            if (pauseSettingsOpen) setPauseSettingsOpen(false);
            else resume();
          }
        }}
      >
        {pauseSettingsOpen && renderSettings ? <DialogContent className="game-dialog ride-settings-dialog" showCloseButton={false} initialFocus={settingsHeading}>
          <DialogTitle ref={settingsHeading} tabIndex={-1} className="sr-only">Einstellungen während der Pause</DialogTitle>
          <DialogDescription className="sr-only">Deine Fahrt bleibt angehalten. Zurück führt zum Pausenmenü.</DialogDescription>
          {renderSettings(() => setPauseSettingsOpen(false))}
        </DialogContent> : <RidePause
          touchButtons={buttonMode}
          muted={player.settings.muted}
          onMute={onMute}
          resume={resume}
          settings={renderSettings ? () => { clearGestures(); setPauseSettingsOpen(true); } : undefined}
          garage={exitToGarage}
          end={() => {
            engine.endRide();
            setTick((n) => n + 1);
          }}
        />}
      </Dialog>
    </main>
  );
}
