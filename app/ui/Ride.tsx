import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import type { Player, Product, RunStats } from '../domain/types';
import { BIKES } from '../domain/config';
import { Engine } from '../game/engine';
import { GameAudio } from '../game/audio';
import { Preview, gameText } from './shared';
import { RideGestures } from './rideGestures';
import RidePause from './RidePause';
import RideHud from './RideHud';
interface Props {
  player: Player;
  products: Product[];
  audio: GameAudio;
  onFinish: (r: RunStats) => void;
  onResultsReady: (runId: string) => void;
  onMute: () => void;
}
export default function Ride({
  player,
  products,
  audio,
  onFinish,
  onResultsReady,
  onMute,
}: Props) {
  const engine = useMemo(
    () =>
      new Engine(
        BIKES.find((b) => b.id === player.bike) ?? BIKES[0],
        Math.floor(Math.random() * 0xffffffff),
      ),
    [player.bike],
  );
  const [tick, setTick] = useState(0),
    [ready, setReady] = useState(false),
    [countdown, setCountdown] = useState(3);
  const settled = useRef<RunStats | null>(null),
    revealed = useRef(false),
    lastEvent = useRef(0),
    eventTime = useRef(0),
    suppressClicksUntil = useRef(0);
  const finish = useRef(onFinish);
  finish.current = onFinish;
  const resultsReady = useRef(onResultsReady);
  resultsReady.current = onResultsReady;
  const gestures = useMemo(
    () =>
      new RideGestures({
        weight: (v) => engine.weight(v),
        move: (d) => engine.move(d),
        togglePause: () => {
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
    [engine, audio],
  );
  useEffect(() => {
    if (!ready) return;
    let remaining = 3;
    const timer = window.setInterval(() => {
      remaining--;
      setCountdown(remaining);
      if (remaining === 0) {
        clearInterval(timer);
        engine.start();
      }
    }, 650);
    return () => clearInterval(timer);
  }, [engine, ready]);
  useEffect(() => {
    const down = (event: PointerEvent) => {
      if (engine.resumeRemaining > 0) return;
      const target = event.target instanceof Element ? event.target : null;
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
      gestures.down(
        event.pointerId,
        event.clientX,
        event.clientY,
        event.timeStamp,
      );
    };
    const move = (event: PointerEvent) =>
      gestures.move(event.pointerId, event.clientX, event.clientY);
    const up = (event: PointerEvent) =>
      gestures.up(event.pointerId, event.timeStamp);
    const cancel = (event: PointerEvent) => gestures.cancel(event.pointerId);
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
    return () => {
      gestures.cancel();
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('lostpointercapture', cancel, true);
      window.removeEventListener('click', click, true);
    };
  }, [engine, gestures]);
  useEffect(() => {
    if (engine.phase !== 'playing') gestures.cancel();
  }, [engine.phase, gestures]);
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
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
      if (k === 'escape' || k === 'p') {
        gestures.cancel();
        if (engine.phase === 'playing' || engine.resumeRemaining > 0)
          engine.pause();
        else engine.resume();
        setTick((n) => n + 1);
        return;
      }
      if (k === 'arrowleft' || k === 'a') engine.move(-1);
      if (k === 'arrowright' || k === 'd') engine.move(1);
      if (k === 'arrowup' || k === 'w') engine.forward(true);
      if (k === 'arrowdown' || k === 's') engine.hold(true);
    };
    const keyup = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'arrowup' || k === 'w') engine.forward(false);
      if (k === 'arrowdown' || k === 's') engine.hold(false);
    };
    const blur = () => {
      gestures.cancel();
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
  }, [engine, audio, gestures]);
  function settle(e: Engine) {
    if (e.phase !== 'crashed' || settled.current) return;
    const run = e.stats();
    settled.current = run;
    finish.current(run);
  }
  function revealResults() {
    settle(engine);
    if (!settled.current || revealed.current) return;
    revealed.current = true;
    resultsReady.current(settled.current.id);
  }
  function frame(e: Engine) {
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
      settle(e);
      if (settled.current?.cause === 'Ride ended') revealResults();
    }
  }
  function pause() {
    gestures.cancel();
    engine.pause();
    audio.update(0, false, false);
    setTick((n) => n + 1);
  }
  function resume() {
    gestures.cancel();
    engine.resume();
    audio.unlock();
    setTick((n) => n + 1);
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
      data-frame={tick}
      data-resume-countdown={Math.ceil(engine.resumeRemaining)}
    >
      <Preview
        player={player}
        products={products}
        mode="ride"
        engine={engine}
        onFrame={frame}
        onReady={() => setReady(true)}
        onCrashComplete={revealResults}
      />
      <div
        className="gesture-zone"
        aria-label="Steuerung: seitlich deutlich wischen; nach unten ziehen zum Anheben, nach oben zum Korrigieren; zwei Finger zum Pausieren"
        onContextMenu={(e) => e.preventDefault()}
      />
      <RideHud engine={engine} best={player.highScore} pause={pause} />
      {engine.phase === 'playing' && (
        <div className="ride-feedback" aria-label="Punktegewinne">
          {eventVisible && engine.event.kind !== 'skill' && (
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
      {countdown > 0 && (
        <div className="countdown">
          <strong>{ready ? countdown : '…'}</strong>
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
      {engine.elapsed < 9 && countdown === 0 && engine.phase === 'playing' && (
        <div className="ride-tip">
          <span className="desktop-control-tip">
            S / ↓ ANHEBEN · W / ↑ KORRIGIEREN
          </span>
          <span className="touch-control-tip">
            DEUTLICH WISCHEN = SPURWECHSEL · ZWEI FINGER = PAUSE
          </span>
        </div>
      )}
      <Dialog
        open={engine.phase === 'paused' && !resuming}
        disablePointerDismissal
        onOpenChange={(open) => {
          if (!open) resume();
        }}
      >
        <RidePause
          muted={player.settings.muted}
          onMute={onMute}
          resume={resume}
          end={() => {
            engine.endRide();
            setTick((n) => n + 1);
          }}
        />
      </Dialog>
    </main>
  );
}
